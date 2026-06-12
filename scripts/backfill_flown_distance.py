#!/usr/bin/env python3
"""Compute flights.flown_distance_mi = length of the recorded track including the
great-circle fillers (gaps) and the stitches to the dep/arr gates. Sum of haversine over
[dep, ...track points, arr] (haversine between gap endpoints = the GC bridge)."""
import json, os, math, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for p in (".env", ".env.local"):
    fp = os.path.join(ROOT, p)
    if os.path.exists(fp):
        for line in open(fp):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1); os.environ.setdefault(k, v)
URL = os.environ["SUPABASE_URL"]; SRK = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": SRK, "Authorization": "Bearer " + SRK, "Content-Type": "application/json"}
def get(u): return json.load(urllib.request.urlopen(urllib.request.Request(URL + "/rest/v1/" + u, headers=H)))
def patch(u, b): urllib.request.urlopen(urllib.request.Request(URL + "/rest/v1/" + u, data=json.dumps(b).encode(), headers={**H, "Prefer": "return=minimal"}, method="PATCH"))

def hav_mi(a, b):  # a,b = [lng,lat]
    R = 3958.7613  # earth radius in statute miles
    lo1, la1, lo2, la2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))

def coords_of(gj):
    if not gj: return []
    if gj.get("type") == "LineString": return gj.get("coordinates", [])
    if gj.get("type") == "MultiLineString": return [c for line in gj.get("coordinates", []) for c in line]
    return []

flights = {f["id"]: f for f in get("v_flights_with_airports?has_track=eq.true&select=id,dep_lat,dep_lng,arr_lat,arr_lng")}
tracks = get("tracks?select=flight_id,geojson")
done = 0
for t in tracks:
    f = flights.get(t["flight_id"])
    if not f: continue
    pts = []
    if f["dep_lng"] is not None and f["dep_lat"] is not None: pts.append([f["dep_lng"], f["dep_lat"]])
    pts += [[c[0], c[1]] for c in coords_of(t["geojson"]) if c and len(c) >= 2]
    if f["arr_lng"] is not None and f["arr_lat"] is not None: pts.append([f["arr_lng"], f["arr_lat"]])
    if len(pts) < 2: continue
    dist = round(sum(hav_mi(pts[i - 1], pts[i]) for i in range(1, len(pts))))
    patch(f"flights?id=eq.{t['flight_id']}", {"flown_distance_mi": dist})
    done += 1
print(f"set flown_distance_mi on {done} flights")
