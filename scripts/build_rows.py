#!/usr/bin/env python3
"""Assemble the enriched CSV<->Gmail outer join with email provenance + Part-A verdicts.
Writes /tmp/sheet_rows.json and csv_gmail_outer_join.csv."""
import csv, json, re, os
from datetime import datetime
from email.utils import parsedate_to_datetime

def addr_only(s):
    m=re.search(r'<([^>]+)>', s or ''); return (m.group(1) if m else (s or '')).strip()
def date_only(s):
    try: return parsedate_to_datetime(s).strftime('%Y-%m-%d')
    except Exception: return (s or '')[:11]
def hyperlink(subject, link):
    subj=(subject or '').replace('"',"'")
    return f'=HYPERLINK("{link}","{subj}")' if link else subj

# normalize currency + points-program aliases so totals don't fragment
NORMU={'RMB':'CNY','united_mp':'united_mileageplus','MileagePlus':'united_mileageplus',
       'united_pluspoints':'united_pluspoints','virgin_atlantic_flying_club':'virgin_flying_club',
       'virgin_points':'virgin_flying_club','aadvantage':'aa_aadvantage','aeroplan':'ac_aeroplan',
       'chase_ur':'chase_ur','lifemiles':'avianca_lifemiles','avios':'ba_avios','pts':'pts'}
def normu(u): return NORMU.get(u, u)

def derive_category(note):
    n=(note or '').lower()
    if 'parse error' in n: return 'PARSE_ERROR'
    if 'not yours' in n: return 'OTHER_PEOPLE'
    if n.startswith('already cancelled in db'): return 'CANCELLED'
    if 'codeshare' in n or 'duplicate/superseded' in n or 'same pnr' in n or ' dup' in n: return 'DUPLICATE'
    if 'never ticketed' in n or 'farelock' in n: return 'NEVER_TICKETED'
    if 'never booked' in n or 'price quote' in n: return 'NEVER_TICKETED'
    return 'REBOOKED_OR_CANCELLED'

ROOT=os.path.join(os.path.dirname(__file__),"..")
CSV=os.path.expanduser("~/Documents/github/flightlog-legacy-archive/flightlog.csv")
db=json.load(open('/tmp/db_full.json'))
bk={b['id']:b for b in json.load(open('/tmp/bookings.json'))}
hdr=json.load(open('/tmp/email_headers.json'))
recovered=json.load(open('/tmp/recovered.json')) if os.path.exists('/tmp/recovered.json') else {}

# Hand-extracted Part-B bookings (read directly from the email/PDF). per-person.
RECOVERED_MANUAL={
 ("2023-08-05","DL2310"):{"pnr":"H8IO5P","cost_cash":78.90,"cost_currency":"USD","cabin":"basic_economy",
   "mid":"1895c90dcf196d61","src":"Your Flight Receipt - ALEXANDER KENNY GUO 05AUG23","owner":True},
 ("2024-01-19","TP203"):{"pnr":"NWC553","cost_cash":270.0,"cost_currency":"EUR","cabin":"economy",
   "mid":"18a9ff51f5b3a9c3","src":"TAP Booking Confirmation E-mail","owner":True,
   "extra":"270 EUR booking total; per-person uncertain (multi-pax booking)"},
 ("2024-12-19","CA950"):{"pnr":"LifeMiles award","cost_cash":109.8,"cost_currency":"USD","cabin":"economy",
   "mid":"191ebbec2c139023","src":"You've redeemed lifemiles!","owner":True,"extra":"LifeMiles award; $109.80 taxes/fees (miles count not shown)"},
 ("2025-12-25","CZ3104"):{"pnr":"PGJF30","cost_cash":1152.10,"cost_currency":"USD","cabin":"business",
   "mid":"19b32b461d89e70d","src":"Trip.com Flight Booking Confirmed: Beijing-Guangzhou","owner":True,
   "extra":"$1152.10/person ($2304.20 ÷ 2 pax); booking total covers PKX-CAN-SYD (both legs)"},
 ("2025-12-25","CZ325"):{"pnr":"PGJF30","cost_cash":1152.10,"cost_currency":"USD","cabin":"business",
   "mid":"19b32b461d89e70d","src":"Trip.com Flight Booking Confirmed: Beijing-Guangzhou","owner":True,
   "extra":"same PGJF30 booking ($1152.10/person covers both legs)"},
 ("2026-01-06","UO826"):{"pnr":"1680005077","cost_cash":78.16,"cost_currency":"USD","cabin":"economy",
   "mid":"19b3731b959ad636","src":"Booking confirmation with Agoda","owner":True},
 ("2026-01-12","JL45"):{"pnr":"AA award","cost_points":75000,"points_program":"aadvantage","cabin":"business",
   "mid":"198fc528ef497154","src":"Your trip confirmation (HND - CDG)","owner":True,"extra":"75,000 AAdvantage miles + £19.80 taxes"},
}

def partb_category(note):
    n=(note or '')
    if n.startswith('HAS EMAIL (recoverable)'): return 'RECOVERABLE'
    if n.startswith('HAS ITINERARY') or n.startswith('TOUR PKG'): return 'TOUR_PACKAGE'
    if n.startswith('ANCILLARY'): return 'ANCILLARY_ONLY'
    if n.startswith('HAS EMAIL'): return 'HAS_EMAIL_PARTIAL'
    return 'NO_EMAIL'

