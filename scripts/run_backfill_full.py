#!/usr/bin/env python3
"""Full Gmail booking sweep for a user, via the SAFE match-only backfill-by-flight path.

Discovers candidates with the same broad subject clauses watch-gmail uses (the full
~253-email sweep) PLUS per-flight number searches, then feeds them to the
backfill-by-flight edge function — which attaches bookings ONLY to flights already in
the log (current data = source of truth), notes flight-number conflicts, and reports
email legs that have no match (the "what the sweep found that we don't have" comparison).
Unlike raw watch-gmail it never creates phantom flights.

Usage: python3 scripts/run_backfill_full.py <user_id> [batch_size]
"""
import json, os, sys, time, urllib.request, urllib.parse
from datetime import datetime, timedelta
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def load_env(p):
    p = os.path.join(ROOT, p)
    if os.path.exists(p):
        for line in open(p):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1); os.environ.setdefault(k, v)
load_env(".env"); load_env(".env.local")
URL = os.environ["SUPABASE_URL"]; SRK = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
CID = os.environ["GOOGLE_CLIENT_ID"]; CSEC = os.environ["GOOGLE_CLIENT_SECRET"]
SEC = os.environ.get("VITE_EDGE_FUNCTION_SECRET") or os.environ["EDGE_FUNCTION_SECRET"]
USER = sys.argv[1] if len(sys.argv) > 1 else "emily"
BATCH = int(sys.argv[2]) if len(sys.argv) > 2 else 5

SUBJECT_CLAUSES = [
 'subject:(confirmation OR itinerary OR "e-ticket" OR ticket OR booking OR reservation) (flight OR airline)',
 'subject:("boarding pass" OR "checked in" OR "checked-in" OR "e-boarding")',
 'subject:"Google Flights"',
 'subject:("travel reservation center" OR "trip id" OR "trip confirmation" OR "your trip to") (flight OR airline OR airport)',
 'subject:(redeemed OR redemption OR "miles") (itinerary OR flight OR airline OR reservation)',
 'subject:(refund OR cancelled OR canceled OR cancellation OR "schedule change" OR "flight change" OR "itinerary has changed" OR "flight has changed" OR rescheduled OR "time change" OR "change to your booking" OR "confirmation of changes")',
 "subject:(机票 OR 航班 OR 行程 OR 值机 OR 登机牌 OR 预订 OR 确认 OR 退票 OR 退款 OR 变更 OR 取消)",
 "subject:(航空券 OR 予約 OR 搭乗 OR フライト OR eチケット OR 欠航 OR 変更 OR 払い戻し)",
 "subject:(항공권 OR 예약 OR 탑승 OR 항공편 OR 취소 OR 변경 OR 환불 OR 일정)",
 "subject:(volo OR prenotazione OR biglietto OR itinerario OR annullamento OR rimborso OR cancellazione)",
 "subject:(vuelo OR vol OR reserva OR billete OR bitllet OR factura OR itinerari OR viatge OR cancelación OR reembolso)",
 "subject:(réservation OR billet OR itinéraire OR annulation OR remboursement OR avion)",
 "subject:(uçuş OR rezervasyon OR bilet OR iptal OR iade OR biniş)",
 "subject:(voo OR embarque OR bilhete OR cancelamento OR reembolso)",
 "from:amadeus.com",
 "from:(trip.com OR ctrip.com OR ly.com) (confirm OR itinerary OR booking OR ticket OR 机票 OR 行程 OR 出票)",
 "subject:(出票成功 OR 电子客票 OR 行程单 OR 行程确认)",
 'subject:("flight receipt" OR "e-receipt" OR "your receipt") (flight OR airline OR air)',
 "from:(expedia.com OR expediamail.com) subject:(confirmation OR itinerary OR trip)",
 "from:(lot.com OR amadeus.net)",
 'subject:("Fwd:" OR "Fw:") (e-ticket OR eticket OR itinerary OR "flight booking" OR confirmation OR 行程 OR 机票)',
]

