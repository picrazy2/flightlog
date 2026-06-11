#!/usr/bin/env python3
"""Generate emilys_flights.csv from the App-in-the-Air passport screenshots.

Screenshots give date + airline/flight + route only (no times), so scheduled times
are placeholders ("00:00") to be filled by AeroAPI enrichment after import. The 4
appended future flights are Alex's upcoming non-Turkish legs (shared with Emily) and
DO carry real local times (converted from the stored UTC in his log).
"""
import csv

PLACEHOLDER = "00:00"  # times unknown from screenshots; enrich after import

# (date, airline_iata, flight, dep, arr) — times placeholdered
emily = [
    # 2020 (15)
    ("2020-01-19", "CA", "CA1611", "PEK", "HRB"),
    ("2020-01-22", "CA", "CA1644", "HRB", "PEK"),
    ("2020-01-25", "AC", "AC32", "PEK", "YYZ"),
    ("2020-01-26", "WS", "WS3600", "YYZ", "BOS"),   # was read "WR" (defunct Royal Tongan) -> WestJet WS
    ("2020-03-15", "DL", "DL2667", "BOS", "DTW"),
    ("2020-05-20", "DL", "DL929", "DTW", "LAX"),
    ("2020-07-05", "UA", "UA2304", "LAX", "EWR"),
    ("2020-07-05", "UA", "UA3423", "EWR", "BOS"),
    ("2020-08-23", "UA", "UA647", "BOS", "DEN"),
    ("2020-08-23", "UA", "UA2451", "DEN", "ANC"),
    ("2020-08-29", "UA", "UA1104", "ANC", "DEN"),
    ("2020-08-29", "UA", "UA217", "DEN", "BOS"),
    ("2020-10-14", "UA", "UA531", "BOS", "SFO"),
    ("2020-10-15", "UA", "UA215", "SFO", "LAX"),
    ("2020-10-15", "NZ", "NZ1", "LAX", "AKL"),
    # 2021 (16)
    ("2021-01-17", "NZ", "NZ6", "AKL", "LAX"),
    ("2021-01-19", "B6", "B61088", "LAX", "BOS"),
    ("2021-03-12", "B6", "B6261", "BOS", "SJU"),
    ("2021-03-14", "B6", "B6262", "SJU", "BOS"),
    ("2021-04-17", "DL", "DL829", "DTW", "BOS"),
    ("2021-05-27", "DL", "DL2127", "BOS", "DTW"),
    ("2021-06-06", "UA", "UA267", "BOS", "DEN"),
    ("2021-06-09", "UA", "UA1736", "DEN", "OGG"),
    ("2021-06-14", "UA", "UA43", "OGG", "EWR"),
    ("2021-06-15", "UA", "UA697", "EWR", "BOS"),
    ("2021-06-29", "UA", "UA1470", "BOS", "IAD"),
    ("2021-06-29", "UA", "UA2435", "IAD", "SFO"),
    ("2021-09-04", "UA", "UA1242", "SFO", "PVR"),
    ("2021-09-06", "UA", "UA1243", "PVR", "SFO"),
    ("2021-12-23", "B6", "B61516", "SFO", "JFK"),
    ("2021-12-24", "B6", "B6869", "JFK", "PUJ"),
    # 2022 (17)
    ("2022-01-02", "CM", "CM242", "PUJ", "PTY"),
    ("2022-01-03", "CM", "CM382", "PTY", "SFO"),
    ("2022-04-01", "UA", "UA4710", "SFO", "SLC"),
    ("2022-04-05", "UA", "UA5736", "SLC", "SFO"),
    ("2022-04-12", "UA", "UA2341", "SFO", "LAS"),
    ("2022-04-13", "UA", "UA1728", "LAS", "SFO"),
    ("2022-05-18", "UA", "UA1723", "SFO", "KOA"),
    ("2022-05-23", "UA", "UA1724", "KOA", "SFO"),
    ("2022-07-06", "UA", "UA520", "SFO", "JFK"),
    ("2022-07-10", "UA", "UA496", "EWR", "SFO"),
    ("2022-07-29", "UA", "UA1449", "SFO", "EWR"),
    ("2022-08-02", "UA", "UA1257", "EWR", "SFO"),
    ("2022-10-07", "AS", "AS3431", "SJC", "PSP"),
    ("2022-10-10", "AS", "AS3428", "PSP", "SJC"),
    ("2022-12-06", "NZ", "NZ7", "SFO", "AKL"),
    ("2022-12-18", "NZ", "NZ527", "AKL", "CHC"),
    ("2022-12-24", "NZ", "NZ1266", "ZQN", "AKL"),
    # 2023 (28)
    ("2023-01-05", "NZ", "NZ8", "AKL", "SFO"),
    ("2023-02-04", "AS", "AS2011", "SFO", "PHX"),
    ("2023-02-05", "UA", "UA1893", "PHX", "SFO"),
    ("2023-03-02", "UA", "UA2059", "SFO", "EWR"),
    ("2023-03-03", "UA", "UA1065", "EWR", "MEX"),
    ("2023-03-06", "Y4", "Y45200", "MEX", "OAK"),
    ("2023-03-24", "UA", "UA1200", "SFO", "LAX"),
    ("2023-03-25", "UA", "UA923", "LAX", "LHR"),
    ("2023-03-29", "UA", "UA921", "LHR", "EWR"),
    ("2023-03-31", "UA", "UA1989", "EWR", "SEA"),
    ("2023-04-01", "AS", "AS1042", "SEA", "SFO"),
    ("2023-04-05", "DL", "DL3879", "OAK", "SLC"),
    ("2023-04-09", "DL", "DL2924", "SLC", "OAK"),
    ("2023-04-22", "UA", "UA2237", "SFO", "AUS"),
    ("2023-04-25", "UA", "UA1401", "AUS", "SFO"),
    ("2023-05-11", "UA", "UA805", "SFO", "ICN"),
    ("2023-05-14", "OZ", "OZ335", "ICN", "PEK"),
    ("2023-05-15", "OZ", "OZ335", "ICN", "PEK"),   # two OZ335 consecutive days? verify
    ("2023-05-26", "CA", "CA1431", "PEK", "CKG"),
    ("2023-06-27", "CA", "CA8680", "PKX", "PVG"),
    ("2023-07-02", "CA", "CA1502", "SHA", "PEK"),
    ("2023-07-09", "ZH", "ZH9236", "XNN", "SZX"),
    ("2023-07-10", "CX", "CX111", "HKG", "SYD"),
    ("2023-08-12", "UA", "UA870", "SYD", "SFO"),
    ("2023-09-18", "AF", "AF85", "SFO", "CDG"),
    ("2023-12-13", "FR", "FR1374", "STN", "PRG"),
    ("2023-12-16", "LO", "LO526", "PRG", "WAW"),
    ("2023-12-17", "LO", "LO91", "WAW", "PEK"),
    # 2024 (12)
    ("2024-01-04", "TK", "TK89", "PEK", "IST"),
    ("2024-01-04", "TK", "TK1979", "IST", "LHR"),
    ("2024-03-13", "FR", "FR176", "STN", "BER"),
    ("2024-03-18", "FR", "FR144", "BER", "STN"),
    ("2024-06-26", "UA", "UA939", "LHR", "SFO"),
    ("2024-06-28", "HA", "HA47", "OAK", "HNL"),
    ("2024-07-01", "HA", "HA343", "HNL", "LIH"),
    ("2024-07-03", "UA", "UA1746", "LIH", "SFO"),
    ("2024-07-10", "UA", "UA930", "SFO", "LHR"),
    ("2024-12-17", "U2", "U28313", "LGW", "MXP"),
    ("2024-12-19", "CA", "CA950", "MXP", "PEK"),
    ("2024-12-30", "A6", "A67778", "PKX", "CSX"),   # A6? verify
    # 2025 (21)
    ("2025-01-05", "CX", "CX500", "HKG", "NRT"),
    ("2025-01-09", "CA", "CA184", "HND", "PEK"),
    ("2025-01-09", "CA", "CA937", "PEK", "LHR"),
    ("2025-02-20", "U2", "U27858", "SEN", "AMS"),
    ("2025-02-23", "BA", "BA8456", "AMS", "LCY"),
    ("2025-03-20", "W4", "W46902", "LGW", "NAP"),
    ("2025-03-25", "FR", "FR1833", "NAP", "STN"),
    ("2025-04-09", "RK", "RK8528", "STN", "OZZ"),   # RK? verify (Ryanair?)
    ("2025-04-15", "FR", "FR961", "AGA", "TFS"),
    ("2025-04-16", "UA", "UA249", "TFS", "EWR"),
    ("2025-04-27", "VS", "VS158", "BOS", "LHR"),
    ("2025-05-30", "BA", "BA754", "LHR", "BSL"),
    ("2025-06-03", "U2", "U28484", "BSL", "LGW"),
    ("2025-08-13", "VY", "VY6617", "LGW", "AGP"),
    ("2025-08-16", "W9", "W95724", "AGP", "LGW"),
    ("2025-11-07", "FR", "FR6325", "STN", "VLC"),
    ("2025-11-10", "FR", "FR6324", "VLC", "STN"),
    ("2025-12-12", "BA", "BA3270", "LCY", "MAD"),
    ("2025-12-13", "CA", "CA898", "MAD", "PEK"),
    ("2025-12-25", "CZ", "CZ3104", "PKX", "CAN"),
    ("2025-12-25", "CZ", "CZ325", "CAN", "SYD"),
    # 2026 (11)
    ("2026-01-01", "VA", "VA884", "SYD", "MEL"),
    ("2026-01-04", "JQ", "JQ534", "MEL", "SYD"),
    ("2026-01-06", "VN", "VN772", "SYD", "SGN"),
    ("2026-01-06", "VN", "VN220", "SGN", "HAN"),
    ("2026-01-07", "VN", "VN55", "HAN", "LHR"),
    ("2026-03-05", "FR", "FR9142", "STN", "FAO"),
    ("2026-03-10", "U2", "U28534", "FAO", "LGW"),
    ("2026-04-02", "FR", "FR168", "STN", "TRS"),
    ("2026-04-07", "FR", "FR169", "TRS", "STN"),
    ("2026-04-28", "VS", "VS11", "LHR", "BOS"),
    ("2026-05-09", "VS", "VS46", "JFK", "LHR"),
]

