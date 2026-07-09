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

任意（設定すると総再生時間・平均視聴時間・視聴維持率・正確な純増減が取得できる）:
  YT_OAUTH_CLIENT_ID / YT_OAUTH_CLIENT_SECRET / YT_OAUTH_REFRESH_TOKEN
    - YouTube Analytics API のOAuth認証情報（scripts/get_refresh_token.py で取得）
  YOUTUBE_CHANNEL_ID  - 対象チャンネルID
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


def fetch_yt_analytics(month: str):
    """YouTube Analytics API から対象月の非公開指標を取得する。
    OAuth用のSecretsが未設定なら None を返す（公開データのみのレポートになる）。"""
    cid = os.environ.get("YT_OAUTH_CLIENT_ID", "").strip()
    csec = os.environ.get("YT_OAUTH_CLIENT_SECRET", "").strip()
    rtok = os.environ.get("YT_OAUTH_REFRESH_TOKEN", "").strip()
    channel = os.environ.get("YOUTUBE_CHANNEL_ID", "").strip()
    if not (cid and csec and rtok and channel):
        return None

    try:
        # リフレッシュトークン → アクセストークン
        payload = urllib.parse.urlencode({
            "client_id": cid, "client_secret": csec,
            "refresh_token": rtok, "grant_type": "refresh_token",
        }).encode()
        with urllib.request.urlopen("https://oauth2.googleapis.com/token", data=payload, timeout=20) as resp:
            access_token = json.loads(resp.read().decode())["access_token"]

        start, end = month_range(month)
        end_day = (datetime.fromisoformat(end) - timedelta(days=1)).strftime("%Y-%m-%d")
        params = urllib.parse.urlencode({
            "ids": f"channel=={channel}",
            "startDate": start,
            "endDate": end_day,
            "metrics": "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost",
        })
        req = urllib.request.Request(
            f"https://youtubeanalytics.googleapis.com/v2/reports?{params}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode())
        rows = data.get("rows") or []
        if not rows:
            print("WARNING: Analytics APIの結果が空でした（対象月にデータなし）", file=sys.stderr)
            return None
        cols = [c["name"] for c in data.get("columnHeaders", [])]
        row = dict(zip(cols, rows[0]))
        return {
            "views": int(row.get("views", 0)),
            "watchMinutes": int(row.get("estimatedMinutesWatched", 0)),
            "avgViewSec": int(row.get("averageViewDuration", 0)),
            "avgViewPct": float(row.get("averageViewPercentage", 0.0)),
            "subsNet": int(row.get("subscribersGained", 0)) - int(row.get("subscribersLost", 0)),
        }
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode()
        except Exception:
            body = ""
        print(f"WARNING: Analytics API HTTP {e.code}: {body[:500]} → 公開データのみでレポートします", file=sys.stderr)
        if e.code == 403:
            # 診断: 認証済みアカウント自身のチャンネル(MINE)なら読めるかを確認する。
            # MINEが成功して指定チャンネルが403の場合、認証時に選んだ身元が対象チャンネルと別物。
            try:
                p2 = urllib.parse.urlencode({
                    "ids": "channel==MINE", "startDate": start, "endDate": end_day,
                    "metrics": "views",
                })
                req2 = urllib.request.Request(
                    f"https://youtubeanalytics.googleapis.com/v2/reports?{p2}",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                with urllib.request.urlopen(req2, timeout=20) as r2:
                    json.loads(r2.read().decode())
                print("診断: channel==MINE は成功 → 認証した身元は対象チャンネルではありません。"
                      "OAuth承認時のアカウント選択で対象チャンネル（ブランドアカウント）を選ぶ必要があります。", file=sys.stderr)
            except Exception as e2:
                print(f"診断: channel==MINE も失敗（{e2}）→ 認証した身元はどのチャンネルの権限も持っていません。", file=sys.stderr)
        return None
    except Exception as e:
        print(f"WARNING: Analytics API取得失敗: {e} → 公開データのみでレポートします", file=sys.stderr)
        return None


def fmt_hours(minutes: int) -> str:
    if minutes >= 60:
        return f"{minutes // 60:,} 時間 {minutes % 60} 分"
    return f"{minutes} 分"


def fmt_min_sec(seconds: int) -> str:
    return f"{seconds // 60} 分 {seconds % 60} 秒"


def build_report(data: dict, month: str) -> str:
    start, end = month_range(month)
    history = data.get("history", [])
    channel = data.get("channel", {})
    label = f"{int(month[:4])}年{int(month[5:7])}月"

    # スナップショットは毎日 午前3時(JST)取得のため、月初日のものが「月開始時点」に相当する
    snap_start = pick_snapshot(history, start, after=True) or pick_snapshot(history, start, after=False)
    snap_end = pick_snapshot(history, end, after=True) or (history[-1] if history else None)
    has_delta = snap_start and snap_end and snap_start["date"] < snap_end["date"]

    NA = "―"
    an = fetch_yt_analytics(month)  # OAuth設定済みならStudio相当の指標を取得
    watch_time = fmt_hours(an["watchMinutes"]) if an else NA
    avg_view = fmt_min_sec(an["avgViewSec"]) if an else NA
    retention = f"{an['avgViewPct']:.1f} %" if an else NA

    if an:
        views_line = f"{an['views']:,} 回（月間）"
        subs_delta = f"{fmt_delta(an['subsNet'])} 人"
    elif has_delta:
        views_line = f"{fmt_delta(snap_end['viewCount'] - snap_start['viewCount'])} 回（累計 {snap_end['viewCount']:,} 回）"
        subs_delta = f"{fmt_delta(snap_end['subscriberCount'] - snap_start['subscriberCount'])} 人"
    else:
        # 履歴が1ヶ月分溜まっていない初回などは現在値のみ報告
        views_line = f"累計 {channel.get('viewCount', 0):,} 回（月間増加は翌月分から表示）"
        subs_delta = "―（計測開始月のため翌月分から表示）"

    subs_now = f"{(snap_end or {}).get('subscriberCount', channel.get('subscriberCount', 0)):,} 人"

    lines = [
        "",
        "📊エンゲージメント",
        f"・▶️ 総再生回数：{views_line}",
        f"・⏱️ 総再生時間：{watch_time}",
        f"・🕒 平均視聴時間：{avg_view}",
        f"・📉 視聴維持率：{retention}",
        "",
        "🌍オーディエンス",
        f"・👥現在のチャンネル登録者数：{subs_now}",
        f"・📈チャンネル登録者数の純増減：{subs_delta}",
    ]
    if not an:
        lines.append("")
        lines.append(f"※「{NA}」の項目はYouTube Studio連携（OAuth設定）後に表示されます")
    lines.append("")
    lines.append("🔴 月間上位コンテンツ")

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