def fndig(s): return re.sub(r'\D','',str(s or ''))
def pdate(s):
    for f in ('%m/%d/%y','%m/%d/%Y'):
        try: return datetime.strptime(s,f)
        except: pass

# Part A verdicts (category + reason) keyed by (date,flight,route). All 74 => DELETE.
verdict={}
pa=os.path.join(ROOT,'part_a_74_classification.csv')
if os.path.exists(pa):
    for r in csv.DictReader(open(pa)):
        verdict[(r['date'],r['flight'],r['route'])]=(r['category'],r['reason'])

# Deep-dive analysis notes, keyed by (date, flight-label e.g. "UA8851").
# Captures the forensic conclusion for each Part-A (gmail-only) flight.
NOTES={
 # 2014 — flown but pre-CSV
 ("2014-08-24","AA84"):"Flown (PNR ERZKUH) but pre-CSV. Hard start 2015 for CSV parity -> DELETE.",
 ("2014-08-25","AA2314"):"Flown (PNR ERZKUH) but pre-CSV. Hard start 2015 -> DELETE.",
 # 2016 — parents' flights on agent itinerary
 ("2016-07-12","UA1564"):"NOT YOURS: dad's (GUO/PENG) leg on Homsom agent itinerary. Cost attached was family total RMB169,803.",
 ("2016-07-14","UA851"):"NOT YOURS: dad's (GUO/PENG) return on agent itinerary. Your legs ended SFO-BOS 7/10.",
 ("2016-09-08","HU482"):"NOT YOURS: mom's (YING/KUI) flight on agent itinerary.",
 # 2017
 ("2017-09-22","UA700"):"FareLock HOLD (FDQSBG), never ticketed. Flew this PEK routing in OCT instead (in CSV). 'FareLock Expiration' Sep 21.",
 ("2017-09-22","UA89"):"FareLock HOLD (FDQSBG), never ticketed. Flew UA89 EWR-PEK Oct 7 instead (in CSV).",
 ("2017-09-24","UA808"):"FareLock HOLD (FDQSBG), never ticketed. Flew UA808 PEK-IAD Oct 10 instead (in CSV).",
 ("2017-09-25","UA352"):"FareLock HOLD (FDQSBG), never ticketed. Flew UA352 IAD-BOS Oct 10/11 instead (in CSV).",
 ("2017-12-20","DL438"):"Google Flights price quote you emailed yourself; never booked. Cancun trip cancelled (Expedia hotel/activity cancellations Nov 14 2017).",
 ("2017-12-22","DL789"):"Google Flights price quote; never booked. Cancun trip cancelled.",
 # 2019 — rebooked returns
 ("2019-11-24","UA8851"):"E343VN original return LHR-MUC-BOS; flew LHR-FRA-BOS (LH921/LH422 Dec 2) instead. No cancel email (silent).",
 ("2019-11-24","UA8902"):"E343VN original return MUC-BOS; flew LH422 FRA-BOS instead. Silent rebooking.",
 ("2019-12-28","UA1123"):"J84GEL original Cape Town return; flew CPT-DXB-PEK (Emirates EK771/EK308) to Beijing instead. No cancel email.",
 ("2019-12-29","UA2310"):"J84GEL original return EWR-BOS; not flown (went to PEK via Emirates). Silent.",
 # 2020 — COVID
 ("2020-01-27","UA890"):"AJR5EK CANCELLED (Jan 14 'cancellation complete'). COVID; flew PEK-SFO-BOS (UA889/UA1213) Jan 26.",
 ("2020-01-28","UA1796"):"AJR5EK CANCELLED Jan 14. Flew UA889/UA1213 Jan 26 instead.",
 ("2020-01-28","UA1990"):"AJR5EK CANCELLED Jan 14. Flew UA889/UA1213 Jan 26 instead.",
 ("2020-01-28","UA890"):"AM7K95 superseded COVID rebooking of AJR5EK; re-ticketed Jan 23. Flew UA889/UA1213 Jan 26.",
 ("2020-01-29","UA1912"):"AM7K95 superseded rebooking; not flown. Silent (re-ticketed).",
 ("2020-01-29","UA641"):"AM7K95 superseded rebooking; not flown. Silent.",
 ("2020-03-10","UA1078"):"M0DKXM CANCELLED next day (Feb 13). Tampa day-trip scrapped.",
 ("2020-03-10","UA1421"):"M0DKXM CANCELLED Feb 13. Not flown.",
 ("2020-03-10","UA352"):"M0DKXM CANCELLED Feb 13. Not flown.",
 ("2020-03-24","4O580"):"Interjet D9N89J CANCELLED, refunded to voucher (Apr 3 2020). COVID border closure (Peru).",
 ("2020-05-19","UA2394"):"EENYJY CANCELLED Apr 24 2020 (COVID). HK trip not flown.",
 ("2020-05-19","UA179"):"EENYJY CANCELLED Apr 24 2020. EWR-HKG not flown.",
 ("2020-10-14","UA511"):"CEYYDW re-ticketed; flew BOS-SFO direct (UA531) instead of via IAD. Silent.",
 ("2020-10-14","UA2435"):"CEYYDW re-ticketed; flew UA531 BOS-SFO + SFO-ORD-BOS instead. Silent.",
 ("2020-10-16","UA1666"):"CEZB3C reservation CANCELLED Sep 24 2020.",
 ("2020-12-02","UA383"):"D5F5PT schedule-change version (HNL-DEN-BOS); flew HNL-IAH-BOS (UA252/UA2426) Nov 30 instead.",
 ("2020-12-02","UA385"):"D5F5PT schedule-change version; superseded. Flew UA252/UA2426.",
 ("2020-12-02","UA534"):"D5F5PT version (HNL-LAX-SFO); superseded by HNL-IAH-BOS (UA252/UA2426).",
 ("2020-12-02","UA501"):"D5F5PT version (LAX-SFO); superseded. Not flown.",
 # 2021
 ("2021-04-30","UA3552"):"C1YCP4 re-ticketed; flew St Thomas/Utah trips instead. Silent.",
 ("2021-05-04","UA235"):"C1YCP4 re-ticketed; EWR-BOS not flown as booked. Silent.",
 ("2021-05-28","TK2010"):"Schedule change (THY T56YDW); flew IST-NAV (TK2004) — same region (Cappadocia), diff airport.",
 ("2021-06-15","UA348"):"PX4EN5 schedule change; flew OGG-EWR-BOS (UA43/UA697) instead of via ORD.",
 ("2021-06-15","UA1185"):"PX4EN5 schedule change; flew via EWR (UA697) not ORD. Not flown.",
 ("2021-06-29","UA477"):"I0LJVM re-ticketed; flew BOS-IAD-SFO (UA1470/UA2435) instead of direct. Silent.",
 # 2022
 ("2022-01-04","UA1853"):"M5RKS7 re-ticketed -> LGN3PW; flew PUJ-IAH-AUS then AUS-SFO. Dup IAH-SFO capture.",
 ("2022-01-04","UA2621"):"M5RKS7 duplicate IAH-SFO option; not flown. Silent.",
 ("2022-02-05","UA1485"):"LF11CR CANCELLED (Jan 12 2022); flew SFO-IAH-SJO (UA1484/UA1096) Feb 5.",
 ("2022-02-05","UA1135"):"LF11CR CANCELLED Jan 12; flew via IAH not ORD. Not flown.",
 ("2022-02-26","UA1485"):"JZGY6Q superseded version of Costa Rica trip; flew via IAH Feb 5. Silent.",
 ("2022-02-26","UA1135"):"JZGY6Q superseded version; not flown. Silent.",
 ("2022-10-19","LH1497"):"Rebooked return; flew LIS-MUC-SFO (LH1781/LH458) instead of via FRA. Silent.",
 ("2022-10-19","LH454"):"Rebooked return FRA-SFO; flew MUC-SFO (LH458) instead. Silent.",
 # 2023
 ("2023-01-01","JQ208"):"PARSE ERROR: this Jetstar email (PNR QNYFTQ) is actually 3K552 SGN-SIN Nov 27 2022 (Vietnam->Singapore, w/ Rachel Tee) — already flown & in CSV. JQ208 MEL-SIN Jan 2023 was hallucinated by the parser. DELETE.",
 ("2023-01-08","JQ207"):"PARSE ERROR: same Jetstar email (QNYFTQ = 3K552 SGN-SIN Nov 2022). JQ207 SIN-MEL Jan 2023 is a parser hallucination, never existed. DELETE.",
 ("2023-01-02","UA599"):"NOT YOURS: sister (GUO/COURTNEY) + mom (YING/KUI), PNR L797R2. You flew UA1538 TPA-SFO Jan 2.",
 ("2023-03-04","UA412"):"Rebooked; flew EWR-MEX (UA1065) Mar 3 instead of SFO-MEX direct.",
 ("2023-03-26","UA901"):"Rebooked; flew SFO-LAX-LHR (UA1200/UA923) Mar 24-25 instead of SFO-LHR direct.",
 ("2023-03-30","UA2385"):"F4D2ZN re-ticketed; flew EWR-SEA (UA1989) Mar 31 instead of SFO-SEA. Silent.",
 ("2023-04-06","UA1216"):"LPKJDX CANCELLED Feb 2023; flew OAK-SLC (DL3879) Apr 5 instead.",
 ("2023-05-11","BR27"):"CPF7T7 CANCELLED Feb 4 2023 ('cancellation complete'). May Asia trip rebooked; flew SFO-ICN (UA805) May 11.",
 ("2023-05-12","BR716"):"CPJV0J CANCELLED Feb 4-8 2023. Flew ICN-PEK (OZ335) May 14 instead of TPE-PEK.",
 ("2023-05-14","BR716"):"C83397 CANCELLED Feb 2023 (dup rebooking of CPJV0J). Flew ICN-PEK (OZ335).",
 ("2023-05-13","NH931"):"M1JXTQ CANCELLED Feb 8-9 2023 ('important message re M1JXTQ'). Flew SFO-ICN-PEK instead of via NRT/SZX.",
 ("2023-05-13","CA1398"):"M1JXTQ CANCELLED Feb 2023. Flew ICN-PEK (OZ335) May 14.",
 ("2023-09-25","CA856"):"Air China LHR-PEK (booked Aug 2023, via Amadeus); NOT flown — flew LHR-SFO (UA939) Sep 25. Cancelled/changed Beijing plan.",
 ("2023-09-25","CA855"):"Air China PEK-LHR; not flown (flew LHR-SFO UA939). Cancelled/changed Beijing plan.",
 ("2023-09-28","TK290"):"Rebooked; flew SFO-HKG (UA877) Sep 30 instead of SFO-IST-PEK.",
 ("2023-09-29","TK88"):"Rebooked; flew SFO-HKG (UA877) instead. Not flown.",
 # 2024
 ("2024-01-09","FR9301"):"Rebooked; flew AMM-PFO (FR3405) + PFO-STN (FR3134) Jan 8-9 instead of via Sofia.",
 ("2024-01-09","FR2691"):"Rebooked; flew PFO-STN (FR3134) instead of SOF-STN. Not flown.",
 ("2024-02-28","CA1687"):"Rebooked; flew PEK-YNJ (CA1613) Feb 29 — changed destination Dandong->Yanji.",
 ("2024-03-31","CA1883"):"PV806S schedule change Feb 8 2024 -> re-ticketed CM9S9P; flew UA889 PEK-SFO direct Apr 1.",
 ("2024-04-01","UA858"):"PV806S (PVG-SFO) superseded; flew UA889 PEK-SFO direct Apr 1.",
 ("2024-04-11","UA855"):"LY3PZM schedule-change version of Peru return; flew LIM-EWR-LHR (UA887/UA110) Apr 10-11 instead.",
 ("2024-04-11","UA880"):"LY3PZM (IAH-LHR) superseded; flew EWR-LHR (UA110) Apr 11.",
 ("2024-04-12","UA855"):"LY3PZM dup schedule-change version; flew via EWR. Not flown.",
 ("2024-04-12","UA1256"):"LY3PZM (IAH-DEN) superseded version; not flown.",
 ("2024-04-12","UA27"):"LY3PZM (DEN-LHR) superseded; flew EWR-LHR (UA110) instead.",
 # Codeshare / duplicate / rebooking extras surfaced by the outer join
 ("2019-01-06","AC8073"):"Codeshare/duplicate of flown AC57 DXB-YYZ Jan 6 2019 (from a United booking; operated by Air Canada). You flew AC57 (in CSV). DELETE this dup.",
 ("2023-06-27","CA8680"):"Same PNR (FFMSJ5) as flown CA8680 PKX-PVG Jun 25 — schedule-changed/re-issued. This 6/27 copy is the superseded duplicate. DELETE.",
 ("2023-09-19","AF1281"):"Air France e-ticket; NOT flown — you flew BA326 (dep 20:35, operated by British Airways) same day; AF1281 (dep 17:35) was the superseded/rebooked-away flight. DELETE.",
 ("2023-12-09","CA855"):"Rebooked; flew PEK-WAW-LHR (LO92/LO279) Dec 8 on LOT instead. Not flown — DELETE.",
}