# Alex's upcoming non-Turkish legs (shared with Emily) — real local times from his log.
# (date, airline, flight, dep, arr, dep_local, arr_local)
future = [
    ("2026-09-11", "JD", "JD432", "LHR", "TAO", "22:05", "16:10"),  # arr +1 day (auto)
    ("2026-09-28", "9C", "9C7205", "PKX", "CJU", "17:55", "21:35"),
    ("2026-10-02", "TW", "TW165", "CJU", "SIN", "19:40", "00:45"),  # arr +1 day (auto)
    ("2026-10-04", "SQ", "SQ308", "SIN", "LHR", "09:00", "15:45"),
]

HEADER = [
    "Date", "Scheduled Dep Time (Local)", "Scheduled Arr Time (Local)",
    "Airline", "Flight", "Dep Airport", "Arr Airport",
    "Class", "Aircraft", "Registration",
]

with open("emilys_flights.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(HEADER)
    for date, airline, flight, dep, arr in emily:
        w.writerow([date, PLACEHOLDER, PLACEHOLDER, airline, flight, dep, arr, "", "", ""])
    for date, airline, flight, dep, arr, dt, at in future:
        w.writerow([date, dt, at, airline, flight, dep, arr, "", "", ""])

print(f"Wrote emilys_flights.csv: {len(emily)} screenshot flights + {len(future)} future = {len(emily)+len(future)} rows")
