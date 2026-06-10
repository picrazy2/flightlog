#!/usr/bin/env python3
"""Gather genuine booking-email candidate IDs for the RECOVERABLE/PARTIAL/TOUR
Part-B flights. Thorough search (flight# variants, route, airline, OTA/agent
senders) in [flight-1yr, flight+1wk]. Output /tmp/cand30.json."""
import csv, json, re, sys
from datetime import datetime, timedelta
sys.path.insert(0,'scripts')
import gmail_cli

al={a['iata']:a['name'] for a in json.load(open('/tmp/al.json'))}
SENDER=re.compile(r'united|delta|hainan|china|asiana|lot|amadeus|egyptair|tap|latam|virgin|'
 r'expedia|trip\.com|ctrip|ly\.com|同程|携程|wow|qantas|singapore|ana|airchina|jetstar|'
 r'pguo8888|kuiying2012|ryanair|splendour|eastern|sichuan|xiamen|国航|出票|emirates|本人', re.I)
SUBJ=re.compile(r'eticket|e-ticket|receipt|itinerary|confirm|booking|出票|电子客票|行程|机票|'
 r'boarding|electronic document|reservation|ticket|tarjeta|行程单|Fwd|Fw:|tour|报价|行程及', re.I)

def fnv(fn):
    m=re.match(r'([0-9A-Z]{2})(\d+)',fn)
    if not m: return [fn]
    a,n=m.group(1),m.group(2); return [fn,f'"{a} {n}"',f'{a}{int(n)}']

rows=[r for r in csv.DictReader(open('csv_gmail_outer_join.csv'))
      if r['category'] in ('RECOVERABLE','HAS_EMAIL_PARTIAL','TOUR_PACKAGE')]
tok=gmail_cli.access_token()
cand={}
for r in rows:
    fn=r['flight']; dep,arr=r['route'].split('-'); fd=datetime.strptime(r['date'],'%Y-%m-%d')
    lo=(fd-timedelta(days=365)).strftime('%Y/%m/%d'); hi=(fd+timedelta(days=7)).strftime('%Y/%m/%d')
    aln=al.get(''.join(c for c in fn if c.isalpha()),'')
    qs=[f'({" OR ".join(fnv(fn))}) after:{lo} before:{hi}',
        f'({dep} OR {arr} OR "{aln}") (eticket OR itinerary OR 出票 OR 行程 OR booking OR receipt OR 报价 OR tour OR boarding) after:{lo} before:{hi}']
    ids=[]
    for q in qs: ids+=gmail_cli.search_ids(q, tok, 12)
    ids=list(dict.fromkeys(ids))
    if not ids: continue
    for m in gmail_cli.get_messages(ids, tok, fmt="meta"):
        if not (SENDER.search(m['from']) and SUBJ.search(m['subject'])): continue
        c=cand.setdefault(m['id'],{'from':m['from'][:28],'subject':m['subject'][:50],'for':[]})
        c['for'].append(f"{r['date']}|{fn}")
json.dump(cand, open('/tmp/cand30.json','w'), default=str)
print("target flights:",len(rows)," unique candidate emails:",len(cand))
