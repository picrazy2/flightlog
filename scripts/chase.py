#!/usr/bin/env python3
"""Manual chase of specific Part-B flights: find booking email (route+airline+OTA),
read text + PDF (pypdf), keep emails whose text/PDF contains the flight #, dump
the booking-relevant lines for manual extraction. No Gemini."""
import json, re, sys
from datetime import datetime, timedelta
sys.path.insert(0,'scripts')
import gmail_cli

al={a['iata']:a['name'] for a in json.load(open('/tmp/al.json'))}
TARGETS=[l.split() for l in """
2018-03-22 HU7962 BOS-PVG
2018-04-02 WW125 KEF-BOS
2020-01-22 CA1644 HRB-PEK
2023-05-26 CA1431 PEK-CKG
2023-07-02 CA1502 SHA-PEK
2023-08-05 DL2310 SFO-SEA
2024-01-19 TP203 LIS-EWR
2024-03-06 CA1901 PEK-URC
""".strip().split("\n")]

def fnv(fn):
    m=re.match(r'([0-9A-Z]{2})(\d+)',fn); a,n=m.group(1),m.group(2)
    return [fn,f"{a} {n}",f"{a}{int(n)}",f"{a}-{int(n)}"]

tok=gmail_cli.access_token()
for date,fn,route in TARGETS:
    dep,arr=route.split('-'); fd=datetime.strptime(date,'%Y-%m-%d')
    lo=(fd-timedelta(days=365)).strftime('%Y/%m/%d'); hi=(fd+timedelta(days=7)).strftime('%Y/%m/%d')
    aln=al.get(''.join(c for c in fn if c.isalpha()),'')
    ids=gmail_cli.search_ids(f'("{aln}" OR {dep} OR {arr}) (eticket OR itinerary OR 出票 OR 行程 OR booking OR receipt OR confirm OR ticket OR boarding) after:{lo} before:{hi}', tok, 15)
    print(f"\n{'='*70}\n{date} {fn} {route}  ({len(ids)} candidates)")
    best=None
    for m in gmail_cli.get_messages(ids, tok, fmt="full", max_chars=18000):
        full=m['body']
        try: full+="\n".join(t for _,t in gmail_cli.get_attachments_text(m['id'],tok))
        except Exception: pass
        if any(v in full for v in fnv(fn)):
            print(f"  >> MATCH email: {m['from'][:30]} | {m['subject'][:45]}")
            lines=[t.strip() for t in full.split('\n') if re.search(r'Confirmation|Booking|PNR|Total|Airfare|Fare|Class|Cabin|'+re.escape(fn)+r'|乘机|票价|金额|元|USD|CNY|GBP|EUR|passenger|Passenger',t) and 2<len(t.strip())<85]
            for L in list(dict.fromkeys(lines))[:14]: print('       ',L)
            best=m['id']; break
    if not best: print("  (no email whose text/PDF contains the flight number)")