VERDICT_OVERRIDE={}

# Deep dive of the recovery-added (post 2024-06-28) gmail-only flights:
# (date,flight) -> (verdict, category, note). Future trips & real CSV gaps are KEEP.
POST2024={
 ("2026-09-11","JD432"):("KEEP","REAL_FUTURE","Real future booking LHR-TAO (Sep 2026), beyond the CSV's 2026-06-28 end. Booked, not yet logged in CSV."),
 ("2026-09-28","9C7205"):("KEEP","REAL_FUTURE","Real future booking PKX-CJU (Sep 2026), beyond CSV end."),
 ("2026-10-02","TW165"):("KEEP","REAL_FUTURE","Real future booking CJU-SIN (Oct 2026), beyond CSV end."),
 ("2026-10-04","SQ308"):("KEEP","REAL_FUTURE","Real future booking SIN-LHR (Oct 2026), beyond CSV end."),
 ("2026-01-10","HX234"):("DELETE","DUPLICATE","Within-booking duplicate: the same booking created HX234 HKG-PVG (matched to your flown CSV flight) AND HKG-SHA (SHA=PVG=Shanghai). This is the dup copy."),
 ("2025-12-12","BA3654"):("DELETE","DUPLICATE","Iberia-issued codeshare of flown BA3270 LCY-MAD (CSV, same day). Duplicate."),
 ("2024-12-19","CA848"):("DELETE","REBOOKED_OR_CANCELLED","PXHE0Q LGW-PVG (Avianca-booked Sep 2024, w/ Emily Zhai); you flew LGW-MXP-PEK (U28313/CA950) per CSV. Rebooked-away."),
 ("2024-12-20","CA1508"):("DELETE","REBOOKED_OR_CANCELLED","PXHE0Q SHA-PEK leg; you flew via Milan (CA950 MXP-PEK). Not flown."),
 ("2025-12-25","CA402"):("DELETE","REBOOKED_OR_CANCELLED","Rebooked; you flew CZ3104 PKX-CAN + CZ325 CAN-SYD to Sydney (CSV) instead of ICN-TFU-SYD. Not flown."),
 ("2025-12-25","3U3891"):("DELETE","REBOOKED_OR_CANCELLED","Rebooked; you flew CZ325 CAN-SYD (CSV) instead of TFU-SYD. Not flown."),
 ("2026-01-05","CA1883"):("DELETE","REBOOKED_OR_CANCELLED","Rebooked; you flew the CSV routing (not PEK-PVG Jan 5). Trip.com booking superseded — not flown."),
 ("2026-01-06","9C6977"):("DELETE","REBOOKED_OR_CANCELLED","Rebooked; you flew UO826 HKG-OKA (CSV) instead of PVG-OKA. Not flown."),
 ("2026-01-11","MM210"):("DELETE","REBOOKED_OR_CANCELLED","Rebooked; you flew the CSV Japan routing (JL86 PVG-HND), not OKA-KIX. Not flown."),
 ("2026-01-11","9C6566"):("DELETE","REBOOKED_OR_CANCELLED","Rebooked; you flew CSV routing (JL86 PVG-HND), not KIX-PVG. Not flown."),
 ("2026-01-11","6J26"):("DELETE","REBOOKED_OR_CANCELLED","Rebooked; you flew JL86 PVG-HND (CSV), not OKA-HND. Not flown."),
}

