#!/usr/bin/env python3
"""
YouTubeアナリティクスの月間レポートを ChatWork に自動送信するスクリプト。
GitHub Actions から毎月1日 朝9時（JST）に自動実行される（monthly-report.yml）。

data/analytics.json の日次スナップショット履歴から前月分の増加数を計算し、
前月に公開された動画の成績と合わせて ChatWork ルームへ投稿する。

必要な環境変数:
  CHATWORK_API_TOKEN  - ChatWork API トークン
  CHATWORK_ROOM_ID    - 送信先ルームID（省略時は 399892175）
  REPORT_MONTH        - 任意。"2026-06" 形式で対象月を指定（省略時は前月）
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

DATA_PATH = "data/analytics.json"
DEFAULT_ROOM_ID = "399892175"
JST = timezone(timedelta(hours=9))


def month_range(month: str):
    """'2026-06' → (当月1日, 翌月1日) の date 文字列ペア"""
    y, m = map(int, month.split("-"))
    start = f"{y:04d}-{m:02d}-01"
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    end = f"{ny:04d}-{nm:02d}-01"
    return start, end


def pick_snapshot(history: list, target_date: str, after: bool):
    """target_date 以降(after=True)/以前(after=False) で最も近いスナップショットを返す"""
    cands = [h for h in history if (h["date"] >= target_date) == after] or None
    if not cands:
        return None
    return min(cands, key=lambda h: abs((datetime.fromisoformat(h["date"]) - datetime.fromisoformat(target_date)).days))


def fmt_delta(n: int) -> str:
    return f"+{n:,}" if n >= 0 else f"{n:,}"


def build_report(data: dict, month: str) -> str:
    start, end = month_range(month)
    history = data.get("history", [])
    channel = data.get("channel", {})
    label = f"{int(month[:4])}年{int(month[5:7])}月"

    lines = []
    # スナップショットは毎日 午前3時(JST)取得のため、月初日のものが「月開始時点」に相当する
    snap_start = pick_snapshot(history, start, after=True) or pick_snapshot(history, start, after=False)
    snap_end = pick_snapshot(history, end, after=True) or (history[-1] if history else None)

    if snap_start and snap_end and snap_start["date"] < snap_end["date"]:
        lines.append(f"▼ チャンネル全体（{snap_start['date']} → {snap_end['date']}）")
        lines.append(f"・チャンネル登録者：{snap_end['subscriberCount']:,} 人（{fmt_delta(snap_end['subscriberCount'] - snap_start['subscriberCount'])} 人）")
        lines.append(f"・総再生回数：{snap_end['viewCount']:,} 回（{fmt_delta(snap_end['viewCount'] - snap_start['viewCount'])} 回）")
        lines.append(f"・公開動画数：{snap_end['videoCount']:,} 本（{fmt_delta(snap_end['videoCount'] - snap_start['videoCount'])} 本）")
    else:
        # 履歴が1ヶ月分溜まっていない初回などは現在値のみ報告
        lines.append("▼ チャンネル全体（現在値 ※増加数は履歴が溜まり次第表示されます）")
        lines.append(f"・チャンネル登録者：{channel.get('subscriberCount', 0):,} 人")
        lines.append(f"・総再生回数：{channel.get('viewCount', 0):,} 回")
        lines.append(f"・公開動画数：{channel.get('videoCount', 0):,} 本")

    # 対象月に公開された動画の成績（再生数順）
    published = [v for v in data.get("videos", [])
                 if start <= (v.get("publishedAt") or "")[:10] < end]
    published.sort(key=lambda v: v["views"], reverse=True)
    lines.append("")
    if published:
        lines.append(f"▼ {label}に公開した動画（{len(published)}本 / 再生数順）")
        for i, v in enumerate(published, 1):
            title = v["title"][:40] + ("…" if len(v["title"]) > 40 else "")
            lines.append(f"{i}. {title}")
            lines.append(f"   再生 {v['views']:,} ／ 高評価 {v['likes']:,} ／ コメント {v['comments']:,}")
            lines.append(f"   https://youtu.be/{v['id']}")
    else:
        lines.append(f"▼ {label}に公開した動画：なし")

    lines.append("")
    lines.append("📈 詳細ダッシュボード")
    lines.append("https://one-controlpanel.github.io/youtube-schedule/")

    body = "\n".join(lines)
    title = f"📊 かずさんYouTube 月間レポート（{label}）"
    return f"[info][title]{title}[/title]{body}[/info]"


def post_to_chatwork(message: str):
    token = os.environ["CHATWORK_API_TOKEN"]
    room = os.environ.get("CHATWORK_ROOM_ID") or DEFAULT_ROOM_ID
    url = f"https://api.chatwork.com/v2/rooms/{room}/messages"
    payload = urllib.parse.urlencode({"body": message}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST", headers={
        "X-ChatWorkToken": token,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0",
    })
    with urllib.request.urlopen(req, timeout=20) as resp:
        print(f"ChatWork 送信完了: HTTP {resp.status} / room {room}")


def main():
    if not os.environ.get("CHATWORK_API_TOKEN"):
        print("CHATWORK_API_TOKEN が未設定のためスキップします。")
        sys.exit(0)
    if not os.path.exists(DATA_PATH):
        print(f"ERROR: {DATA_PATH} がありません。先に update_analytics.py を実行してください。", file=sys.stderr)
        sys.exit(1)

    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    month = os.environ.get("REPORT_MONTH")
    if not month:
        # 実行日の前月をレポート対象にする（毎月1日実行想定）
        first_of_this_month = datetime.now(JST).replace(day=1)
        prev = first_of_this_month - timedelta(days=1)
        month = prev.strftime("%Y-%m")

    message = build_report(data, month)
    print("---- 送信内容 ----")
    print(message)
    print("------------------")
    post_to_chatwork(message)


if __name__ == "__main__":
    main()
