#!/usr/bin/env python3
"""Find KEEP flights whose captured cost looks like taxes-only (likely an award),
read the booking email (text+PDF), and report any miles/points figure found."""
import csv, json, re, sys
sys.path.insert(0,'scripts'); import gmail_cli
CUR={'USD','EUR','GBP','CNY','RMB','HKD','SGD','JPY','THB','MXN','CAD','AUD','TRY','MYR','PLN','ZAR'}
rows=list(csv.DictReader(open('csv_gmail_outer_join.csv')))
db=json.load(open('/tmp/db_full.json')); bk={b['id']:b for b in json.load(open('/tmp/bookings_ts.json'))}
fbk={}
for f in db:
    fbk[((f['sched_dep'] or '')[:10],(f.get('airline_iata') or '')+str(f.get('flight_number')))]=bk.get(f['booking_id'])

# candidates: KEEP, cash cost present, amount under a taxes-ish threshold, dedupe by PNR
cand=[]; seen=set()
for r in rows:
    if r['verdict']!='KEEP' or not r['gmail_cost']: continue
    p=r['gmail_cost'].split()
    if len(p)<2 or p[1] not in CUR: continue
    try: amt=float(p[0].replace(',',''))
    except: continue
    # convert rough to USD for thresholding
    rate={'USD':1,'EUR':1.1,'GBP':1.25,'CAD':.73,'HKD':.13,'CNY':.14,'RMB':.14,'SGD':.74,'JPY':.0067,'THB':.028,'MXN':.05,'MYR':.22,'ZAR':.054,'AUD':.65,'TRY':.03,'PLN':.25}.get(p[1],1)
    usd=amt*rate
    if usd>450: continue                      # too high to be a pure-tax award
    key=r['booking_pnr'] or (r['date']+r['flight'])
    if key in seen: continue
    seen.add(key)
    cand.append((r,amt,p[1]))

tok=gmail_cli.access_token()
print(f"{len(cand)} low-cash (possible award) bookings to check\n")
for r,amt,cur in sorted(cand,key=lambda x:x[0]['date']):
    b=fbk.get((r['date'],r['flight'])); mid=(b.get('raw_email') or {}).get('message_id') if b else None
    if not mid:
        print(f"{r['date']} {r['flight']:8} {r['route']:9} {amt} {cur} | (no db booking email)"); continue
    m=gmail_cli.get_messages([mid],tok,fmt="full",max_chars=14000)[0]
    body=m['body']
    try: body+="\n".join(t for _,t in gmail_cli.get_attachments_text(mid,tok))
    except Exception: pass
    miles=re.findall(r'([\d,]{3,})\s*(?:miles|points|pts|奖励里程|里程)', body, re.I)
    award=bool(re.search(r'award|redeem|mileage|lifemiles|aadvantage|avios|miles|points|奖励|兑换', body, re.I))
    mvals=sorted({int(x.replace(',','')) for x in miles if x.replace(',','').isdigit() and 999<int(x.replace(',',''))<2000000}, reverse=True)
    print(f"{r['date']} {r['flight']:8} {r['route']:9} {amt:>7} {cur} | award_kw={award} | miles_found={mvals[:3]} | {m['from'][:20]} | {m['subject'][:30]}")