# Part B (CSV-only, no matched email): what a thorough Gmail search found.
# HAS EMAIL = recoverable (pipeline missed it); NONE = CSV is sole source.
PARTB_NOTES={
 ("2015-01-03","HU481"):"NO EMAIL: searched flight#/Hainan/PEK-BOS ±1yr — none. CSV sole source.",
 ("2015-03-08","UA1711"):"HAS EMAIL (recoverable): UA eTicket NGV3VV, forwarded by dad (pguo8888) Mar 19 2015. Missed: family forward.",
 ("2015-03-08","UA89"):"HAS EMAIL (recoverable): UA eTicket NGV3VV (dad forward, Mar 2015). Missed: family forward.",
 ("2015-03-19","UA88"):"HAS EMAIL (recoverable): UA eTicket NGV3VV (dad forward). Missed: family forward.",
 ("2015-03-19","UA1409"):"HAS EMAIL (recoverable): UA eTicket NGV3VV (dad forward). Missed: family forward.",
 ("2015-12-20","HU7179"):"NO EMAIL: Hainan Sanya, none found. CSV sole source.",
 ("2015-12-24","HU7080"):"NO EMAIL: Hainan Sanya, none found. CSV sole source.",
 ("2016-03-16","HU7215"):"HAS ITINERARY (tour pkg): Guilin/Chengdu/Dunhuang 9-day group tour, itinerary+pricing from mom (应葵). No airline e-ticket. Borderline recoverable.",
 ("2016-03-19","CZ6709"):"HAS ITINERARY (tour pkg): same Guilin/Chengdu/Dunhuang tour (应葵). No airline e-ticket.",
 ("2016-03-21","3U8569"):"HAS ITINERARY (tour pkg): same China group tour (应葵). No airline e-ticket.",
 ("2016-03-24","MU2117"):"HAS ITINERARY (tour pkg): same China group tour (应葵). No airline e-ticket.",
 ("2016-12-29","QF551"):"TOUR PKG: Splendour Tailormade 'Sydney Tour' (agent). No airline e-ticket. CSV sole source.",
 ("2017-06-08","CZ6974"):"HAS EMAIL (recoverable): Tongcheng (同程/ly.com) e-ticket '电子客票行程单英文版' May 30 2017. Missed: Chinese OTA/PDF.",
 ("2017-06-09","CZ6613"):"HAS EMAIL (recoverable): Tongcheng (同程) e-ticket May 30 2017. Missed: Chinese OTA/PDF.",
 ("2017-06-10","CZ6620"):"HAS EMAIL (recoverable): Tongcheng (同程) e-ticket May 30 2017. Missed: Chinese OTA/PDF.",
 ("2017-06-15","CZ6911"):"HAS EMAIL (recoverable): Tongcheng (同程) e-ticket May 30 2017. Missed: Chinese OTA/PDF.",
 ("2017-07-24","MU2949"):"HAS EMAIL (recoverable): eTicket M843QF forwarded by mom (kuiying2012) Jul 27 2017. Missed: family forward.",
 ("2017-07-25","MU2950"):"HAS EMAIL (recoverable): eTicket M843QF (mom forward, Jul 2017). Missed: family forward.",
 ("2017-11-22","DL753"):"NO booking email (only Delta check-in/marketing). CSV sole source.",
 ("2017-11-26","DL1145"):"NO booking email (only Delta check-in). CSV sole source.",
 ("2017-12-30","SQ807"):"NO EMAIL: Singapore Airlines PEK-SIN, none found. CSV sole source.",
 ("2018-03-22","HU7962"):"HAS EMAIL (recoverable): Expedia travel confirmation Mar 28 2018 (BOS-PVG). Missed: Expedia subject not in clauses.",
 ("2018-03-29","HU7961"):"HAS EMAIL (recoverable): Expedia travel confirmation Mar 28 2018. Missed: Expedia.",
 ("2018-04-02","WW125"):"HAS EMAIL: WOW air boarding pass KEF-BOS (Apr 1 2018). Boarding pass only (no fare).",
 ("2018-06-02","MF8150"):"NO EMAIL: Xiamen/Hangzhou, none found. CSV sole source.",
 ("2018-06-02","HU7178"):"NO EMAIL: Hainan HGH-PEK, none found. CSV sole source.",
 ("2019-03-22","DY7150"):"NO EMAIL: Norwegian BOS-CDG, none found (defunct airline). CSV sole source.",
 ("2019-03-31","DY7149"):"NO EMAIL: Norwegian CDG-BOS, none found. CSV sole source.",
 ("2019-06-01","3U8818"):"HAS EMAIL (recoverable): 'Fwd: Flight Booking Confirmed' May 25 2019 (Lijiang-Kunming). Missed: forward.",
 ("2019-06-01","MU2570"):"HAS EMAIL (recoverable): 'Fwd: Flight Booking Confirmed' May 25 2019. Missed: forward.",
 ("2019-09-26","UA2394"):"ANCILLARY ONLY: only Wi-Fi/trip-survey emails; no booking receipt found. CSV sole source.",
 ("2019-11-21","UA2400"):"ANCILLARY ONLY: only Wi-Fi/survey emails; no booking receipt. CSV sole source.",
 ("2019-11-23","UA768"):"ANCILLARY ONLY: only Wi-Fi/survey emails; no booking receipt. CSV sole source.",
 ("2020-01-22","CA1644"):"HAS EMAIL: Air China online check-in boarding card Jan 18 2020. Boarding pass only.",
 ("2020-03-15","DL2667"):"HAS EMAIL (recoverable): Delta 'Your Flight Receipt - ALEXANDER KENNY GUO 15MAR20' Mar 13 2020. Missed: 'receipt' subject not in clauses.",
 ("2023-05-11","UA805"):"HAS EMAIL (complex): reservation M85E9W canceled then reinstated & flown; Asiana ICN-PEK boarding pass exists.",
 ("2023-05-26","CA1431"):"HAS EMAIL: Air China flight-change notice (国航航班变更通知) May 30 2023; booking likely via Ctrip. Partly recoverable.",
 ("2023-07-02","CA1502"):"HAS EMAIL: Air China change notice; Lanzhou trip (Hyatt confirms). Booking likely Ctrip. Partly recoverable.",
 ("2023-07-02","CA1221"):"HAS EMAIL: Air China change notice; Lanzhou leg. Booking likely Ctrip. Partly recoverable.",
 ("2023-08-05","DL2310"):"HAS EMAIL (recoverable): Delta 'Your Flight Receipt' (group: Jingquan Sun, Alan Perez 05AUG23; yours likely too). Missed: 'receipt' subject + others' names.",
 ("2023-11-13","CA109"):"NO EMAIL: Air China PEK-HKG, none found. CSV sole source.",
 ("2023-11-15","CA116"):"NO EMAIL: Air China HKG-PEK, none found. CSV sole source.",
 ("2023-11-20","JD5251"):"NO EMAIL: Beijing Capital PKX-XMN, none found. CSV sole source.",
 ("2023-11-23","CZ8876"):"NO EMAIL: China Southern XMN-PKX, none found. CSV sole source.",
 ("2023-12-08","LO92"):"HAS EMAIL (recoverable): LOT booking LTOIVO (LOT.com e-ticket + Amadeus 'Booking confirmation LTOIVO' Oct 19 2023; LifeMiles redemption). Missed: LOT/Amadeus.",
 ("2023-12-08","LO279"):"HAS EMAIL (recoverable): LOT LTOIVO (LO 279, LOT.com/Amadeus). Missed: LOT/Amadeus.",
 ("2023-12-16","LO526"):"HAS EMAIL (recoverable): LOT LTOIVO (LO 526 PRG-WAW, LOT.com/Amadeus). Missed: LOT/Amadeus.",
 ("2023-12-25","HU7479"):"NO EMAIL: Hainan Sanya, none found. CSV sole source.",
 ("2023-12-28","HU7280"):"NO EMAIL: Hainan Sanya, none found. CSV sole source.",
 ("2024-01-02","MS956"):"HAS EMAIL (recoverable): EgyptAir 'YOUR ELECTRONIC DOCUMENT(S)' Sep 29 2023 (PEK-CAI). Missed: EgyptAir subject.",
 ("2024-01-19","TP203"):"HAS EMAIL (recoverable): TAP Air Portugal 'Booking Confirmation E-mail' Sep 16 2023 (LIS-EWR). Missed: cap/not-run.",
 ("2024-03-06","CA1901"):"HAS EMAIL (recoverable): Air China app '出票成功确认' Feb 16 2024 (Xinjiang trip). Missed: Air China app + cap.",
 ("2024-03-06","CZ6613"):"HAS EMAIL (recoverable): part of Xinjiang trip booked via Air China app (出票成功 Feb 16 2024).",
 ("2024-03-10","CZ6614"):"HAS EMAIL (recoverable): Xinjiang trip, Air China app (出票成功 Feb 2024).",
 ("2024-03-10","CZ6909"):"HAS EMAIL (recoverable): Xinjiang trip, Air China app (出票成功 Feb 2024).",
 ("2024-04-01","UA889"):"ANCILLARY ONLY: only Wi-Fi email; no booking receipt. CSV sole source.",
 ("2024-04-10","LA2610"):"HAS EMAIL: LATAM boarding pass 'Tarjeta de embarque' (CUZ-LIM Apr 2024). Boarding pass only.",
 ("2024-05-03","CA925"):"HAS EMAIL (recoverable): Ctrip 携程 '行程确认单（附件：英文出行单）' Apr 26 2024 + Air China 出票成功. Missed: cap/Ctrip PDF.",
 ("2024-05-03","NH8"):"HAS EMAIL: ANA check-in notification (NRT-SFO May 2024); part of a booking. Partly recoverable.",
 ("2024-05-10","VS20"):"HAS EMAIL (recoverable): Virgin Atlantic e-Ticket CPWH3V Apr 26 2024 (SFO-LHR). Missed: cap/not-run.",
 ("2024-05-14","CA856"):"HAS EMAIL (recoverable): Air China app '出票成功确认' + Amadeus confirmation (LHR-PEK). Missed: cap/Air China app.",
}

