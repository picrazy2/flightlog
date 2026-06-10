#!/usr/bin/env python3
"""Fast local Gmail querying for the flight-log work. Gmail read-only, no Gemini.

Reads GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN from .env. Uses the Gmail batch
endpoint to fetch up to 100 messages per HTTP request.

CLI:
  python3 scripts/gmail_cli.py search "from:trip.com after:2024/01/01" [maxResults]
  python3 scripts/gmail_cli.py get <msgid> [<msgid> ...]          # full text bodies
  python3 scripts/gmail_cli.py subjects <msgid> [<msgid> ...]     # headers only

Importable:
  from gmail_cli import access_token, search_ids, get_messages
"""
import json, os, re, sys, urllib.parse, urllib.request, uuid

ROOT = os.path.join(os.path.dirname(__file__), "..")
BASE = "https://gmail.googleapis.com/gmail/v1/users/me"

def _env():
    env = {}
    p = os.path.join(ROOT, ".env")
    for line in open(p):
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1); env[k] = v
    return env

def access_token():
    e = _env()
    data = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "client_id": e["GOOGLE_CLIENT_ID"], "client_secret": e["GOOGLE_CLIENT_SECRET"],
        "refresh_token": e["GOOGLE_REFRESH_TOKEN"],
    }).encode()
    r = json.load(urllib.request.urlopen("https://oauth2.googleapis.com/token", data=data))
    return r["access_token"]

def search_ids(query, token=None, max_results=100):
    token = token or access_token()
    ids, page = [], None
    while len(ids) < max_results:
        q = {"q": query, "maxResults": min(500, max_results - len(ids))}
        if page: q["pageToken"] = page
        req = urllib.request.Request(f"{BASE}/messages?{urllib.parse.urlencode(q)}",
                                     headers={"Authorization": f"Bearer {token}"})
        d = json.load(urllib.request.urlopen(req))
        ids += [m["id"] for m in d.get("messages", [])]
        page = d.get("nextPageToken")
        if not page: break
    return ids[:max_results]

def _b64url(s):
    try:
        import base64
        return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4)).decode("utf-8", "replace")
    except Exception:
        return ""

def _html_to_text(h):
    h = re.sub(r"<style[\s\S]*?</style>", " ", h, flags=re.I)
    h = re.sub(r"<script[\s\S]*?</script>", " ", h, flags=re.I)
    h = re.sub(r"<[^>]+>", " ", h)
    for a, b in [("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&#39;", "'"), ("&quot;", '"')]:
        h = h.replace(a, b)
    return re.sub(r"[ \t]{2,}", " ", re.sub(r"\n{3,}", "\n\n", h)).strip()

def _extract_body(payload):
    plain, html = [], []
    def walk(p):
        if not p: return
        mt = p.get("mimeType", "")
        data = (p.get("body") or {}).get("data")
        if mt == "text/plain" and data: plain.append(_b64url(data))
        elif mt == "text/html" and data: html.append(_b64url(data))
        for part in p.get("parts", []) or []: walk(part)
    walk(payload)
    p = "\n".join(plain).strip(); h = _html_to_text("\n".join(html)) if html else ""
    return p if len(p) >= len(h) else h

