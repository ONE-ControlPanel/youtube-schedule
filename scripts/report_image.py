#!/usr/bin/env python3
"""
月間レポート用のサマリー画像（登録者推移・再生数推移・TOP動画）を生成する。
monthly_report.py から呼び出される。matplotlib / Pillow が無い環境では
ImportError になるので、呼び出し側で握りつぶして画像なしレポートにフォールバックする。
"""
import io
import urllib.request

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
from matplotlib.offsetbox import OffsetImage, AnnotationBbox
from PIL import Image

BG = "#0f1220"
PANEL = "#181c30"
TEXT = "#e8e8f0"
MUTED = "#8a8aa8"
ACCENT = "#7c4dff"
GREEN = "#00c896"
ORANGE = "#ff9500"


def _jp_font():
    """日本語フォントを環境から探す（GitHub Actions=Noto、mac=Hiragino）。"""
    candidates = ["Noto Sans CJK JP", "Noto Sans JP", "Hiragino Sans",
                  "Hiragino Kaku Gothic ProN", "IPAexGothic", "AppleGothic"]
    installed = {f.name for f in fm.fontManager.ttflist}
    for name in candidates:
        if name in installed:
            return name
    return "sans-serif"


def _fetch_thumb(url: str):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            return Image.open(io.BytesIO(r.read())).convert("RGB")
    except Exception:
        return None