def email_for(booking_id):
    b=bk.get(booking_id) or {}
    mid=(b.get('raw_email') or {}).get('message_id')
    h=hdr.get(mid) if mid else None
    pnr=''
    refs=b.get('booking_refs_airline') or []
    if refs: pnr=','.join(x.get('pnr','') for x in refs if x.get('pnr'))
    if not pnr and b.get('booking_ref_platform'): pnr=b['booking_ref_platform']
    cparts=[]
    if b.get('cost_cash'): cparts.append(f"{b['cost_cash']} {normu(b.get('cost_currency') or '')}".strip())
    if b.get('cost_points'): cparts.append(f"{b['cost_points']} {normu(b.get('points_program') or 'pts')}".strip())
    cost=' + '.join(cparts)
    link=f"https://mail.google.com/mail/u/0/#all/{mid}" if mid else ''
    return {
        'pnr':pnr,'cost':cost,
        'subject':hyperlink((h or {}).get('subject',''), link),
        'from':addr_only((h or {}).get('from','')),
        'sent':date_only((h or {}).get('date','')),
    }

dbf=[]
for r in db:
    iso=(r['sched_dep'] or '')[:10]
    if not iso: continue
    e=email_for(r['booking_id'])
    dbf.append({'date':datetime.strptime(iso,'%Y-%m-%d'),'fnd':fndig(r.get('flight_number')),
        'dep':r.get('dep_iata'),'arr':r.get('arr_iata'),'fn':(r.get('airline_iata') or '')+str(r.get('flight_number')),
        'status':r.get('status'),'cabin':r.get('cabin_class') or '','e':e,'used':False})

