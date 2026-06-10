import json, os, time, urllib.request
ROOT=os.path.join(os.path.dirname(__file__),"..")
E={}
for l in open(os.path.join(ROOT,".env")):
    l=l.strip()
    if "=" in l and not l.startswith("#"): k,v=l.split("=",1); E[k]=v
URL=E["SUPABASE_URL"].rstrip("/")+"/functions/v1/extract-emails"; SEC=E["EDGE_FUNCTION_SECRET"]
ids=list(json.load(open('/tmp/cand30.json')).keys())
print("emails:",len(ids)); out=[]
for i in range(0,len(ids),8):
    body=json.dumps({"message_ids":ids[i:i+8]}).encode()
    req=urllib.request.Request(URL,data=body,method="POST",headers={"x-debug-secret":SEC,"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(req,timeout=300) as r: out+=json.load(r).get("results",[])
        print("batch",i//8+1,"ok")
    except Exception as ex: print("batch",i//8+1,"ERR",str(ex)[:100])
    time.sleep(8)
json.dump(out, open('/tmp/extracted2.json','w'))
print("done",len(out),"with flights:",sum(1 for r in out if (r.get('parsed') or {}).get('flights')))
