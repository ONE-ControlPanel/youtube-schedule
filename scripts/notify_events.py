#!/usr/bin/env python3
"""
予約投稿・動画公開を検知して ChatWork に自動報告するスクリプト。
GitHub Actions から30分ごとに自動実行される（notify-events.yml）。

検知方法:
  予約完了 - 管理スプレッドシートの「予約投稿したか」列が TRUE になった行を検知
  投稿完了 - YouTubeチャンネルの公開フィード(RSS)に新しい動画が現れたら検知

通知済みの記録は data/notify_state.json に保存する（初回実行時は
既存の予約・公開分を通知せずに記録だけして、以降の新規分から通知する）。

必要な環境変数:
  CHATWORK_API_TOKEN  - ChatWork API トークン
  CHATWORK_ROOM_ID    - 送信先ルームID（省略時は 399892175）
  YOUTUBE_CHANNEL_ID  - 対象チャンネルID（公開フィード監視用）
"""
import csv
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from update_csv import discover_month_sheets, SPREADSHEET_BASE

STATE_PATH = "data/notify_state.json"
DEFAULT_ROOM_ID = "399892175"
JST = timezone(timedelta(hours=9))


def http_get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8")


def post_to_chatwork(message: str):
    token = os.environ["CHATWORK_API_TOKEN"]
    room = os.environ.get("CHATWORK_ROOM_ID") or DEFAULT_ROOM_ID
    payload = urllib.parse.urlencode({"body": message}).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.chatwork.com/v2/rooms/{room}/messages",
        data=payload, method="POST",
        headers={
            "X-ChatWorkToken": token,
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0",
        })
    with urllib.request.urlopen(req, timeout=20) as resp:
        print(f"  ChatWork送信: HTTP {resp.status}")


def norm_header(cell: str) -> str:
    """ヘッダーセルの改行・空白を除去して列名を正規化する"""
    return re.sub(r"\s+", "", cell or "")


def parse_month_day(datestr: str) -> str:
    """'2026/7/12' や '07/12' → '7/12'"""
    parts = re.findall(r"\d+", datestr or "")
    if len(parts) >= 2:
        return f"{int(parts[-2])}/{int(parts[-1])}"
    return datestr or "?"


def check_reserved(state: dict, first_run: bool) -> list:
    """スプレッドシート全月から「予約投稿したか=TRUE」の行を検知する"""
    sheets = discover_month_sheets()
    if not sheets:
        print("WARNING: シート一覧の取得に失敗（予約チェックをスキップ）", file=sys.stderr)
        return []

    notified = []
    known = set(state.setdefault("reserved", []))
    for s in sheets:
        url = f"{SPREADSHEET_BASE}/pub?gid={s['gid']}&single=true&output=csv"
        try:
            text = http_get(url)
        except Exception as e:
            print(f"WARNING: {s['key']} のCSV取得失敗: {e}", file=sys.stderr)
            continue

        rows = list(csv.reader(io.StringIO(text)))
        # ヘッダー行（「No」列がある行）を探す
        header_idx = next((i for i, r in enumerate(rows)
                           if any(norm_header(c) == "No" for c in r)), None)
        if header_idx is None:
            continue
        header = [norm_header(c) for c in rows[header_idx]]

        def col(name):
            return header.index(name) if name in header else None

        i_no = col("No")
        i_date = col("投稿予定日")
        i_changed = col("投稿日変更")
        i_reserved = col("予約投稿したか")
        i_link = col("YouTubeリンク")
        i_title = col("動画タイトル")
        if i_reserved is None:
            continue

        for r in rows[header_idx + 1:]:
            def get(i):
                return r[i].strip() if i is not None and i < len(r) else ""
            if get(i_reserved).upper() != "TRUE":
                continue
            no = get(i_no)
            title = get(i_title)
            if not no and not title:
                continue
            rid = f"{s['key']}:{no}:{title[:30]}"
            if rid in known:
                continue
            known.add(rid)
            if first_run:
                continue  # 初回は記録のみ（過去分を通知しない）
            date_disp = parse_month_day(get(i_changed) or get(i_date))
            link = get(i_link) or "（リンク未記入）"
            msg = f"【報告】\n{date_disp}分の投稿動画が予約完了！\n予約リンク：{link}"
            print(f"予約完了通知: {s['key']} No.{no} {title[:30]}")
            post_to_chatwork(msg)
            notified.append(rid)

    state["reserved"] = sorted(known)
    return notified


def check_published(state: dict, first_run: bool) -> list:
    """チャンネルの公開フィード(RSS)から新しい公開動画を検知する"""
    channel = os.environ.get("YOUTUBE_CHANNEL_ID", "").strip()
    if not channel:
        print("YOUTUBE_CHANNEL_ID 未設定のため公開チェックをスキップ")
        return []
    try:
        feed = http_get(f"https://www.youtube.com/feeds/videos.xml?channel_id={channel}")
    except Exception as e:
        print(f"WARNING: 公開フィードの取得失敗: {e}", file=sys.stderr)
        return []

    notified = []
    known = set(state.setdefault("published", []))
    entries = re.findall(
        r"<entry>.*?<yt:videoId>([^<]+)</yt:videoId>.*?<published>([^<]+)</published>.*?</entry>",
        feed, re.DOTALL)
    for vid, published in entries:
        if vid in known:
            continue
        known.add(vid)
        if first_run:
            continue
        try:
            dt = datetime.fromisoformat(published).astimezone(JST)
            date_disp = f"{dt.month}/{dt.day}"
        except Exception:
            date_disp = "?"
        msg = f"【報告】\n{date_disp}分の投稿完了！\n投稿リンク：https://youtu.be/{vid}"
        print(f"投稿完了通知: {vid} ({date_disp})")
        post_to_chatwork(msg)
        notified.append(vid)

    state["published"] = sorted(known)
    return notified


def main():
    if not os.environ.get("CHATWORK_API_TOKEN"):
        print("CHATWORK_API_TOKEN が未設定のためスキップします。")
        sys.exit(0)

    first_run = not os.path.exists(STATE_PATH)
    state = {}
    if not first_run:
        try:
            with open(STATE_PATH, "r", encoding="utf-8") as f:
                state = json.load(f)
        except Exception:
            first_run = True

    if first_run:
        print("初回実行: 既存の予約・公開分を記録します（通知はしません）")

    # 予約完了はダッシュボードの「予約完了をCWに報告」ボタンに移行したため、
    # スプレッドシート検知は停止（二重通知防止）。record残しのため関数は保持。
    n1 = []
    n2 = check_published(state, first_run)

    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    state["updatedAt"] = datetime.now(JST).isoformat(timespec="seconds")
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)

    print(f"完了: 予約通知 {len(n1)}件 / 公開通知 {len(n2)}件 "
          f"(記録: 予約{len(state['reserved'])}行, 公開{len(state['published'])}本)")


if __name__ == "__main__":
    main()
