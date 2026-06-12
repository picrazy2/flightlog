#!/usr/bin/env python3
"""Orchestrate the flight-anchored booking backfill for a user.

Discovers candidate Gmail message IDs locally (one search per flight number), then
feeds them to the backfill-by-flight edge function in small batches (the function does
the Gemini parse + booking attach). Keeps each function call light enough to stay under
the edge resource limit. Idempotent: re-running re-feeds the same IDs but bookings only
link once and upserts dedupe by PNR.

Usage: python3 scripts/run_backfill_emily.py <user_id> [batch_size]
"""
import json, os, sys, time, urllib.request, urllib.parse
from datetime import datetime, timedelta
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def load_env(path):
    p = os.path.join(ROOT, path)
    if not os.path.exists(p): return
    for line in open(p):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k, v)
load_env(".env"); load_env(".env.local")

URL = os.environ["SUPABASE_URL"]; SRK = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
CID = os.environ["GOOGLE_CLIENT_ID"]; CSEC = os.environ["GOOGLE_CLIENT_SECRET"]
SEC = os.environ.get("VITE_EDGE_FUNCTION_SECRET") or os.environ["EDGE_FUNCTION_SECRET"]
USER = sys.argv[1] if len(sys.argv) > 1 else "emily"
BATCH = int(sys.argv[2]) if len(sys.argv) > 2 else 5

def sget(q):
    r = urllib.request.Request(f"{URL}/rest/v1/{q}", headers={"apikey": SRK, "Authorization": "Bearer " + SRK})
    return json.load(urllib.request.urlopen(r))

rt = sget(f"gmail_accounts?user_id=eq.{USER}&select=refresh_token")[0]["refresh_token"]
tok = json.load(urllib.request.urlopen("https://oauth2.googleapis.com/token",
    data=urllib.parse.urlencode({"client_id": CID, "client_secret": CSEC, "refresh_token": rt, "grant_type": "refresh_token"}).encode()))["access_token"]
flights = sget(f"flights?user_id=eq.{USER}&select=flight_date,airline_iata,flight_number")

def search(q):
    ids = set(); page = None
    while True:
        params = {"q": q, "maxResults": "500"}
        if page: params["pageToken"] = page
        req = urllib.request.Request("https://gmail.googleapis.com/gmail/v1/users/me/messages?" + urllib.parse.urlencode(params),
            headers={"Authorization": "Bearer " + tok})
        d = json.load(urllib.request.urlopen(req))
        for m in d.get("messages", []): ids.add(m["id"])
        page = d.get("nextPageToken")
        if not page: break
    return ids

print(f"discovering candidates for {USER} ({len(flights)} flights)...")
cand = set()
for f in flights:
    fd = datetime.fromisoformat(f["flight_date"])
    after = (fd - timedelta(days=365)).strftime("%Y/%m/%d")
    before = (fd + timedelta(days=8)).strftime("%Y/%m/%d")
    q = f'("{f["airline_iata"]}{f["flight_number"]}" OR "{f["airline_iata"]} {f["flight_number"]}") after:{after} before:{before} -category:promotions'
    cand |= search(q)
    time.sleep(0.02)
cand = sorted(cand)
# skip messages already handled (non-failed) on a previous run, so re-runs only retry
# failures + new mail instead of re-paying Gemini for everything.
STATE = f"/tmp/bf_processed_{USER}.json"
done_ids = set(json.load(open(STATE))) if os.path.exists(STATE) else set()
todo = [c for c in cand if c not in done_ids]
print(f"  {len(cand)} unique candidate emails ({len(done_ids)} already handled, {len(todo)} to do)\n")
cand = todo

def call(ids):
    body = json.dumps({"user_id": USER, "message_ids": ids}).encode()
    req = urllib.request.Request(f"{URL}/functions/v1/backfill-by-flight", data=body,
        headers={"Authorization": "Bearer " + SEC, "Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": e.read().decode()[:200]}

tot = Counter(); linked = 0; discrep = []; unmatched = set()
for i in range(0, len(cand), BATCH):
    batch = cand[i:i+BATCH]
    r = call(batch)
    if not r.get("ok"):
        print(f"  batch {i//BATCH+1}: ERROR {r.get('error')}")
        continue
    for res in r.get("results", []):
        tot[res["outcome"]] += 1
        if res["outcome"] != "failed":  # remember handled mail; retry only failures
            done_ids.add(res["message_id"])
    json.dump(sorted(done_ids), open(STATE, "w"))
    linked += r.get("bookings_linked", 0)
    discrep += r.get("discrepancies", [])
    for u in r.get("unmatched_legs", []): unmatched.add(u)
    print(f"  {min(i+BATCH,len(cand))}/{len(cand)}  linked_total={linked}  flights_with_booking={r.get('flights_with_booking')}")
    time.sleep(0.2)

print("\n=== Pass 1 done ===")
print("outcomes:", dict(tot))
print("bookings linked:", linked)
if discrep:
    print(f"\nflight-number discrepancies ({len(discrep)}):")
    for d in discrep: print("  -", d)
if unmatched:
    print(f"\nemail legs with no match in {USER}'s log ({len(unmatched)}):")
    for u in sorted(unmatched): print("  -", u)
