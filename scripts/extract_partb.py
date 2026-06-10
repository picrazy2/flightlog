#!/usr/bin/env python3
"""Verified Part-B extraction. Only trust an email that LITERALLY contains the
flight number (Gmail full-text + body check). Extract PNR, per-person cost, class.
Outputs /tmp/partb_extract.json for review."""
import csv, json, re, sys
from datetime import datetime, timedelta
sys.path.insert(0,'scripts')
import gmail_cli

def fnvariants(fn):
    m=re.match(r'([A-Z]+)(\d+)',fn);
    if not m: return [fn]
    a,n=m.group(1),m.group(2)
    return [fn, f"{a} {n}", f"{a}{int(n)}", f"{a} {int(n)}"]

def passengers(text):
    # count distinct eTicket numbers or traveler names
    et=set(re.findall(r'eTicket number:?\s*([0-9]{10,16})', text))
    if et: return len(et)
    names=set(re.findall(r'\b([A-Z]{2,}/[A-Z]{2,}(?:\s?[A-Z]{2,})?)\b', text))  # GUO/ALEXANDER
    names={n for n in names if 'AIRLIN' not in n}
    return max(1,len(names))

def costs(text):
    out=[]
    for m in re.finditer(r'(?:Total|Airfare|TICKET AMOUNT|Per Person Total|eTicket Total|费用总计|票价总额)[^\d]{0,18}?([\d,]+\.?\d*)\s*(USD|GBP|EUR|CNY|RMB|元|人民币)?', text):
        amt=m.group(1).replace(',',''); cur=m.group(2) or ''
        try: out.append((float(amt),cur,m.group(0)[:40]))
        except: pass
    return out

def pnr(text):
    for pat in [r'Confirmation Number:?\s*\n?\s*([A-Z0-9]{6})', r'reservation[,:]?\s+([A-Z0-9]{6})\b',
                r'Booking [Rr]ef\w*\D{0,6}([A-Z0-9]{5,7})', r'Confirmation:?\s*([A-Z0-9]{6})',
                r'预订号|订单号\D{0,4}([A-Z0-9]{5,8})']:
        m=re.search(pat,text)
        if m and m.lastindex: return m.group(1)
    return ''

rows=[r for r in csv.DictReader(open('csv_gmail_outer_join.csv'))
      if r['status']=='CSV_ONLY (no email)' and r['notes'].startswith('HAS')]
tok=gmail_cli.access_token()
res={}
for r in rows:
    fn=r['flight']; dep,arr=r['route'].split('-'); fd=datetime.strptime(r['date'],'%Y-%m-%d')
    lo=(fd-timedelta(days=365)).strftime('%Y/%m/%d'); hi=(fd+timedelta(days=7)).strftime('%Y/%m/%d')
    ids=gmail_cli.search_ids(f'"{fn}" after:{lo} before:{hi}', tok, 10)
    verified=[]
    if ids:
        bodies=gmail_cli.get_messages(ids, tok, fmt="full", max_chars=25000)
        for b in bodies:
            full=b['body']
            try: full+= "\n".join(t for _,t in gmail_cli.get_attachments_text(b['id'],tok))
            except: pass
            if any(v in full for v in fnvariants(fn)):  # literal flight-number present
                verified.append({'id':b['id'],'from':b['from'][:28],'subject':b['subject'][:50],
                    'pnr':pnr(full),'pax':passengers(full),'costs':costs(full)[:4]})
    res[f"{r['date']}|{fn}"]={'route':r['route'],'verified':verified}

json.dump(res, open('/tmp/partb_extract.json','w'), default=str)
for k,v in res.items():
    tag="VERIFIED" if v['verified'] else "—no flight# email—"
    print(f"\n{k} {v['route']} [{tag}]")
    for c in v['verified']:
        print(f"   {c['from']:28} | {c['subject']:50}")
        print(f"      PNR={c['pnr']} pax={c['pax']} costs={c['costs']}")
