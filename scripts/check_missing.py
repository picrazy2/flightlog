#!/usr/bin/env python3
"""Read the booking emails that have NO captured cost/PNR; report if data is truly
absent or was missed. text + PDF, no Gemini."""
import json, re, sys
sys.path.insert(0,'scripts'); import gmail_cli
miss=json.load(open('/tmp/missing.json'))
tok=gmail_cli.access_token()
COST=re.compile(r'(total|fare|amount|price|paid|票价|金额|total to pay|grand total)[^\n]{0,28}?'
 r'(USD|GBP|EUR|CNY|RMB|HKD|SGD|JPY|THB|MXN|CAD|AUD|TRY|MYR|PLN|ZAR|\$|£|€|¥)\s?[\d,]+\.?\d*|'
 r'[\$£€]\s?[\d,]+\.\d{2}', re.I)
PNR=re.compile(r'(confirmation|booking ref\w*|reservation|PNR|预订编|订单号|booking code|booking number)[:：\s#]{1,4}([A-Z0-9]{5,8})', re.I)

print("=== NO-COST emails (",len(miss['nocost']),"unique ) ===")
for mid,flights in miss['nocost'].items():
    r=gmail_cli.get_messages([mid],tok,fmt="full",max_chars=16000)[0]
    body=r['body']
    try: body+="\n".join(t for _,t in gmail_cli.get_attachments_text(mid,tok))
    except Exception: pass
    costs=COST.findall(body); pnrs=PNR.findall(body)
    # show a couple concrete cost lines
    cl=[l.strip() for l in body.split('\n') if COST.search(l) and len(l.strip())<60][:2]
    print(f"\n{','.join(flights)} | {r['from'][:24]} | {r['subject'][:38]}")
    print(f"   COST in email? {'YES' if costs else 'NO'}  {cl if cl else ''}")
    if pnrs: print(f"   PNR found: {sorted(set(p[1] for p in pnrs))[:3]}")
