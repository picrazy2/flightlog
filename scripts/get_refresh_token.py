#!/usr/bin/env python3
"""One-shot: mint a Gmail refresh token and write it (+ client id/secret) into .env.

Usage:  python3 scripts/get_refresh_token.py
Opens your browser, you sign in as the PERSONAL account (alexanderguo99@gmail.com)
and consent. The token is written to .env automatically. Gmail read-only scope only.
"""
import glob, json, os, sys, urllib.parse, urllib.request, webbrowser, http.server, socketserver, threading

SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
ENV = os.path.join(os.path.dirname(__file__), "..", ".env")

def load_client():
    cand = glob.glob(os.path.expanduser("~/Downloads/client_secret_*.json"))
    if not cand:
        sys.exit("No client_secret_*.json found in ~/Downloads")
    d = json.load(open(cand[0]))
    c = d.get("installed") or d.get("web")
    return c["client_id"], c["client_secret"]

def main():
    cid, csecret = load_client()
    code_holder = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(q)
            code_holder["code"] = params.get("code", [None])[0]
            code_holder["error"] = params.get("error", [None])[0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<h2>Done. You can close this tab and return to the terminal.</h2>")
        def log_message(self, *a):  # silence
            pass

    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    port = httpd.server_address[1]
    redirect = f"http://127.0.0.1:{port}"

    auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": cid, "redirect_uri": redirect, "response_type": "code",
        "scope": SCOPE, "access_type": "offline", "prompt": "consent",
    })
    print("\nOpening browser. Sign in as alexanderguo99@gmail.com and click Allow.")
    print("(If you see an 'unverified app' screen: Advanced -> Go to ... (unsafe).)\n")
    print("If the browser didn't open, paste this URL:\n" + auth_url + "\n")
    webbrowser.open(auth_url)

    t = threading.Thread(target=httpd.handle_request)  # serve exactly one request
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

    # merge into .env
    lines = []
    if os.path.exists(ENV):
        lines = [l for l in open(ENV).read().splitlines()
                 if not l.startswith(("GOOGLE_CLIENT_ID=", "GOOGLE_CLIENT_SECRET=", "GOOGLE_REFRESH_TOKEN="))]
    lines += [f"GOOGLE_CLIENT_ID={cid}", f"GOOGLE_CLIENT_SECRET={csecret}", f"GOOGLE_REFRESH_TOKEN={refresh}"]
    open(ENV, "w").write("\n".join(lines) + "\n")
    print("\n✅ Wrote GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN to .env")

if __name__ == "__main__":
    main()
