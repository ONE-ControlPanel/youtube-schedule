#!/usr/bin/env python3
"""
YouTube Data API v3 からチャンネル統計・動画統計を取得して
data/analytics.json を更新するスクリプト。
GitHub Actions から毎日自動実行される（update-and-deploy.yml）。

必要な環境変数:
  YOUTUBE_API_KEY     - Google Cloud Console で発行した API キー
  YOUTUBE_CHANNEL_ID  - 対象チャンネルの ID（UCで始まる）または @ハンドル
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

API_BASE = "https://www.googleapis.com/youtube/v3"
DATA_PATH = "data/analytics.json"
MAX_VIDEOS = 50          # 直近何本の動画統計を保持するか
MAX_HISTORY_DAYS = 400   # 日次スナップショットの保持日数
JST = timezone(timedelta(hours=9))


def api_get(endpoint: str, params: dict) -> dict:
    params["key"] = os.environ["YOUTUBE_API_KEY"]
    url = f"{API_BASE}/{endpoint}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def resolve_channel(channel: str) -> dict:
    """チャンネルID または @ハンドル からチャンネル情報を取得する。"""
    params = {"part": "snippet,statistics,contentDetails"}
    if channel.startswith("UC"):
        params["id"] = channel
    else:
        params["forHandle"] = channel.lstrip("@")
    data = api_get("channels", params)
    items = data.get("items") or []
    if not items:
        print(f"ERROR: チャンネルが見つかりません: {channel}", file=sys.stderr)
        sys.exit(1)
    return items[0]


def fetch_recent_videos(uploads_playlist_id: str) -> list:
    """アップロード動画プレイリストから直近の動画IDを取得する。"""
    data = api_get("playlistItems", {
        "part": "contentDetails",
        "playlistId": uploads_playlist_id,
        "maxResults": MAX_VIDEOS,
    })
    return [it["contentDetails"]["videoId"] for it in data.get("items", [])]


def fetch_video_stats(video_ids: list) -> list:
    """動画IDリストの統計情報をまとめて取得する。"""
    videos = []
    for i in range(0, len(video_ids), 50):
        chunk = video_ids[i:i + 50]
        data = api_get("videos", {
            "part": "snippet,statistics,contentDetails",
            "id": ",".join(chunk),
        })
        for it in data.get("items", []):
            st = it.get("statistics", {})
            sn = it.get("snippet", {})
            videos.append({
                "id": it["id"],
                "title": sn.get("title", ""),
                "publishedAt": sn.get("publishedAt", ""),
                "thumbnail": (sn.get("thumbnails", {}).get("medium") or {}).get("url", ""),
                "views": int(st.get("viewCount", 0)),
                "likes": int(st.get("likeCount", 0)),
                "comments": int(st.get("commentCount", 0)),
                "duration": it.get("contentDetails", {}).get("duration", ""),
            })
    return videos


def main():
    if not os.environ.get("YOUTUBE_API_KEY") or not os.environ.get("YOUTUBE_CHANNEL_ID"):
        print("YOUTUBE_API_KEY / YOUTUBE_CHANNEL_ID が未設定のためスキップします。")
        sys.exit(0)

    ch = resolve_channel(os.environ["YOUTUBE_CHANNEL_ID"])
    st = ch.get("statistics", {})
    channel = {
        "id": ch["id"],
        "title": ch.get("snippet", {}).get("title", ""),
        "thumbnail": (ch.get("snippet", {}).get("thumbnails", {}).get("medium") or {}).get("url", ""),
        "subscriberCount": int(st.get("subscriberCount", 0)),
        "viewCount": int(st.get("viewCount", 0)),
        "videoCount": int(st.get("videoCount", 0)),
    }
    print(f"チャンネル: {channel['title']} / 登録者 {channel['subscriberCount']:,} / 総再生 {channel['viewCount']:,}")

    uploads = ch.get("contentDetails", {}).get("relatedPlaylists", {}).get("uploads")
    videos = fetch_video_stats(fetch_recent_videos(uploads)) if uploads else []
    print(f"動画統計: {len(videos)} 本取得")

    # 既存の履歴を読み込んで今日分のスナップショットを追記（同日分は上書き）
    history = []
    if os.path.exists(DATA_PATH):
        try:
            with open(DATA_PATH, "r", encoding="utf-8") as f:
                history = json.load(f).get("history", [])
        except Exception as e:
            print(f"WARNING: 既存データの読み込みに失敗: {e}", file=sys.stderr)

    today = datetime.now(JST).strftime("%Y-%m-%d")
    snapshot = {
        "date": today,
        "subscriberCount": channel["subscriberCount"],
        "viewCount": channel["viewCount"],
        "videoCount": channel["videoCount"],
    }
    history = [h for h in history if h.get("date") != today]
    history.append(snapshot)
    history.sort(key=lambda h: h["date"])
    history = history[-MAX_HISTORY_DAYS:]

    os.makedirs(os.path.dirname(DATA_PATH), exist_ok=True)
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump({
            "updatedAt": datetime.now(JST).isoformat(timespec="seconds"),
            "channel": channel,
            "videos": videos,
            "history": history,
        }, f, ensure_ascii=False, indent=1)
    print(f"{DATA_PATH} を更新しました（履歴 {len(history)} 日分）。")


if __name__ == "__main__":
    main()