def sget(q):
    return json.load(urllib.request.urlopen(urllib.request.Request(URL+"/rest/v1/"+q, headers={"apikey": SRK, "Authorization": "Bearer "+SRK})))
rt = sget(f"gmail_accounts?user_id=eq.{USER}&select=refresh_token")[0]["refresh_token"]
tok = json.load(urllib.request.urlopen("https://oauth2.googleapis.com/token",
    data=urllib.parse.urlencode({"client_id": CID, "client_secret": CSEC, "refresh_token": rt, "grant_type": "refresh_token"}).encode()))["access_token"]
flights = sget(f"flights?user_id=eq.{USER}&select=flight_date,airline_iata,flight_number")
dates = sorted(f["flight_date"] for f in flights)
AFTER = "2019/01/01"
BEFORE = (datetime.fromisoformat(dates[-1]) + timedelta(days=8)).strftime("%Y/%m/%d")

def search(q):
    ids = set(); page = None
    while True:
        params = {"q": q, "maxResults": "500"}
        if page: params["pageToken"] = page
        d = json.load(urllib.request.urlopen(urllib.request.Request(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages?"+urllib.parse.urlencode(params),
            headers={"Authorization": "Bearer "+tok})))
        for m in d.get("messages", []): ids.add(m["id"])
        page = d.get("nextPageToken")
        if not page: break
    return ids

print(f"discovering for {USER}: subject sweep + flight-anchored...")
cand = set()
for c in SUBJECT_CLAUSES:
    cand |= search(f"{c} after:{AFTER} before:{BEFORE} -category:promotions"); time.sleep(0.02)
for f in flights:
    fd = datetime.fromisoformat(f["flight_date"])
    q = f'("{f["airline_iata"]}{f["flight_number"]}" OR "{f["airline_iata"]} {f["flight_number"]}") after:{(fd-timedelta(days=365)).strftime("%Y/%m/%d")} before:{(fd+timedelta(days=8)).strftime("%Y/%m/%d")} -category:promotions'
    cand |= search(q); time.sleep(0.02)
cand = sorted(cand)

STATE = f"/tmp/bf_processed_{USER}.json"
done = set(json.load(open(STATE))) if os.path.exists(STATE) else set()
todo = [c for c in cand if c not in done]
print(f"  {len(cand)} candidates ({len(done)} already handled, {len(todo)} to do)\n")

def call(ids):
    try:
        return json.load(urllib.request.urlopen(urllib.request.Request(
            URL+"/functions/v1/backfill-by-flight",
            data=json.dumps({"user_id": USER, "message_ids": ids}).encode(),
            headers={"Authorization": "Bearer "+SEC, "Content-Type": "application/json"})))
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": e.read().decode()[:200]}

tot = Counter(); linked = 0; discrep = []; unmatched = set()
for i in range(0, len(todo), BATCH):
    r = call(todo[i:i+BATCH])
    if not r.get("ok"):
        print(f"  batch {i//BATCH+1}: ERROR {r.get('error')}"); continue
    for res in r.get("results", []):
        tot[res["outcome"]] += 1
        if res["outcome"] != "failed": done.add(res["message_id"])
    json.dump(sorted(done), open(STATE, "w"))
    linked += r.get("bookings_linked", 0)
    discrep += r.get("discrepancies", [])
    for u in r.get("unmatched_legs", []): unmatched.add(u)
    print(f"  {min(i+BATCH,len(todo))}/{len(todo)}  linked_total={linked}  flights_with_booking={r.get('flights_with_booking')}")
    time.sleep(0.2)

print("\n=== Full sweep done ===")
print("outcomes:", dict(tot))
print("bookings linked this run:", linked)
if discrep:
    print(f"\nflight-number conflicts ({len(discrep)}) — kept import as truth:")
    for d in sorted(set(discrep)): print("  -", d)
if unmatched:
    print(f"\nemail legs NOT in {USER}'s log ({len(unmatched)}) — the comparison:")
    for u in sorted(unmatched): print("  -", u)
