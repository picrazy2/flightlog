#!/usr/bin/env python3
"""For each Part-B flight (CSV-only, no matched email), search Gmail to find any
booking email the pipeline missed. Flight number is the primary/clearest match;
airline name + dep/arr IATA are the fallback. Windowed to [flight-1yr, flight+1wk]."""
import csv, json, re, sys
from datetime import datetime, timedelta
sys.path.insert(0,'scripts')
import gmail_cli

al={a['iata']:a['name'] for a in json.load(open('/tmp/al.json'))}
NOISE=re.compile(r'hyatt|marriott|hotel|airbnb|爱彼迎|calendar|venmo|splitwise|amazon|costco|'
 r'economist|cnn|newsletter|redbubble|going\.|scott|\but\.taxi|uber|dealmoon|bonvoy|'
 r'\bAlert -|month in review|timeline|skymiles.*program|inflight wi-?fi|tell us about your trip|'
 r'mileageplus dining|fico|schwab|calm|translate|fraternity|opie|lost plate|food tour',re.I)

def airline_of(fn):
    return ''.join(c for c in fn if c.isalpha())

rows=[r for r in csv.DictReader(open('csv_gmail_outer_join.csv')) if r['status']=='CSV_ONLY (no email)']
tok=gmail_cli.access_token()
out=[]
for r in rows:
    fn=r['flight']; dep,arr=r['route'].split('-')
    fd=datetime.strptime(r['date'],'%Y-%m-%d')
    lo=(fd-timedelta(days=365)).strftime('%Y/%m/%d'); hi=(fd+timedelta(days=7)).strftime('%Y/%m/%d')
    win=f"after:{lo} before:{hi}"
    aln=al.get(airline_of(fn),'')
    # primary: flight number; fallback: airline + both airports
    queries=[f'"{fn}" {win}']
    fb=" OR ".join(filter(None,[f'"{aln}"' if aln else '', dep, arr]))
    if fb: queries.append(f'({fb}) {win}')
    hits=[]
    for q in queries:
        ids=gmail_cli.search_ids(q, tok, 12)
        if ids:
            for m in gmail_cli.get_messages(ids, tok, fmt="meta"):
                if NOISE.search(m['subject']) or NOISE.search(m['from']): continue
                hits.append((m['date'][:11],m['from'][:24],m['subject'][:60],q.startswith('"'+fn)))
        if any(h[3] for h in hits): break  # got flight-number hits, stop
    seen=set(); uniq=[]
    for h in hits:
        k=(h[2],h[0])
        if k in seen: continue
        seen.add(k); uniq.append(h)
    out.append({'date':r['date'],'fn':fn,'route':r['route'],'airline':r['csv_airline'],'hits':uniq[:6]})

for o in out:
    tag="FLIGHT#" if any(h[3] for h in o['hits']) else ("other" if o['hits'] else "NONE")
    print(f"\n{o['date']} {o['fn']:8} {o['route']:9} {o['airline']:16} [{tag}]")
    for h in o['hits']:
        mark="**" if h[3] else "  "
        print(f"   {mark}{h[0]} | {h[1]:24} | {h[2]}")
json.dump(out, open('/tmp/partb_results.json','w'), default=str)