def _batch_once(chunk, token, fmt):
    """Send one batch; return (results_by_index, throttled_indexes)."""
    boundary = "batch_" + uuid.uuid4().hex
    parts = []
    for j, mid in enumerate(chunk):
        if fmt == "full":
            path = f"/gmail/v1/users/me/messages/{mid}?format=full"
        else:
            path = f"/gmail/v1/users/me/messages/{mid}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date"
        parts.append(f"--{boundary}\r\nContent-Type: application/http\r\nContent-ID: <item{j}>\r\n\r\nGET {path}\r\n")
    body = ("".join(parts) + f"--{boundary}--").encode()
    req = urllib.request.Request("https://gmail.googleapis.com/batch/gmail/v1",
        data=body, headers={"Authorization": f"Bearer {token}",
                            "Content-Type": f"multipart/mixed; boundary={boundary}"})
    resp = urllib.request.urlopen(req).read().decode("utf-8", "replace")
    results, throttled = {}, []
    for blob in re.split(r"--batch[\w-]*", resp):
        cid = re.search(r"Content-ID:\s*<response-item(\d+)>", blob)
        if not cid: continue
        idx = int(cid.group(1))
        status = re.search(r"HTTP/\d\.\d\s+(\d+)", blob)
        code = int(status.group(1)) if status else 0
        m = re.search(r"\{[\s\S]*\}", blob)
        msg = None
        if m:
            try: msg = json.loads(m.group(0))
            except Exception: msg = None
        if code == 200 and msg and "payload" in msg:
            results[idx] = msg
        elif code in (429, 403, 500, 503):
            throttled.append(idx)
    return results, throttled

def get_messages(ids, token=None, fmt="full", max_chars=14000, chunk_size=40):
    """Batch-fetch messages with per-item retry on rate limits. Returns dicts."""
    import time
    token = token or access_token()
    out = []
    for i in range(0, len(ids), chunk_size):
        chunk = ids[i:i + chunk_size]
        pending = list(range(len(chunk)))
        delay = 1.0
        for attempt in range(6):
            sub = [chunk[k] for k in pending]
            results, throttled = _batch_once(sub, token, fmt)
            done = []
            for local_idx, msg in results.items():
                h = {x["name"].lower(): x["value"] for x in msg["payload"].get("headers", [])}
                rec = {"id": msg.get("id"), "subject": h.get("subject", ""),
                       "from": h.get("from", ""), "date": h.get("date", "")}
                if fmt == "full":
                    rec["body"] = _extract_body(msg["payload"])[:max_chars]
                out.append(rec)
                done.append(pending[local_idx])
            pending = [p for p in pending if p not in done]
            if not pending: break
            time.sleep(delay); delay = min(delay * 2, 16)
    return out

def get_attachments_text(msg_id, token=None):
    """Fetch a message's PDF attachments and return their extracted text (pypdf)."""
    import base64, io
    token = token or access_token()
    req = urllib.request.Request(f"{BASE}/messages/{msg_id}?format=full",
        headers={"Authorization": f"Bearer {token}"})
    m = json.load(urllib.request.urlopen(req))
    out = []
    def walk(p):
        if not p: return
        fn = p.get("filename", "")
        att = (p.get("body") or {}).get("attachmentId")
        if att and (fn.lower().endswith(".pdf") or "pdf" in (p.get("mimeType") or "")):
            ar = urllib.request.Request(f"{BASE}/messages/{msg_id}/attachments/{att}",
                headers={"Authorization": f"Bearer {token}"})
            data = json.load(urllib.request.urlopen(ar)).get("data", "")
            raw = base64.urlsafe_b64decode(data + "==")
            try:
                import pypdf
                txt = "\n".join(pg.extract_text() or "" for pg in pypdf.PdfReader(io.BytesIO(raw)).pages)
            except Exception as e:
                txt = f"(pdf parse failed: {e})"
            out.append((fn, txt))
        for x in p.get("parts", []) or []: walk(x)
    walk(m["payload"])
    return out

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    tok = access_token()
    if cmd == "search":
        q = sys.argv[2]; n = int(sys.argv[3]) if len(sys.argv) > 3 else 50
        ids = search_ids(q, tok, n)
        for r in get_messages(ids, tok, fmt="meta"):
            print(f"{r['date'][:16]:17} | {r['from'][:30]:30} | {r['subject'][:60]}  [{r['id']}]")
        print(f"\n{len(ids)} message(s)")
    elif cmd in ("get", "subjects"):
        ids = sys.argv[2:]
        recs = get_messages(ids, tok, fmt="full" if cmd == "get" else "meta")
        print(json.dumps(recs, indent=1, ensure_ascii=False))
    else:
        print(__doc__)
