#!/usr/bin/env python3
"""Mint a Gmail refresh token for ANOTHER person and register them for auto-import.

Usage:  python3 scripts/add_gmail_account.py <user_id> "<Name>" <email>
  e.g.  python3 scripts/add_gmail_account.py emily "Emily Zhai" emszhai98@gmail.com

Opens a browser; the person signs in as THEIR Google account and clicks Allow
(gmail.readonly scope only). Unlike get_refresh_token.py this does NOT touch .env
(so it won't clobber the primary owner's token). It prints a ready-to-run SQL insert
for public.gmail_accounts — paste it into the Supabase SQL editor.

Prereq: the same client_secret_*.json in ~/Downloads used by get_refresh_token.py,
and a `users` row for <user_id> already inserted.
"""
import glob, json, os, sys, urllib.parse, urllib.request, webbrowser, http.server, socketserver, threading

SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
# Fixed loopback port so the redirect URI is stable and can be registered on the OAuth
# client (a Web client rejects un-registered redirects -> redirect_uri_mismatch).
PORT = 8765
REDIRECT = f"http://127.0.0.1:{PORT}"
ENV = os.path.join(os.path.dirname(__file__), "..", ".env")


def production_client_id():
    # The token must be minted with the SAME client watch-gmail uses to refresh it.
    if os.environ.get("GOOGLE_CLIENT_ID"):
        return os.environ["GOOGLE_CLIENT_ID"]
    if os.path.exists(ENV):
        for line in open(ENV):
            if line.startswith("GOOGLE_CLIENT_ID="):
                return line.split("=", 1)[1].strip()
    return None


def load_client():
    cand = glob.glob(os.path.expanduser("~/Downloads/client_secret_*.json"))
    if not cand:
        sys.exit("No client_secret_*.json found in ~/Downloads")
    clients = []
    for path in cand:
        try:
            d = json.load(open(path))
        except Exception:
            continue
        c = d.get("installed") or d.get("web")
        if c:
            clients.append((path, c))
    if not clients:
        sys.exit("No usable OAuth client JSON in ~/Downloads")

    # Pick the one matching the production GOOGLE_CLIENT_ID so the token refreshes in
    # watch-gmail. Without that match a token still mints but later fails to refresh.
    want = production_client_id()
    if want:
        for path, c in clients:
            if c["client_id"] == want:
                return c["client_id"], c["client_secret"]
        sys.exit(
            f"None of the client_secret_*.json in ~/Downloads match the production\n"
            f"GOOGLE_CLIENT_ID ({want[:28]}...). Download THAT client's JSON\n"
            "(Google Cloud Console -> Credentials -> the client -> Download JSON)."
        )
    if len(clients) > 1:
        sys.exit(
            "Multiple OAuth clients in ~/Downloads and no GOOGLE_CLIENT_ID to disambiguate.\n"
            "Set GOOGLE_CLIENT_ID=<production client id> and re-run, or leave only the\n"
            "correct client_secret_*.json in ~/Downloads."
        )
    return clients[0][1]["client_id"], clients[0][1]["client_secret"]


def main():
    if len(sys.argv) != 4:
        sys.exit("Usage: add_gmail_account.py <user_id> \"<Name>\" <email>")
    user_id, name, email = sys.argv[1], sys.argv[2], sys.argv[3]
    cid, csecret = load_client()
    code_holder = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            code_holder["code"] = params.get("code", [None])[0]
            code_holder["error"] = params.get("error", [None])[0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<h2>Done. Close this tab and return to the terminal.</h2>")

        def log_message(self, *a):
            pass

    try:
        httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        sys.exit(f"Port {PORT} is in use; close whatever's using it and re-run.")
    redirect = REDIRECT

    auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": cid, "redirect_uri": redirect, "response_type": "code",
        "scope": SCOPE, "access_type": "offline", "prompt": "consent",
        "login_hint": email,
    })
    print(f"\n⚠️  First, register this redirect URI on the OAuth client in Google Cloud")
    print(f"    Console (Credentials -> your client -> Authorized redirect URIs):")
    print(f"      {redirect}\n")
    print(f"\nOpening browser. Sign in as {email} ({name}) and click Allow.")
    print("(If you see an 'unverified app' screen: Advanced -> Go to ... (unsafe).)\n")
    print("If the browser didn't open, paste this URL:\n" + auth_url + "\n")
    webbrowser.open(auth_url)

    t = threading.Thread(target=httpd.handle_request)
    t.start(); t.join(timeout=300)

    if code_holder.get("error"):
        sys.exit("OAuth error: " + code_holder["error"])
    code = code_holder.get("code")
    if not code:
        sys.exit("No authorization code received (timed out?).")

    data = urllib.parse.urlencode({
        "code": code, "client_id": cid, "client_secret": csecret,
        "redirect_uri": redirect, "grant_type": "authorization_code",
    }).encode()
    resp = json.load(urllib.request.urlopen("https://oauth2.googleapis.com/token", data=data))
    refresh = resp.get("refresh_token")
    if not refresh:
        sys.exit("No refresh_token in response: " + json.dumps(resp))

    tok = refresh.replace("'", "''")
    print("\n✅ Got a refresh token. Run this in the Supabase SQL editor:\n")
    print(
        "insert into public.gmail_accounts (user_id, refresh_token, email, name) values\n"
        f"  ('{user_id}', '{tok}', '{email}', '{name}')\n"
        "on conflict (user_id) do update set\n"
        "  refresh_token = excluded.refresh_token, email = excluded.email,\n"
        "  name = excluded.name, enabled = true;\n"
    )


if __name__ == "__main__":
    main()
