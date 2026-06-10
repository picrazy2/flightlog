#!/usr/bin/env python3
"""Background recovery: re-scan a date range in small chunks with backoff.
Stops immediately on a Gemini quota/spending-cap error. Logs to /tmp/recovery_log.txt.

Usage: python3 scripts/recover_window.py START END CHUNK_DAYS
       python3 scripts/recover_window.py 2024-07-20 2026-06-30 14
"""
import json, os, sys, time, urllib.request
from datetime import datetime, timedelta

ROOT=os.path.join(os.path.dirname(__file__),"..")
def env():
    e={}
    for l in open(os.path.join(ROOT,".env")):
        l=l.strip()
        if "=" in l and not l.startswith("#"): k,v=l.split("=",1); e[k]=v
    return e
E=env()
URL=E["SUPABASE_URL"].rstrip("/")+"/functions/v1/watch-gmail"
SECRET=E["EDGE_FUNCTION_SECRET"]
LOG=open("/tmp/recovery_log.txt","a")
def log(m):
    line=f"{datetime.now().strftime('%H:%M:%S')} {m}"
    print(line); LOG.write(line+"\n"); LOG.flush()

def call(after,before):
    body=json.dumps({"after":after,"before":before,"notify":False}).encode()
    req=urllib.request.Request(URL,data=body,method="POST",
        headers={"Authorization":f"Bearer {SECRET}","Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(req,timeout=300) as r:
            return json.load(r)
    except urllib.error.HTTPError as ex:
        return {"ok":False,"http_error":ex.code,"detail":ex.read().decode()[:300]}
    except Exception as ex:
        return {"ok":False,"error":str(ex)}

def is_quota(resp):
    if resp.get("http_error")==429: return True
    for r in resp.get("results",[]):
        e=(r.get("error") or "")+ (r.get("warnings") and " ".join(r["warnings"]) or "")
        if any(w in e.lower() for w in ("quota","spending cap","resource_exhausted","429")): return True
    return False

def main():
    start=datetime.strptime(sys.argv[1],"%Y-%m-%d")
    end=datetime.strptime(sys.argv[2],"%Y-%m-%d")
    step=int(sys.argv[3]) if len(sys.argv)>3 else 14
    log(f"=== recovery start {start.date()} -> {end.date()} step={step}d ===")
    tot_imp=tot_canc=tot_fail=0
    cur=start; delay=12
    while cur<end:
        nxt=min(cur+timedelta(days=step),end)
        a=cur.strftime("%Y/%m/%d"); b=nxt.strftime("%Y/%m/%d")
        resp=call(a,b)
        if is_quota(resp):
            log(f"{a}->{b} QUOTA HIT — stopping. {json.dumps(resp)[:200]}")
            break
        if not resp.get("ok"):
            log(f"{a}->{b} ERR {json.dumps(resp)[:200]}")
            time.sleep(delay); delay=min(delay*2,120);
            cur=nxt; continue
        imp=resp.get("imported",0); canc=resp.get("cancelled",0); fail=resp.get("failed",0)
        scn=resp.get("messages_scanned",0)
        tot_imp+=imp; tot_canc+=canc; tot_fail+=fail
        log(f"{a}->{b} scanned={scn} imported={imp} cancelled={canc} failed={fail}")
        time.sleep(delay if scn>3 else 4)
        cur=nxt
    log(f"=== done. totals imported={tot_imp} cancelled={tot_canc} failed={tot_fail} ===")

if __name__=="__main__":
    main()
