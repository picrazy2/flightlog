#!/usr/bin/env python3
"""High-recall manual extraction for the remaining CSV_ONLY flights with emails.
Per flight: search sender+city+airline-name over [flight-1yr, flight+1wk], read
text+PDF of ALL candidates, keep those literally containing the flight (any form),
dump PNR / cost lines / class / passenger-count for manual codification. No Gemini."""
import json, re, sys
from datetime import datetime, timedelta
sys.path.insert(0,'scripts'); import gmail_cli

al={a['iata']:a['name'] for a in json.load(open('/tmp/al.json'))}
DOM={'UA':'united.com','HU':'hnair.com','CA':'airchina','CZ':'csair','DL':'delta','TP':'flytap.com',
 '3U':'sichuanair','MU':'ceair','MF':'xiamenair','JD':'','WW':'wowair'}
CITY={'PVG':'Shanghai','SHA':'Shanghai','HRB':'Harbin','PEK':'Beijing','PKX':'Beijing','CKG':'Chongqing',
 'LHW':'Lanzhou','SEA':'Seattle','SFO':'San Francisco','LIS':'Lisbon','EWR':'Newark','BOS':'Boston',
 'URC':'Urumqi','KWL':'Guilin','CTU':'Chengdu','DNH':'Dunhuang','XIY':"Xi'an",'WUX':'Wuxi','KEF':'Reykjavik',
 'KJI':'Kanas','TAO':'Qingdao'}

def forms(flight):
    m=re.match(r'([0-9A-Z]{2})(\d+)',flight); c,n=m.group(1),m.group(2); name=al.get(c,'')
    fs=[flight,f"{c} {n}",f"{c}-{n}",f"{c}{int(n)}"]
    if name: fs+=[f"{name} {n}",f"{name} {int(n)}",f"{name.split()[0]} {n}"]
    return [f for f in fs if f]

def contains(flight,dep,arr,text):
    tl=text.lower()
    for f in forms(flight):
        if f.lower() in tl: return f
    n=re.match(r'[0-9A-Z]{2}(\d+)',flight).group(1)
    if n in text and dep.lower() in tl and arr.lower() in tl: return f"{n}+route"
    return None

def paxcount(t):
    et=set(re.findall(r'(?:eTicket number|Ticket ?#|票号|Ticket Number)[:\s]*([0-9\-]{8,18})',t))
    nm=set(re.findall(r'\b([A-Z]{2,}/[A-Z]{2,}(?:\s?[A-Z]{2,})?)\b',t)); nm={x for x in nm if 'AIRLIN' not in x}
    return max(len(et),len(nm),1)

def costlines(t):
    return [l.strip() for l in t.split('\n') if re.search(r'(Total|Airfare|Fare|TICKET AMOUNT|Per Person|per person|金额|票价|费用|总额)[^\n]{0,30}?(USD|GBP|EUR|CNY|RMB|元|人民币|\$|[\d,]+\.\d2)',l) and len(l.strip())<70]

TARGETS=[l.split() for l in open('/tmp/targets29.txt').read().strip().split('\n')]
tok=gmail_cli.access_token()
for date,flight,route in TARGETS:
    dep,arr=route.split('-'); fd=datetime.strptime(date,'%Y-%m-%d')
    lo=(fd-timedelta(days=365)).strftime('%Y/%m/%d'); hi=(fd+timedelta(days=7)).strftime('%Y/%m/%d')
    c=re.match(r'[0-9A-Z]{2}',flight).group(0); name=al.get(c,''); dom=DOM.get(c,'')
    cdep,carr=CITY.get(dep,''),CITY.get(arr,'')
    ids=[]
    for q in [f'from:({dom} OR trip.com OR ctrip.com OR ly.com OR expedia.com OR amadeus.com) after:{lo} before:{hi}' if dom else '',
              f'("{name}" OR "{cdep}" OR "{carr}" OR {dep} OR {arr}) (ticket OR itinerary OR receipt OR booking OR confirm OR 行程 OR 出票 OR boarding OR 机票) after:{lo} before:{hi}']:
        if q: ids+=gmail_cli.search_ids(q,tok,25)
    ids=list(dict.fromkeys(ids))
    print(f"\n{'='*68}\n{date} {flight} {route}  ({len(ids)} candidates)")
    hit_any=False
    for m in gmail_cli.get_messages(ids,tok,fmt="full",max_chars=18000):
        full=m['body']
        try: full+="\n".join(t for _,t in gmail_cli.get_attachments_text(m['id'],tok))
        except Exception: pass
        h=contains(flight,dep,arr,full)
        if not h: continue
        hit_any=True
        pnr=re.findall(r'(?:Confirmation (?:Number|#)?|PNR|预订编[码号]|Booking (?:Reference|code|ref)\w*)[:：\s]*([A-Z0-9]{5,7})',full)
        print(f"  >> {m['id']} | {m['from'][:26]} | {m['subject'][:42]} | match='{h}' pax={paxcount(full)}")
        if pnr: print(f"      PNR candidates: {sorted(set(pnr))[:4]}")
        for L in list(dict.fromkeys(costlines(full)))[:6]: print(f"      $ {L}")
    if not hit_any: print("   (no candidate contained the flight)")
