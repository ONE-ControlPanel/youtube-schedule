#!/usr/bin/env python3
"""
サムネ納品URL（ギガファイル便）から画像をダウンロードして
data/thumbs/{monthKey}_{no}.jpg にキャッシュするスクリプト。
GitHub Actions から30分ごとに実行される（notify-events.yml）。

ギガファイル便はブラウザから直接画像表示できない（Cookie必須）ため、
サーバー側で取得してリポジトリに縮小キャッシュを置き、
ダッシュボードはそれを最優先で表示する。ギガファイルの保存期限が
切れてもキャッシュは残る。

必要な環境変数（未設定ならスキップ）:
  FIREBASE_BOT_EMAIL    - ダッシュボードのログインアカウント
  FIREBASE_BOT_PASSWORD - そのパスワード
"""
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar

FIREBASE_API_KEY = "AIzaSyD05FRO-9NKoCksKLxdR24_sheXXGmE3HM"
PROJECT_ID = "schedule-fc04f"
THUMB_DIR = "data/thumbs"
THUMB_WIDTH = 480


def firebase_login(email: str, password: str) -> str:
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FIREBASE_API_KEY}"
    payload = json.dumps({"email": email, "password": password, "returnSecureToken": True}).encode()
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())["idToken"]


def list_edits(id_token: str) -> list:
    """Firestoreのeditsコレクションを全件取得する"""
    docs = []
    page_token = ""
    while True:
        url = (f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}"
               f"/databases/(default)/documents/edits?pageSize=300")
        if page_token:
            url += f"&pageToken={urllib.parse.quote(page_token)}"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {id_token}"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
        docs.extend(data.get("documents", []))
        page_token = data.get("nextPageToken", "")
        if not page_token:
            break
    return docs


def field_str(doc: dict, name: str) -> str:
    f = doc.get("fields", {}).get(name, {})
    return f.get("stringValue", "")


def field_bool(doc: dict, name: str) -> bool:
    return bool(doc.get("fields", {}).get(name, {}).get("booleanValue", False))


def download_gigafile(url: str) -> bytes | None:
    """ギガファイル便のページを訪問してCookieを取得し、ファイル本体をダウンロードする"""
    m = re.match(r"https://(\d+\.gigafile\.nu)/([\w-]+)", url)
    if not m:
        return None
    host, file_id = m.group(1), m.group(2)
    jar = CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    opener.addheaders = [("User-Agent", "Mozilla/5.0")]
    try:
        opener.open(f"https://{host}/{file_id}", timeout=30).read()
        with opener.open(f"https://{host}/download.php?file={file_id}", timeout=60) as resp:
            data = resp.read(30 * 1024 * 1024)  # 上限30MB
        return data
    except Exception as e:
        print(f"  WARNING: ダウンロード失敗 {url[:50]}: {e}", file=sys.stderr)
        return None


def save_thumb(raw: bytes, out_path: str) -> bool:
    """画像なら縮小してJPEG保存。画像以外（動画・zip等）はスキップ"""
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(raw))
        img = img.convert("RGB")
        if img.width > THUMB_WIDTH:
            img = img.resize((THUMB_WIDTH, int(img.height * THUMB_WIDTH / img.width)))
        img.save(out_path, "JPEG", quality=82)
        return True
    except Exception as e:
        print(f"  スキップ（画像ではない）: {e}", file=sys.stderr)
        return False


def main():
    email = os.environ.get("FIREBASE_BOT_EMAIL", "").strip()
    password = os.environ.get("FIREBASE_BOT_PASSWORD", "").strip()
    if not email or not password:
        print("FIREBASE_BOT_EMAIL / FIREBASE_BOT_PASSWORD が未設定のためスキップします。")
        sys.exit(0)

    id_token = firebase_login(email, password)
    docs = list_edits(id_token)
    print(f"Firestore: {len(docs)} 件のドキュメントを取得")

    os.makedirs(THUMB_DIR, exist_ok=True)
    created = 0
    for doc in docs:
        doc_id = doc["name"].rsplit("/", 1)[-1]
        if "__month" in doc_id or field_bool(doc, "_deleted") or not field_bool(doc, "_full"):
            continue
        thumb_url = field_str(doc, "thumbUrl")
        if "gigafile.nu" not in thumb_url:
            continue
        out_path = f"{THUMB_DIR}/{doc_id}.jpg"
        if os.path.exists(out_path):
            continue
        print(f"取得中: {doc_id} ← {thumb_url[:50]}")
        raw = download_gigafile(thumb_url)
        if raw and save_thumb(raw, out_path):
            created += 1
            print(f"  ✓ キャッシュ作成: {out_path}")

    print(f"完了: 新規キャッシュ {created} 件")


if __name__ == "__main__":
    main()
