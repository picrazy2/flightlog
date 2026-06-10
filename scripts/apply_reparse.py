#!/usr/bin/env python3
"""Apply the per-person re-extraction: map each re-parsed email -> booking, compare
old vs new cost/PNR, update the bookings table, and print a year-by-year report."""
import json, os, re, urllib.request
ROOT=os.path.join(os.path.dirname(__file__),"..")
E={}
for l in open(os.path.join(ROOT,".env")):
    l=l.strip()
    if "=" in l and not l.startswith("#"): k,v=l.split("=",1); E[k]=v
SB=E["SUPABASE_URL"].rstrip("/"); KEY=E["SUPABASE_SERVICE_ROLE_KEY"]
def patch(table,idv,payload):
    req=urllib.request.Request(f"{SB}/rest/v1/{table}?id=eq.{idv}",data=json.dumps(payload).encode(),
        method="PATCH",headers={"apikey":KEY,"Authorization":f"Bearer {KEY}","Content-Type":"application/json","Prefer":"return=minimal"})
    urllib.request.urlopen(req)

reparsed=json.load(open('/tmp/reparsed.json'))
bk={b['id']:b for b in json.load(open('/tmp/bookings_ts.json'))}
mid2booking={}
for b in bk.values():
    m=(b.get('raw_email') or {}).get('message_id')
    if m: mid2booking[m]=b
db=json.load(open('/tmp/db_full.json'))
# booking_id -> a representative flight (date/label) for the report
bflight={}
for f in db:
    bflight.setdefault(f['booking_id'],[]).append(((f['sched_dep'] or '')[:10],(f.get('airline_iata') or '')+str(f.get('flight_number'))))

rows=[]
for r in reparsed:
    p=r.get('parsed') or {}; b=mid2booking.get(r['id'])
    if not b: continue
    new_cash=p.get('cost_cash'); new_cur=p.get('cost_currency'); new_pts=p.get('cost_points'); new_prog=p.get('points_program')
    refs=p.get('booking_refs_airline') or []; new_pnr=','.join(x.get('pnr','') for x in refs if x.get('pnr'))
    old_cash=b.get('cost_cash'); old_cur=b.get('cost_currency')
    changed = (new_cash is not None and abs((new_cash or 0)-(old_cash or 0))>0.5)
    payload={}
    if new_cash is not None: payload['cost_cash']=new_cash; payload['cost_currency']=new_cur
    if new_pts is not None: payload['cost_points']=new_pts; payload['points_program']=new_prog
    if payload:
        try: patch("bookings",b['id'],payload)
        except Exception as ex: print("patch err",b['id'],str(ex)[:80])
    fl=sorted(bflight.get(b['id'],[]))
    yr=fl[0][0][:4] if fl else '????'
    rows.append((yr,fl[0] if fl else ('',''),old_cash,old_cur,new_cash,new_cur,new_pnr,changed,len(fl)))

rows.sort()
print(f"applied re-extraction to {len(rows)} bookings\n")
print("year | flight        | OLD cost      | NEW (per-person)   | PNR        | legs | changed")
for yr,fl,oc,ocur,nc,ncur,pnr,ch,nlegs in rows:
    mark="  <-- CHANGED" if ch else ""
    print(f"{yr} | {fl[1]:12} | {str(oc or '-'):>9} {ocur or '':3} | {str(nc or '-'):>9} {ncur or '':3} | {pnr[:10]:10} | {nlegs:>2}{mark}")
print("\nchanged:",sum(1 for r in rows if r[7]))
