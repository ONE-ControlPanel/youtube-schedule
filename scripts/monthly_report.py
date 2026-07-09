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

    # スナップショットは毎日 午前3時(JST)取得のため、月初日のものが「月開始時点」に相当する
    snap_start = pick_snapshot(history, start, after=True) or pick_snapshot(history, start, after=False)
    snap_end = pick_snapshot(history, end, after=True) or (history[-1] if history else None)
    has_delta = snap_start and snap_end and snap_start["date"] < snap_end["date"]

    if has_delta:
        views_line = f"{fmt_delta(snap_end['viewCount'] - snap_start['viewCount'])} 回（累計 {snap_end['viewCount']:,} 回）"
        subs_delta = f"{fmt_delta(snap_end['subscriberCount'] - snap_start['subscriberCount'])} 人"
        subs_now = f"{snap_end['subscriberCount']:,} 人"
    else:
        # 履歴が1ヶ月分溜まっていない初回などは現在値のみ報告
        views_line = f"累計 {channel.get('viewCount', 0):,} 回（月間増加は翌月分から表示）"
        subs_delta = "―（計測開始月のため翌月分から表示）"
        subs_now = f"{channel.get('subscriberCount', 0):,} 人"

    NA = "―"
    lines = [
        "",
        "📊エンゲージメント",
        f"・▶️ 総再生回数：{views_line}",
        f"・⏱️ 総再生時間：{NA}",
        f"・🕒 平均視聴時間：{NA}",
        f"・📉 視聴維持率：{NA}",
        "",
        "🌍オーディエンス",
        f"・👥現在のチャンネル登録者数：{subs_now}",
        f"・📈チャンネル登録者数の純増減：{subs_delta}",
        f"・👤ユニーク視聴者数：{NA}",
        "",
        f"※「{NA}」の項目はチャンネル所有者のYouTube Studio連携が必要なため未取得です",
        "",
        "🔴 月間上位コンテンツ",
    ]

    # 対象月に公開された動画の上位4本（再生数順）
    published = [v for v in data.get("videos", [])
                 if start <= (v.get("publishedAt") or "")[:10] < end]
    published.sort(key=lambda v: v["views"], reverse=True)
    medals = ["🏆 1位", "🥈 2位", "🥉 3位", "✨ 4位"]
    if published:
        for medal, v in zip(medals, published):
            title = v["title"][:45] + ("…" if len(v["title"]) > 45 else "")
            lines.append(f"{medal}：{title}（{v['views']:,}回）")
            if medal.endswith("1位"):
                lines.append(f"🔗 リンク：https://youtu.be/{v['id']}")
                lines.append("")
    else:
        lines.append(f"{label}に公開された動画はありませんでした")

    lines.append("")
    lines.append("📈 詳細ダッシュボード")
    lines.append("https://one-controlpanel.github.io/youtube-schedule/")

    body = "\n".join(lines)
    title = f"▶️ 月間YouTubeのアナリティクスレポート（{label}）"
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