def generate(data: dict, month: str, an: dict | None, out_path: str):
    """サマリー画像を out_path (PNG) に生成する。"""
    font = _jp_font()
    plt.rcParams["font.family"] = font

    label = f"{int(month[:4])}年{int(month[5:7])}月"
    channel = data.get("channel", {})
    history = data.get("history", [])

    start = f"{month}-01"
    y, m = map(int, month.split("-"))
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    end = f"{ny:04d}-{nm:02d}-01"
    published = [v for v in data.get("videos", [])
                 if start <= (v.get("publishedAt") or "")[:10] < end]
    published.sort(key=lambda v: v["views"], reverse=True)
    top = published[:4]

    fig = plt.figure(figsize=(11, 12.5), dpi=110)
    fig.patch.set_facecolor(BG)

    # ---- ヘッダー ----
    fig.text(0.05, 0.965, f"月間YouTubeアナリティクスレポート", fontsize=21, fontweight="bold", color=TEXT)
    fig.text(0.05, 0.937, f"{channel.get('title','')}　|　{label}", fontsize=13, color=MUTED)

    # ---- 主要数値カード ----
    if an:
        cards = [
            ("月間再生回数", f"{an['views']:,} 回", ACCENT),
            ("総再生時間", f"{an['watchMinutes']//60:,} 時間", GREEN),
            ("視聴維持率", f"{an['avgViewPct']:.1f} %", ORANGE),
            ("登録者純増減", f"{'+' if an['subsNet']>=0 else ''}{an['subsNet']:,} 人", ACCENT),
        ]
    else:
        cards = [
            ("チャンネル登録者", f"{channel.get('subscriberCount',0):,} 人", ACCENT),
            ("総再生回数", f"{channel.get('viewCount',0):,} 回", GREEN),
            ("公開動画数", f"{channel.get('videoCount',0):,} 本", ORANGE),
            ("当月公開", f"{len(published)} 本", ACCENT),
        ]
    for i, (t, v, c) in enumerate(cards):
        x = 0.05 + i * 0.235
        fig.patches.append(plt.Rectangle((x, 0.845), 0.215, 0.062, transform=fig.transFigure,
                                         facecolor=PANEL, edgecolor=c, linewidth=1.2,
                                         clip_on=False, zorder=1))
        fig.text(x + 0.012, 0.885, t, fontsize=9.5, color=MUTED, zorder=2)
        fig.text(x + 0.012, 0.856, v, fontsize=15, fontweight="bold", color=c, zorder=2)

    # ---- 推移グラフ2枚 ----
    def style_axis(ax, title):
        ax.set_facecolor(PANEL)
        ax.set_title(title, fontsize=11.5, color=TEXT, loc="left", pad=8)
        ax.tick_params(colors=MUTED, labelsize=8)
        for s in ax.spines.values():
            s.set_color("#2a2f4a")
        ax.grid(True, color="#2a2f4a", linewidth=0.5, linestyle="--", alpha=0.6)
        ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{int(v):,}"))

    hist = history[-90:]
    dates = [h["date"][5:] for h in hist]
    step = max(1, len(dates) // 6)

    ax1 = fig.add_axes([0.05, 0.615, 0.42, 0.175])
    style_axis(ax1, "チャンネル登録者数の推移（直近90日）")
    ax2 = fig.add_axes([0.545, 0.615, 0.42, 0.175])
    style_axis(ax2, "総再生回数の推移（直近90日）")

    if len(hist) >= 2:
        ax1.plot(dates, [h["subscriberCount"] for h in hist], color=ACCENT, linewidth=2)
        ax1.fill_between(dates, [h["subscriberCount"] for h in hist],
                         min(h["subscriberCount"] for h in hist), color=ACCENT, alpha=0.12)
        ax2.plot(dates, [h["viewCount"] for h in hist], color=GREEN, linewidth=2)
        ax2.fill_between(dates, [h["viewCount"] for h in hist],
                         min(h["viewCount"] for h in hist), color=GREEN, alpha=0.12)
        for ax in (ax1, ax2):
            ax.set_xticks(range(0, len(dates), step))
    else:
        for ax in (ax1, ax2):
            ax.text(0.5, 0.5, "データ蓄積中（毎日自動記録されます）", transform=ax.transAxes,
                    ha="center", va="center", fontsize=10, color=MUTED)
            ax.set_xticks([]); ax.set_yticks([])

    # ---- TOP動画ランキング（サムネ付き） ----
    fig.text(0.05, 0.555, f"{label}の上位コンテンツ（再生数順）", fontsize=13, fontweight="bold", color=TEXT)
    medals = ["1位", "2位", "3位", "4位"]
    colors = [ORANGE, "#b0b8c8", "#c98953", MUTED]
    row_h = 0.118
    for i, v in enumerate(top):
        ytop = 0.525 - i * row_h
        fig.patches.append(plt.Rectangle((0.05, ytop - row_h + 0.018), 0.915, row_h - 0.014,
                                         transform=fig.transFigure, facecolor=PANEL,
                                         edgecolor="#2a2f4a", linewidth=0.8, clip_on=False, zorder=1))
        # サムネイル
        thumb = _fetch_thumb(v.get("thumbnail", ""))
        if thumb:
            axt = fig.add_axes([0.065, ytop - row_h + 0.028, 0.135, row_h - 0.034])
            axt.imshow(thumb)
            axt.axis("off")
            axt.set_zorder(3)  # パネル矩形(zorder=1)より前面に出す
        # テキスト
        fig.text(0.215, ytop - 0.026, medals[i], fontsize=12, fontweight="bold", color=colors[i], zorder=2)
        title = v["title"][:38] + ("…" if len(v["title"]) > 38 else "")
        fig.text(0.26, ytop - 0.026, title, fontsize=10.5, color=TEXT, zorder=2)
        fig.text(0.26, ytop - 0.058, f"再生 {v['views']:,} 回　／　高評価 {v['likes']:,}　／　コメント {v['comments']:,}",
                 fontsize=9.5, color=MUTED, zorder=2)
        fig.text(0.26, ytop - 0.085, f"youtu.be/{v['id']}", fontsize=8.5, color="#5a9bd5", zorder=2)
    if not top:
        fig.text(0.05, 0.48, f"{label}に公開された動画はありませんでした", fontsize=11, color=MUTED)

    fig.text(0.05, 0.022, "自動生成: youtube-schedule 月次レポート", fontsize=8, color=MUTED)
    fig.savefig(out_path, facecolor=BG, bbox_inches=None)
    plt.close(fig)
    return out_path
