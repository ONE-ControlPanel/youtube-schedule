#!/usr/bin/env python3
"""
YouTube Analytics API 用のリフレッシュトークンを1回だけ取得するローカル実行スクリプト。

使い方:
  python3 scripts/get_refresh_token.py
  → クライアントID/シークレットを入力するとブラウザが開くので、
    チャンネルのアナリティクス権限があるGoogleアカウントでログインして許可する。
  → 表示されたリフレッシュトークンを GitHub Secrets (YT_OAUTH_REFRESH_TOKEN) に登録する。

このスクリプトは外部に何も送信しません（Googleの認証サーバーとの通信のみ）。
"""
import http.server
import json
import secrets
import threading
import urllib.parse
import urllib.request
import webbrowser

SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly"
PORT = 8765
REDIRECT_URI = f"http://localhost:{PORT}"

auth_code = {}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        if "code" in qs:
            auth_code["code"] = qs["code"][0]
            self.wfile.write("<h2>認証OK！ターミナルに戻ってください。このタブは閉じてOKです。</h2>".encode())
        else:
            self.wfile.write("<h2>認証コードが受け取れませんでした。ターミナルのエラーを確認してください。</h2>".encode())

    def log_message(self, *args):
        pass


def main():
    print("Google CloudのOAuthクライアント（デスクトップアプリ）の情報を入力してください。")
    client_id = input("クライアントID: ").strip()
    client_secret = input("クライアントシークレット: ").strip()

    state = secrets.token_urlsafe(16)
    auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",   # リフレッシュトークンを発行させる
        "prompt": "consent",
        "state": state,
    })

    server = http.server.HTTPServer(("localhost", PORT), Handler)
    threading.Thread(target=server.handle_request, daemon=True).start()

    print("\nブラウザが開きます。チャンネルのアナリティクス権限があるアカウントでログインして「許可」を押してください。")
    print(f"開かない場合はこのURLを手動で開いてください:\n{auth_url}\n")
    webbrowser.open(auth_url)

    # コールバック待ち
    import time
    for _ in range(300):
        if "code" in auth_code:
            break
        time.sleep(1)
    else:
        print("タイムアウトしました。もう一度実行してください。")
        return

    # 認証コードをトークンに交換
    payload = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "code": auth_code["code"],
        "grant_type": "authorization_code",
        "redirect_uri": REDIRECT_URI,
    }).encode()
    with urllib.request.urlopen("https://oauth2.googleapis.com/token", data=payload, timeout=20) as resp:
        tokens = json.loads(resp.read().decode())

    refresh = tokens.get("refresh_token")
    if not refresh:
        print("リフレッシュトークンが返ってきませんでした。もう一度実行してみてください。")
        print(json.dumps(tokens, indent=2))
        return

    print("\n✅ 取得成功！以下の3つをGitHub Secretsに登録してください（値は他人に見せないこと）:\n")
    print("gh secret set YT_OAUTH_CLIENT_ID -R ONE-ControlPanel/youtube-schedule")
    print(f"  → {client_id}")
    print("gh secret set YT_OAUTH_CLIENT_SECRET -R ONE-ControlPanel/youtube-schedule")
    print("  → （入力したクライアントシークレット）")
    print("gh secret set YT_OAUTH_REFRESH_TOKEN -R ONE-ControlPanel/youtube-schedule")
    print(f"  → {refresh}")


if __name__ == "__main__":
    main()
