#!/usr/bin/env python3
"""Robust manual chase: match a flight in an email by ANY form — IATA (DL2310 /
DL 2310), airline-name+number (Delta 2310), or bare number with both airports/
cities present. Reads text + PDF of every candidate. No Gemini."""
import json, re, sys
from datetime import datetime, timedelta
sys.path.insert(0,'scripts'); import gmail_cli

al={a['iata']:a['name'] for a in json.load(open('/tmp/al.json'))}
CITY={'PVG':'Shanghai','SHA':'Shanghai','HRB':'Harbin','PEK':'Beijing','CKG':'Chongqing',
 'LHW':'Lanzhou','SEA':'Seattle','SFO':'San Francisco','LIS':'Lisbon','EWR':'Newark',
 'BOS':'Boston','URC':'Urumqi','KJI':'','PKX':'Beijing','TAO':'Qingdao'}
TARGETS=[l.split()[:3] for l in """
2018-03-22 HU7962 BOS-PVG
2018-03-29 HU7961 PVG-BOS
2023-05-26 CA1431 PEK-CKG
2023-07-02 CA1502 SHA-PEK
2023-07-02 CA1221 PEK-LHW
2023-08-05 DL2310 SFO-SEA
2024-01-19 TP203 LIS-EWR
""".strip().split("\n")]

def matches(flight, text):
    m=re.match(r'([0-9A-Z]{2})(\d+)',flight); code,num=m.group(1),m.group(2)
    name=al.get(code,'')
    forms=[flight, f"{code} {num}", f"{code}-{num}", f"{code}{int(num)}"]
    if name: forms+= [f"{name} {num}", f"{name} {int(num)}", f"{name.split()[0]} {num}"]
    tl=text.lower()
    for f in forms:
        if f and f.lower() in tl: return f
    return None

tok=gmail_cli.access_token()
for date,flight,route in TARGETS:
    dep,arr=route.split('-'); fd=datetime.strptime(date,'%Y-%m-%d')
    lo=(fd-timedelta(days=365)).strftime('%Y/%m/%d'); hi=(fd+timedelta(days=7)).strftime('%Y/%m/%d')
    code=re.match(r'([0-9A-Z]{2})',flight).group(1); name=al.get(code,'')
    cdep,carr=CITY.get(dep,''),CITY.get(arr,'')
    q=f'("{name}" OR {dep} OR {arr} OR "{cdep}" OR "{carr}") (eticket OR itinerary OR receipt OR confirm OR booking OR ticket OR 行程 OR 出票 OR boarding) after:{lo} before:{hi}'
    ids=gmail_cli.search_ids(q,tok,20)
    found=[]
    for m in gmail_cli.get_messages(ids,tok,fmt="full",max_chars=18000):
        full=m['body']
        try: full+="\n".join(t for _,t in gmail_cli.get_attachments_text(m['id'],tok))
        except Exception: pass
        hit=matches(flight, full)
        if hit: found.append((m,hit,full))
    print(f"\n{'='*66}\n{date} {flight} {route}  [{len(found)} email(s) contain the flight]")
    for m,hit,full in found[:2]:
        print(f"  >> {m['from'][:30]} | {m['subject'][:46]} | matched '{hit}'")
        lines=[t.strip() for t in full.split('\n') if re.search(r'PNR|Confirmation|Booking|订单|预订|票号|Total|Fare|Airfare|Class|Cabin|舱|金额|票价|USD|CNY|GBP|EUR|per person|Per Person',t) and 2<len(t.strip())<88]
        for L in list(dict.fromkeys(lines))[:12]: print('       ',L)
