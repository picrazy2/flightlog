#!/usr/bin/env python3
"""For each KEEP booking with points, read the full email, count travelers
(eTicket numbers / GUO-style names), and compute the correct per-person points."""
import csv, json, re, sys
sys.path.insert(0,'scripts'); import gmail_cli
rows=list(csv.DictReader(open('csv_gmail_outer_join.csv')))
db=json.load(open('/tmp/db_full.json')); bk={b['id']:b for b in json.load(open('/tmp/bookings.json'))}
fb={((f['sched_dep'] or '')[:10],(f.get('airline_iata') or '')+str(f.get('flight_number'))):f['booking_id'] for f in db}
tok=gmail_cli.access_token()
seen=set(); out=[]
for r in rows:
    if r['verdict']!='KEEP' or not r['gmail_cost']: continue
    if not re.search(r'(mp|miles|points|lifemiles|avios|aeroplan|chase|flying_club|virgin|aadvantage|mileageplus)', r['gmail_cost'], re.I): continue
    if 'pts' not in r['gmail_cost'] and not re.search(r'\d+\s+\w*(mp|miles|points|lifemiles|avios|aeroplan|chase|club|aadvantage)',r['gmail_cost'],re.I): continue
    key=r['booking_pnr'] or r['date']+r['flight']
    if key in seen: continue
    seen.add(key)
    bid=fb.get((r['date'],r['flight'])); b=bk.get(bid)
    mid=(b.get('raw_email') or {}).get('message_id') if b else None
    pts=b.get('cost_points') if b else None
    if not mid or not pts: out.append((r['date'],r['flight'],pts,'?','no-email/manual')); continue
    m=gmail_cli.get_messages([mid],tok,fmt="full",max_chars=18000)[0]
    body=m['body']
    try: body+="\n".join(t for _,t in gmail_cli.get_attachments_text(mid,tok))
    except Exception: pass
    ets=set(re.findall(r'\b0\d{12}\b', body))               # United/airline 13-digit eTicket numbers
    names=set(re.findall(r'\b([A-Z]{2,}/[A-Z]{2,}(?:KENNY|KATE|[A-Z]{2,})?(?:MR|MS|MRS)?)\b', body))
    names={n for n in names if 'AIRLIN' not in n and 'ETICKET' not in n}
    pax=max(len(ets), len(names), 1)
    out.append((r['date'],r['flight'],pts,pax,f"per-person={pts//pax if pax else pts}  names={sorted(names)[:3]}"))
for d,f,pts,pax,info in sorted(out):
    flag=" <-- DIVIDE" if isinstance(pax,int) and pax>1 else ""
    print(f"{d} {f:8} pts={pts} pax={pax}{flag}  {info}")
