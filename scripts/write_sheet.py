#!/usr/bin/env python3
"""Create a Google Sheet from /tmp/sheet_rows.json with row colors by match status.
Requires the .env refresh token to include scope https://www.googleapis.com/auth/spreadsheets
(re-mint via OAuth Playground with gmail.readonly + spreadsheets)."""
import json, os, sys, urllib.parse, urllib.request

ROOT=os.path.join(os.path.dirname(__file__),"..")
SHEETS="https://sheets.googleapis.com/v4/spreadsheets"

def env():
    e={}
    for l in open(os.path.join(ROOT,".env")):
        l=l.strip()
        if "=" in l and not l.startswith("#"):
            k,v=l.split("=",1); e[k]=v
    return e

def token():
    e=env()
    data=urllib.parse.urlencode({"grant_type":"refresh_token","client_id":e["GOOGLE_CLIENT_ID"],
        "client_secret":e["GOOGLE_CLIENT_SECRET"],"refresh_token":e["GOOGLE_REFRESH_TOKEN"]}).encode()
    r=json.load(urllib.request.urlopen("https://oauth2.googleapis.com/token",data=data))
    return r["access_token"]

def api(method,url,tok,payload=None):
    data=json.dumps(payload).encode() if payload is not None else None
    req=urllib.request.Request(url,data=data,method=method,
        headers={"Authorization":f"Bearer {tok}","Content-Type":"application/json"})
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as ex:
        body=ex.read().decode()
        if "insufficient" in body.lower() or ex.code==403:
            sys.exit("\n❌ Token lacks Sheets scope. Re-mint with BOTH scopes:\n"
                     "   https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/spreadsheets\n"
                     "then: python3 scripts/set_refresh_token.py '<new refresh token>'\n\nDetail: "+body[:300])
        raise

COLOR={
 "matched":   (0.82,0.93,0.82),   # keep — matched (green)
 "recovered": (0.70,0.89,0.85),   # keep — CSV-only, booking recovered (teal)
 "partial":   (1.00,0.86,0.66),   # keep — CSV-only, partial/ancillary/tour (orange)
 "noemail":   (1.00,0.96,0.76),   # keep — CSV-only, no email (pale yellow)
 "future":    (0.78,0.86,0.98),   # keep — future gmail-only booking (blue)
 "delete":    (0.96,0.78,0.78),   # delete (red)
}
def colorkey(r):
    if r['status']=='MATCHED': return 'matched'
    if r['status']=='GMAIL_ONLY': return 'future' if r['verdict']=='KEEP' else 'delete'
    cat=r['category']  # CSV_ONLY
    if cat=='RECOVERED': return 'recovered'
    if cat in ('HAS_EMAIL_PARTIAL','ANCILLARY_ONLY','TOUR_PACKAGE'): return 'partial'
    return 'noemail'

def main():
    d=json.load(open('/tmp/sheet_rows.json'))
    cols, rows = d['cols'], d['rows']
    tok=token()
    title="Journia — CSV vs Gmail reconciliation"
    idfile=os.path.join(ROOT,"scripts",".sheet_id")
    sid=None
    if os.path.exists(idfile):
        sid=open(idfile).read().strip()
        # verify it still exists
        try: gid=api("GET",f"{SHEETS}/{sid}",tok)["sheets"][0]["properties"]["sheetId"]
        except Exception: sid=None
    if sid:
        # reuse: clear values + all formatting, then rewrite
        api("POST",f"{SHEETS}/{sid}/values/reconciliation!A:Z:clear",tok,{})
        api("POST",f"{SHEETS}/{sid}:batchUpdate",tok,{"requests":[{"updateCells":{
            "range":{"sheetId":gid},"fields":"userEnteredFormat"}}]})
    else:
        sh=api("POST",SHEETS,tok,{"properties":{"title":title},
            "sheets":[{"properties":{"title":"reconciliation","gridProperties":{"frozenRowCount":1}}}]})
        sid=sh["spreadsheetId"]; gid=sh["sheets"][0]["properties"]["sheetId"]
        open(idfile,"w").write(sid)
    # values
    values=[cols]+[[r[c] for c in cols] for r in rows]
    api("PUT",f"{SHEETS}/{sid}/values/reconciliation!A1?valueInputOption=USER_ENTERED",tok,{"values":values})
    # formatting requests
    reqs=[]
    # header bold + grey
    reqs.append({"repeatCell":{"range":{"sheetId":gid,"startRowIndex":0,"endRowIndex":1},
        "cell":{"userEnteredFormat":{"backgroundColor":{"red":.8,"green":.8,"blue":.8},
        "textFormat":{"bold":True}}},"fields":"userEnteredFormat(backgroundColor,textFormat)"}})
    # row colors by status
    sidx=cols.index('status')
    for i,r in enumerate(rows):
        c=COLOR.get(colorkey(r))
        if not c: continue
        reqs.append({"repeatCell":{"range":{"sheetId":gid,"startRowIndex":i+1,"endRowIndex":i+2},
            "cell":{"userEnteredFormat":{"backgroundColor":{"red":c[0],"green":c[1],"blue":c[2]}}},
            "fields":"userEnteredFormat.backgroundColor"}})
    # autofilter + freeze already + basic column widths
    reqs.append({"setBasicFilter":{"filter":{"range":{"sheetId":gid,"startRowIndex":0,
        "startColumnIndex":0,"endColumnIndex":len(cols)}}}})
    reqs.append({"autoResizeDimensions":{"dimensions":{"sheetId":gid,"dimension":"COLUMNS",
        "startIndex":0,"endIndex":len(cols)}}})
    # override: keep verbose columns narrow (applied after autoResize)
    for name,w in [("email_subject",170),("email_from",150),("notes",420)]:
        if name in cols:
            i=cols.index(name)
            reqs.append({"updateDimensionProperties":{"range":{"sheetId":gid,"dimension":"COLUMNS",
                "startIndex":i,"endIndex":i+1},"properties":{"pixelSize":w},"fields":"pixelSize"}})
    # batch the repeatCell requests (can be large; chunk to be safe)
    for i in range(0,len(reqs),200):
        api("POST",f"{SHEETS}/{sid}:batchUpdate",tok,{"requests":reqs[i:i+200]})
    url=f"https://docs.google.com/spreadsheets/d/{sid}"
    print("✅ Sheet created:",url)

if __name__=="__main__":
    main()
