#!/usr/bin/env python3
"""Write GOOGLE_CLIENT_ID/SECRET (from ~/Downloads client_secret JSON) and the
refresh token you paste as an argument into .env.

Usage:  python3 scripts/set_refresh_token.py '<REFRESH_TOKEN>'
"""
import glob, json, os, sys

if len(sys.argv) != 2 or not sys.argv[1].strip():
    sys.exit("Usage: python3 scripts/set_refresh_token.py '<REFRESH_TOKEN>'")
token = sys.argv[1].strip()

f = glob.glob(os.path.expanduser("~/Downloads/client_secret_*.json"))
if not f:
    sys.exit("No client_secret_*.json in ~/Downloads")
c = json.load(open(f[0]))
c = c.get("installed") or c.get("web")
cid, csecret = c["client_id"], c["client_secret"]

ENV = os.path.join(os.path.dirname(__file__), "..", ".env")
keep = []
if os.path.exists(ENV):
    keep = [l for l in open(ENV).read().splitlines()
            if not l.startswith(("GOOGLE_CLIENT_ID=", "GOOGLE_CLIENT_SECRET=", "GOOGLE_REFRESH_TOKEN="))]
keep += [f"GOOGLE_CLIENT_ID={cid}", f"GOOGLE_CLIENT_SECRET={csecret}", f"GOOGLE_REFRESH_TOKEN={token}"]
open(ENV, "w").write("\n".join(keep) + "\n")
print("✅ Wrote GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN to .env")
