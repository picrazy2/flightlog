#!/usr/bin/env python3
"""For each recoverable Part-B flight, find the booking email and fetch its full body.
Outputs /tmp/partb_bodies.json keyed by (date|flight)."""
import csv, json, re, sys
from datetime import datetime, timedelta
sys.path.insert(0,'scripts')
import gmail_cli

al={a['iata']:a['name'] for a in json.load(open('/tmp/al.json'))}
def airline_of(fn): return ''.join(c for c in fn if c.isalpha())

# booking-email senders/subjects worth fetching (airline/OTA/receipt/eticket)
GOOD=re.compile(r'eticket|e-ticket|receipt|itinerary|confirmation|booking|出票|电子客票|行程|'
 r'boarding pass|electronic document|tarjeta de embarque|ticket', re.I)
SENDER_OK=re.compile(r'united|delta|hainan|china|asiana|lot|amadeus|egyptair|tap|latam|virgin|'
 r'expedia|trip\.com|ctrip|ly\.com|同程|携程|wow|qantas|singapore|ana|airchina|jetstar|'
 r'pguo8888|kuiying2012|alexanderguo99|flyasiana|ryanair|panasonic', re.I)

rows=[r for r in csv.DictReader(open('csv_gmail_outer_join.csv'))
      if r['status']=='CSV_ONLY (no email)' and r['notes'].startswith('HAS')]
tok=gmail_cli.access_token()
result={}
for r in rows:
    fn=r['flight']; dep,arr=r['route'].split('-'); fd=datetime.strptime(r['date'],'%Y-%m-%d')
    lo=(fd-timedelta(days=365)).strftime('%Y/%m/%d'); hi=(fd+timedelta(days=7)).strftime('%Y/%m/%d')
    ids=gmail_cli.search_ids(f'"{fn}" after:{lo} before:{hi}', tok, 15)
    if not ids:
        aln=al.get(airline_of(fn),'')
        ids=gmail_cli.search_ids(f'({dep} OR {arr} OR "{aln}") after:{lo} before:{hi}', tok, 15)
    metas=gmail_cli.get_messages(ids, tok, fmt="meta")
    # rank: prefer GOOD subject + OK sender
    cand=[m for m in metas if (GOOD.search(m['subject']) or '出票' in m['subject']) and SENDER_OK.search(m['from']+m['subject'])]
    cand=cand or [m for m in metas if SENDER_OK.search(m['from'])]
    key=f"{r['date']}|{fn}"
    result[key]={'route':r['route'],'cands':[{'id':m['id'],'from':m['from'],'subject':m['subject'],'date':m['date'][:11]} for m in cand[:4]]}
json.dump(result, open('/tmp/partb_cands.json','w'), default=str)
for k,v in result.items():
    print(k, v['route'])
    for c in v['cands']: print('   ',c['id'],'|',c['from'][:22],'|',c['subject'][:50])
