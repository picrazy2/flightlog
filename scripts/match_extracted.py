#!/usr/bin/env python3
"""Match Gemini-extracted booking legs (/tmp/extracted.json) to Part-B flights.
Writes /tmp/recovered.json keyed by 'date|flight' with per-person cost/pnr/class."""
import csv, json, re
from datetime import datetime

def fnd(s): return re.sub(r'\D','',str(s or ''))

import os
ext=json.load(open('/tmp/extracted.json'))
if os.path.exists('/tmp/extracted2.json'): ext+=json.load(open('/tmp/extracted2.json'))
targets=[r for r in csv.DictReader(open('csv_gmail_outer_join.csv'))
         if r['status']=='CSV_ONLY']

# flatten parsed legs with their booking-level info
legs=[]
for e in ext:
    p=e.get('parsed') or {}
    if not p.get('flights'): continue
    refs=p.get('booking_refs_airline') or []
    pnr=','.join(x.get('pnr','') for x in refs if x.get('pnr')) or (p.get('booking_ref_platform') or '')
    bk={'pnr':pnr,'cost_cash':p.get('cost_cash'),'cost_currency':p.get('cost_currency'),
        'cost_points':p.get('cost_points'),'points_program':p.get('points_program'),
        'platform':p.get('booking_platform'),'owner':p.get('owner_is_traveler'),
        'subj':e.get('subject','')[:60],'mid':e.get('id'),
        'efrom':e.get('from',''),'edate':e.get('date','')}
    for f in p['flights']:
        d=(f.get('flight_date') or '')[:10]
        legs.append({**bk,'air':(f.get('airline_iata') or '').upper(),'fnd':fnd(f.get('flight_number')),
            'dep':(f.get('dep_iata') or '').upper(),'arr':(f.get('arr_iata') or '').upper(),
            'date':d,'cabin':f.get('cabin_class')})

rec={}
for t in targets:
    tfd=fnd(t['flight']); tdep,tarr=t['route'].split('-'); td=datetime.strptime(t['date'],'%Y-%m-%d')
    best=None
    for lg in legs:
        if not lg['date']: continue
        try: dd=abs((datetime.strptime(lg['date'],'%Y-%m-%d')-td).days)
        except: continue
        fn_ok=lg['fnd']==tfd and tfd!=''
        route_ok=lg['dep']==tdep and lg['arr']==tarr
        if (fn_ok or route_ok) and dd<=4:
            owner_rank={True:0, None:1, False:2}.get(lg['owner'],1)
            has_cost=0 if (lg['cost_cash'] or lg['cost_points']) else 1
            score=(owner_rank, 0 if fn_ok else 1, has_cost, dd)
            if best is None or score<best[0]: best=(score,lg)
    if best:
        lg=best[1]
        rec[f"{t['date']}|{t['flight']}"]={'pnr':lg['pnr'],'cost_cash':lg['cost_cash'],
            'cost_currency':lg['cost_currency'],'cost_points':lg['cost_points'],
            'points_program':lg['points_program'],'platform':lg['platform'],'cabin':lg['cabin'],
            'owner':lg['owner'],'src':lg['subj'],'mid':lg['mid'],'efrom':lg['efrom'],'edate':lg['edate']}
json.dump(rec, open('/tmp/recovered.json','w'))
print("Part B targets:",len(targets),"| matched to a Gemini-extracted leg:",len(rec),"\n")
for k,v in sorted(rec.items()):
    cost = (f"{v['cost_cash']} {v['cost_currency']}" if v['cost_cash'] else
            (f"{v['cost_points']} {v['points_program']}" if v['cost_points'] else "-"))
    print(f"  {k:24} owner={str(v['owner'])[:5]:5} {v['cabin'] or '-':18} {cost:16} PNR={v['pnr'] or '-':8} | {v['src']}")
