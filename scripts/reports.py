#!/usr/bin/env python3
import csv, json
from collections import Counter
from datetime import datetime

rows=list(csv.DictReader(open('csv_gmail_outer_join.csv')))
db=json.load(open('/tmp/db_full.json'))
bk={b['id']:b for b in json.load(open('/tmp/bookings_ts.json'))}
CUT="2026-06-08T12:45:00"   # per-person prompt deployed (13:45 +0100)

def norm_class(s):
    s=(s or '').lower()
    if not s: return ''
    if 'first' in s: return 'first'
    if 'business' in s or s in ('lie_flat_business','j','c','d','i'): return 'business'
    if 'premium' in s: return 'premium_economy'
    if 'economy' in s or 'recliner' in s or s in ('y','e','basic_economy'): return 'economy' if 'recliner' not in s else 'first'
    return s

# ---------- REPORT 1: CSV vs Gmail CLASS (matched flights) ----------
print("="*70)
print("REPORT 1 — CLASS: CSV (truth) vs Gmail-captured cabin (MATCHED flights)")
print("="*70)
matched=[r for r in rows if r['status']=='MATCHED']
both=[r for r in matched if r['csv_class'] and r['gmail_cabin']]
agree=[r for r in both if norm_class(r['csv_class'])==norm_class(r['gmail_cabin'])]
mismatch=[r for r in both if norm_class(r['csv_class'])!=norm_class(r['gmail_cabin'])]
print(f"matched flights: {len(matched)} | with both classes: {len(both)} | agree: {len(agree)} | MISMATCH: {len(mismatch)}")
print(f"matched with NO gmail cabin: {sum(1 for r in matched if not r['gmail_cabin'])}")
print("\nMismatches (csv_class  vs  gmail_cabin):")
for r in mismatch:
    print(f"  {r['date']} {r['flight']:8} {r['route']:9} CSV='{r['csv_class']}'  GMAIL='{r['gmail_cabin']}'")

# ---------- REPORT 2: Gmail COST + PNR ----------
print("\n"+"="*70)
print("REPORT 2 — COST & PNR (flown flights = MATCHED + CSV_ONLY)")
print("="*70)
flown=[r for r in rows if r['status'] in ('MATCHED','CSV_ONLY')]
has_cost=[r for r in flown if r['gmail_cost']]
has_pnr=[r for r in flown if r['booking_pnr']]
print(f"flown flights: {len(flown)} | with cost: {len(has_cost)} ({100*len(has_cost)//len(flown)}%) | with PNR: {len(has_pnr)} ({100*len(has_pnr)//len(flown)}%)")
# currency mix
print("cost currency mix:", Counter((r['gmail_cost'].split()[-1] if r['gmail_cost'] and not r['gmail_cost'][0].isalpha() else (r['gmail_cost'].split()[-1] if r['gmail_cost'] else '')) for r in has_cost))

# Flag costs captured BEFORE per-person rule (booking.created_at < CUT)
# map flight (date,flight) -> booking created_at via db
fb={}
for f in db:
    iso=(f['sched_dep'] or '')[:10]; lab=(f.get('airline_iata') or '')+str(f.get('flight_number'))
    b=bk.get(f['booking_id'])
    if b: fb[(iso,lab)]=b
pre=[]; post=[]
for r in has_cost:
    b=fb.get((r['date'],r['flight']))
    ca=(b or {}).get('created_at','')
    if ca and ca[:19]<CUT: pre.append((r,ca))
    else: post.append(r)
print(f"\nCosts captured BEFORE per-person rule (may be multi-passenger totals): {len(pre)}")
print(f"Costs captured AFTER (per-person correct) or manual: {len(post)}")
print("\n--- PRE-rule costs to re-verify (sample, sorted desc by amount) ---")
def amt(r):
    try: return float(r['gmail_cost'].split()[0])
    except: return 0
for r,ca in sorted(pre,key=lambda x:-amt(x[0]))[:25]:
    print(f"  {r['date']} {r['flight']:8} {r['route']:9} {r['gmail_cost']:14} PNR={r['booking_pnr'] or '-':8} (booked {ca[:10]})")
