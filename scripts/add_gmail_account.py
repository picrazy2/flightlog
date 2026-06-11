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


def load_client():
    # MUST be a Desktop-app OAuth client (key "installed") — it allows the random
    # 127.0.0.1 loopback redirect this script uses. A Web client (key "web", used for
    # Supabase Google sign-in) only permits its registered redirect and fails with
    # redirect_uri_mismatch. Also: use the SAME desktop client as the production
    # GOOGLE_CLIENT_ID/SECRET, since watch-gmail refreshes every token with that client.
    cand = glob.glob(os.path.expanduser("~/Downloads/client_secret_*.json"))
    if not cand:
        sys.exit("No client_secret_*.json found in ~/Downloads")
    desktop = []
    for path in cand:
        try:
            d = json.load(open(path))
        except Exception:
            continue
        if "installed" in d:
            desktop.append((path, d["installed"]))
    if not desktop:
        sys.exit(
            "No Desktop-app OAuth client found in ~/Downloads (only Web clients).\n"
            "Create one: Google Cloud Console -> Credentials -> Create OAuth client ID\n"
            "-> Application type: Desktop app -> download its JSON to ~/Downloads.\n"
            "Use the SAME client as your production GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET."
        )
    if len(desktop) > 1:
        print("Multiple Desktop clients found; using:", desktop[0][0])
    c = desktop[0][1]
    return c["client_id"], c["client_secret"]


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

    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    port = httpd.server_address[1]
    redirect = f"http://127.0.0.1:{port}"

    auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": cid, "redirect_uri": redirect, "response_type": "code",
        "scope": SCOPE, "access_type": "offline", "prompt": "consent",
        "login_hint": email,
    })
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