csvrows=[]
for row in csv.DictReader(open(CSV)):
    d=pdate(row['Date'].strip()) if row['Date'].strip() else None
    if not d: continue
    csvrows.append({'date':d,'fnd':fndig(row['Flight']),'dep':row['Dep Airport'].strip(),
        'arr':row['Arr Airport'].strip(),'fn':row['Flight'].strip(),'airline':row['Airline'].strip(),'cls':row['Class'].strip()})

def match(a,b,tol=10):
    if abs((a['date']-b['date']).days)>tol: return False
    return (a['dep']==b['dep'] and a['arr']==b['arr']) or (a['fnd']==b['fnd'] and a['fnd']!='')

DBMAX=datetime(2024,6,28)
COLS=['date','flight','route','status','verdict','category',
      'csv_airline','csv_class','gmail_status','gmail_cabin','gmail_cost',
      'booking_pnr','email_subject','email_from','email_sent','notes']
rows=[]
def emit(**k): rows.append({c:k.get(c,'') for c in COLS})

for c in csvrows:
    cfnd=fndig(c['fn'])
    cands=[d for d in dbf if match(c,d)]
    # Prefer unused, then a same-flight-number match over a route-only match
    # (avoids pairing a CSV flight with its codeshare twin), then closest date.
    cands.sort(key=lambda d:(d['used'], 0 if (d['fnd']==cfnd and cfnd) else 1,
                             abs((d['date']-c['date']).days)))
    if cands:
        d=cands[0]; d['used']=True; e=d['e']
        emit(date=str(c['date'].date()),flight=c['fn'],route=f"{c['dep']}-{c['arr']}",status='MATCHED',
             verdict='KEEP',csv_airline=c['airline'],csv_class=c['cls'],gmail_status=d['status'],
             gmail_cabin=d['cabin'],gmail_cost=e['cost'],booking_pnr=e['pnr'],email_subject=e['subject'],
             email_from=e['from'],email_sent=e['sent'])
    else:
        cdate=str(c['date'].date())
        st='CSV_ONLY'
        pbn=PARTB_NOTES.get((cdate,c['fn']),'')
        if pbn: pcat=partb_category(pbn)
        elif c['date']>DBMAX:
            pcat='PENDING_SEARCH'
            pbn='Flown after the original backfill cap; booking email not yet searched — investigate (Part B).'
        else: pcat='NO_EMAIL'
        gcost=gcabin=gpnr=esub=efrom=esent=''
        rv=RECOVERED_MANUAL.get((cdate,c['fn'])) or recovered.get(f"{cdate}|{c['fn']}")
        if rv:
            _cp=[]
            if rv.get('cost_cash'): _cp.append(f"{rv['cost_cash']} {normu(rv.get('cost_currency') or '')}".strip())
            if rv.get('cost_points'): _cp.append(f"{rv['cost_points']} {normu(rv.get('points_program') or 'pts')}".strip())
            gcost=' + '.join(_cp)
            gcabin=rv.get('cabin') or ''; gpnr=rv.get('pnr') or ''
            mid=rv.get('mid')
            esub=hyperlink(rv.get('src',''), f"https://mail.google.com/mail/u/0/#all/{mid}" if mid else '')
            efrom=addr_only(rv.get('efrom','')); esent=date_only(rv.get('edate',''))
            pcat='RECOVERED'
            tag=f"RECOVERED: {gcost or '(no cost)'}, {gcabin or 'cabin?'}, PNR {gpnr or '-'} (per-person)."
            if rv.get('extra'): tag+=" "+rv['extra']
            if rv.get('owner') is False: tag+=" [owner_is_traveler=FALSE — verify this is yours]"
            pbn=(pbn+" | "+tag).strip(" |") if pbn else tag
        # Honesty pass: the high-recall sender+date chase found no booking email
        # actually containing these flights — the original "recoverable" tags were
        # false matches. Relabel so the sheet isn't misleading.
        if not rv and pcat in ('RECOVERABLE','PENDING_SEARCH'):
            pcat='NO_EMAIL_FOUND'
            pbn=(pbn+" | Thorough sender+date search found no booking email containing this flight (original 'recoverable' tag was a false match).").strip(" |")
        emit(date=cdate,flight=c['fn'],route=f"{c['dep']}-{c['arr']}",status=st,category=pcat,
             verdict='KEEP',notes=pbn,csv_airline=c['airline'],csv_class=c['cls'],
             gmail_cabin=gcabin,gmail_cost=gcost,booking_pnr=gpnr,
             email_subject=esub,email_from=efrom,email_sent=esent)

