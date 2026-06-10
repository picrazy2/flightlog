#!/usr/bin/env python3
"""Send the filtered candidate message IDs to extract-emails (surgical Gemini) in
small batches with backoff. Saves parsed results to /tmp/extracted.json."""
import json, os, re, time, urllib.request

ROOT=os.path.join(os.path.dirname(__file__),"..")
E={}
for l in open(os.path.join(ROOT,".env")):
    l=l.strip()
    if "=" in l and not l.startswith("#"): k,v=l.split("=",1); E[k]=v
URL=E["SUPABASE_URL"].rstrip("/")+"/functions/v1/extract-emails"; SEC=E["EDGE_FUNCTION_SECRET"]

cand=json.load(open('/tmp/cand_ids.json'))
DROP=re.compile(r'Inflight Wi-?Fi|Schedule Change Notification|Important information|'
 r'reservation for .* is processing', re.I)
KEEP=re.compile(r'eticket|e-ticket|receipt|itinerary|confirm|booking|出票|电子客票|行程|'
 r'boarding pass|electronic document|canceled|redeemed|reservation', re.I)
ids=[mid for mid,c in cand.items() if KEEP.search(c['subject']) and not DROP.search(c['subject'])]
# also include the 15 text-verified booking emails for uniform per-person extraction
ext=json.load(open('/tmp/partb_extract.json'))
for v in ext.values():
    for c in v.get('verified',[]): ids.append(c['id'])
ids=list(dict.fromkeys(ids))
print("emails to extract:",len(ids))

out=[]; delay=8
for i in range(0,len(ids),8):
    chunk=ids[i:i+8]
    body=json.dumps({"message_ids":chunk}).encode()
    req=urllib.request.Request(URL,data=body,method="POST",
        headers={"x-debug-secret":SEC,"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(req,timeout=300) as r:
            d=json.load(r); out+=d.get("results",[])
        print(f"  batch {i//8+1}: +{len(d.get('results',[]))}")
    except Exception as ex:
        print(f"  batch {i//8+1} ERR {str(ex)[:120]}")
    time.sleep(delay)
json.dump(out, open('/tmp/extracted.json','w'))
ok=sum(1 for r in out if r.get('parsed',{}).get('flights'))
print("done. results:",len(out),"| with flights:",ok)
