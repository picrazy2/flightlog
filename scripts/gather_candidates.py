#!/usr/bin/env python3
"""Gather candidate booking-email message IDs for the PDF-locked Part-B flights
(those with no text email containing the flight#). Search by route+airline+
flight-variants within [flight-1yr, flight+1wk]; keep booking-ish senders."""
import csv, json, re, sys
from datetime import datetime, timedelta
sys.path.insert(0,'scripts')
import gmail_cli

al={a['iata']:a['name'] for a in json.load(open('/tmp/al.json'))}
ext=json.load(open('/tmp/partb_extract.json'))  # which flights had no text email
SENDER_OK=re.compile(r'united|delta|hainan|china|asiana|lot|amadeus|egyptair|tap|latam|virgin|'
 r'expedia|trip\.com|ctrip|ly\.com|同程|携程|wow|qantas|singapore|ana|airchina|jetstar|'
 r'pguo8888|kuiying2012|ryanair|panasonic|eticket|booking|国航|出票|sas|skyteam|delta', re.I)
SUBJ_OK=re.compile(r'eticket|e-ticket|receipt|itinerary|confirm|booking|出票|电子客票|行程|'
 r'boarding|electronic document|reservation|ticket|行程单|Fwd|Fw:', re.I)

def fnv(fn):
    m=re.match(r'([0-9A-Z]{2})(\d+)',fn)
    if not m: return [fn]
    a,n=m.group(1),m.group(2)
    return [fn,f'"{a} {n}"',f'{a}{int(n)}']

rows=[r for r in csv.DictReader(open('csv_gmail_outer_join.csv'))
      if r['status']=='CSV_ONLY (no email)' and r['notes'].startswith('HAS')]
# only the PDF-locked (no verified text email)
locked=[r for r in rows if not ext.get(f"{r['date']}|{r['flight']}",{}).get('verified')]
tok=gmail_cli.access_token()
cand={}   # mid -> {from,subject,date, for:[flights]}
for r in locked:
    fn=r['flight']; dep,arr=r['route'].split('-'); fd=datetime.strptime(r['date'],'%Y-%m-%d')
    lo=(fd-timedelta(days=365)).strftime('%Y/%m/%d'); hi=(fd+timedelta(days=7)).strftime('%Y/%m/%d')
    aln=al.get(''.join(c for c in fn if c.isalpha()),'')
    q=f'({dep} OR {arr} OR "{aln}") ({" OR ".join(fnv(fn))} OR eticket OR itinerary OR 出票 OR 行程 OR booking OR receipt) after:{lo} before:{hi}'
    ids=gmail_cli.search_ids(q, tok, 12)
    if ids:
        for m in gmail_cli.get_messages(ids, tok, fmt="meta"):
            if not (SENDER_OK.search(m['from']) and SUBJ_OK.search(m['subject'])): continue
            c=cand.setdefault(m['id'],{'from':m['from'][:30],'subject':m['subject'][:55],'date':m['date'][:11],'for':[]})
            c['for'].append(f"{r['date']}|{fn}|{r['route']}")
json.dump(cand, open('/tmp/cand_ids.json','w'), default=str)
print("locked flights:",len(locked)," unique candidate emails:",len(cand))
for mid,c in sorted(cand.items(),key=lambda x:x[1]['date']):
    print(f"  {mid} | {c['date']} | {c['from']:30} | {c['subject']:55} | x{len(c['for'])}")
