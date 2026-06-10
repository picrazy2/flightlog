#!/usr/bin/env python3
"""Hand-extract specific older Part-B bookings via sender-targeted search + PDF read."""
import re, sys
from datetime import datetime, timedelta
sys.path.insert(0,'scripts'); import gmail_cli
tok=gmail_cli.access_token()

JOBS=[
 ("HU7962 BOS-PVG 2018","from:(expedia.com OR expediamail.com) after:2018/01/01 before:2018/04/05","PVG|Shanghai|Hainan|HU79|Itinerary|Total|Traveler|Air China"),
 ("DL2310 SFO-SEA 2023 (Alexander)","Flight Receipt ALEXANDER after:2023/06/01 before:2023/08/10","DL2310|SFO|SEA|Total|Base Fare|TICKET|ALEXANDER"),
 ("TP203 LIS-EWR 2024","from:flytap.com OR \"TAP AIR PORTUGAL\" after:2023/06/01 before:2024/02/01","TP 20|LIS|EWR|Total|Fare|Booking|reservation|class"),
 ("CA1644 HRB-PEK 2020","from:(trip.com OR ctrip.com) after:2019/12/01 before:2020/02/01","CA1644|HRB|PEK|Harbin|Total|票价|金额|Class|舱"),
 ("CA1431 PEK-CKG 2023","from:(trip.com OR ctrip.com) (重庆 OR CKG OR Chongqing OR CA1431) after:2023/04/01 before:2023/06/05","CA1431|CKG|重庆|Total|票价|金额|舱"),
 ("CA1502/CA1221 Lanzhou 2023","from:(trip.com OR ctrip.com) (兰州 OR LHW OR CA1502 OR CA1221) after:2023/06/01 before:2023/07/05","CA1502|CA1221|LHW|兰州|Total|票价|金额|舱"),
]
for label,q,kw in JOBS:
    ids=gmail_cli.search_ids(q,tok,12)
    print(f"\n{'='*66}\n{label}  ({len(ids)} hits)")
    pat=re.compile(kw)
    shown=False
    for m in gmail_cli.get_messages(ids,tok,fmt="full",max_chars=16000):
        full=m['body']
        try: full+="\n".join(t for _,t in gmail_cli.get_attachments_text(m['id'],tok))
        except Exception: pass
        if not pat.search(full): continue
        print(f"  >> {m['from'][:30]} | {m['subject'][:48]} | {m['date'][:11]}")
        lines=[t.strip() for t in full.split('\n') if re.search(r'Confirmation|Booking|PNR|Total|Airfare|Fare|Class|Cabin|票价|金额|订单|票号|预订|舱|USD|CNY|GBP|EUR|Passenger|PASSENGER|'+kw,t) and 2<len(t.strip())<90]
        for L in list(dict.fromkeys(lines))[:16]: print('       ',L)
        shown=True; break
    if not shown: print("   (no matching booking email found)")