for d in dbf:
    if d['used']: continue
    e=d['e']
    dstr=str(d['date'].date())
    key=(dstr,d['fn'],f"{d['dep']}-{d['arr']}")
    cat,reason=verdict.get(key,('',''))
    note=NOTES.get((dstr,d['fn']),''); vd=None
    if (dstr,d['fn']) in POST2024:                      # recovery-era deep-dive decision
        vd,cat,note=POST2024[(dstr,d['fn'])]
    elif not note:
        if d['status']=='cancelled':
            note="Already cancelled in DB (cancellation detected) — trip history, never in flown CSV."
        else:
            # only a CSV flight on the SAME route within ±10 days counts as a supersede
            same=[c for c in csvrows if c['dep']==d['dep'] and c['arr']==d['arr']
                  and abs((c['date']-d['date']).days)<=10]
            if same:
                near=min(same,key=lambda c:abs((c['date']-d['date']).days))
                dd=abs((near['date']-d['date']).days)
                note=(f"Duplicate/superseded: you flew {near['fn']} {d['dep']}-{d['arr']} on "
                      f"{near['date'].date()} (in CSV, {dd}d away). This booking version not flown — DELETE.")
            elif dstr>'2026-06-28':   # beyond CSV's coverage end -> real future booking
                vd='KEEP'; cat='REAL_FUTURE'
                note="Real future booking (beyond the CSV's 2026-06-28 end); booked, not yet logged in CSV."
            elif dstr>'2024-06-28':   # recovery-era, past, not in CSV -> you flew the CSV version
                vd='DELETE'; cat='REBOOKED_OR_CANCELLED'
                note="Not in CSV; you flew the CSV version (CSV is source of truth). Rebooked/superseded — not flown."
            else:
                note="No same-route CSV flight near this date — superseded/not-flown (Part A deep-dive: all pre-2024 gmail-only are non-flown)."
    if vd is None: vd=VERDICT_OVERRIDE.get((dstr,d['fn']),'DELETE')
    if reason and reason not in note:  # fold any unique classification text into notes
        note=(note+" | "+reason).strip(" |")
    if not cat: cat=derive_category(note)  # every DELETE must carry a category
    if cat=='NOT_A_BOOKING': cat='NEVER_TICKETED'  # merge per user: a quote was never ticketed
    emit(date=dstr,flight=d['fn'],route=f"{d['dep']}-{d['arr']}",status='GMAIL_ONLY',
         verdict=vd,category=cat,notes=note,gmail_status=d['status'],gmail_cabin=d['cabin'],
         gmail_cost=e['cost'],booking_pnr=e['pnr'],email_subject=e['subject'],email_from=e['from'],
         email_sent=e['sent'])

rows.sort(key=lambda r:(r['date'],r['status']))
json.dump({'cols':COLS,'rows':rows},open('/tmp/sheet_rows.json','w'))
out=os.path.join(ROOT,'csv_gmail_outer_join.csv')
with open(out,'w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=COLS); w.writeheader(); w.writerows(rows)
from collections import Counter
print('rows:',len(rows),dict(Counter(r['status'] for r in rows)))
print('with email subject:',sum(1 for r in rows if r['email_subject']))
print('wrote',out)
