#!/usr/bin/env python3
"""
Googleスプレッドシートから最新CSVを取得してindex.htmlの埋め込みデータを更新するスクリプト。
また、公開シート一覧から「YYYY/M」形式のシートを自動発見し、index.htmlの
SHEET_URLS（月タブの読み込み先）を自動更新する。スプレッドシートに新しい月の
シートを追加するだけで、翌日（または手動実行時）にダッシュボードへ反映される。
GitHub Actionsから毎日自動実行される。
"""
import urllib.request
import re
import sys

SPREADSHEET_BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTiXK04o9Zv9OnUO5jYZ6wsc5C6UzJGeafQgDXUeVT4l7iaJ7kM6-lf_o5dc5mQJmU-tXZ_p7Edodpc"
PUBHTML_URL = f"{SPREADSHEET_BASE}/pubhtml"
# ダッシュボード運用開始月（これより前のシートはタブに出さない）
FIRST_MONTH = "2026-03"

# 更新対象のGoogleスプレッドシートURL（index.htmlのSHEET_URLSと同じ）
TARGETS = [
    {
        "marker": "MAR",
        "var":    "CSV_MAR",
        "url":    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTiXK04o9Zv9OnUO5jYZ6wsc5C6UzJGeafQgDXUeVT4l7iaJ7kM6-lf_o5dc5mQJmU-tXZ_p7Edodpc/pub?gid=243823405&single=true&output=csv",
    },
    {
        "marker": "APR",
        "var":    "CSV_APR",
        "url":    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTiXK04o9Zv9OnUO5jYZ6wsc5C6UzJGeafQgDXUeVT4l7iaJ7kM6-lf_o5dc5mQJmU-tXZ_p7Edodpc/pub?gid=26868912&single=true&output=csv",
    },
    {
        "marker": "MAY",
        "var":    "CSV_MAY",
        "url":    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTiXK04o9Zv9OnUO5jYZ6wsc5C6UzJGeafQgDXUeVT4l7iaJ7kM6-lf_o5dc5mQJmU-tXZ_p7Edodpc/pub?gid=1696408381&single=true&output=csv",
    },
]

HTML_PATH = "index.html"


def csv_to_js(csv_text: str, var_name: str) -> str:
    """CSVテキストをJavaScriptの変数宣言文字列に変換する。"""
    lines = csv_text.strip().splitlines()
    if not lines:
        return f"var {var_name} = '';"

    js_lines = []
    for i, line in enumerate(lines):
        # シングルクォートとバックスラッシュをエスケープ
        escaped = line.replace("\\", "\\\\").replace("'", "\\'")
        if i < len(lines) - 1:
            js_lines.append(f"'{escaped}\\n' +")
        else:
            js_lines.append(f"'{escaped}';")

    return f"var {var_name} = {chr(10).join(js_lines)}"


def fetch_csv(url: str) -> str | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.read().decode("utf-8")
    except Exception as e:
        print(f"  WARNING: フェッチ失敗 ({url[:60]}...): {e}", file=sys.stderr)
        return None


def update_html(html: str, marker: str, var_name: str, csv_text: str) -> str:
    """マーカー間のCSVデータを新しい内容で置き換える。"""
    start_tag = f"// <<AUTO_UPDATE_{marker}_START>>"
    end_tag   = f"// <<AUTO_UPDATE_{marker}_END>>"

    pattern = re.compile(
        re.escape(start_tag) + r".*?" + re.escape(end_tag),
        re.DOTALL,
    )

    new_js = csv_to_js(csv_text, var_name)
    replacement = f"{start_tag}\n{new_js}\n{end_tag}"

    # 置換文字列を関数で渡す（文字列で渡すと \n 等がエスケープ解釈されJSが壊れる）
    updated, count = pattern.subn(lambda _: replacement, html)
    if count == 0:
        print(f"  ERROR: マーカーが見つかりません: {start_tag}", file=sys.stderr)
        return html
    return updated


def discover_month_sheets():
    """公開シート一覧(pubhtml)から「YYYY/M」形式のシートを見つけて
    [{key, label, gid}, ...] を返す（FIRST_MONTH以降のみ・月順）。"""
    try:
        req = urllib.request.Request(PUBHTML_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            page = resp.read().decode("utf-8")
    except Exception as e:
        print(f"WARNING: シート一覧の取得に失敗: {e}", file=sys.stderr)
        return None

    sheets = []
    for m in re.finditer(r'items\.push\(\{name: "(\d{4})\\?/(\d{1,2})".*?gid=(\d+)', page):
        y, mo, gid = int(m.group(1)), int(m.group(2)), m.group(3)
        key = f"{y:04d}-{mo:02d}"
        if key >= FIRST_MONTH:
            sheets.append({"key": key, "label": f"{y}年{mo}月", "gid": gid})
    sheets.sort(key=lambda s: s["key"])
    return sheets or None


def update_sheet_urls(html: str) -> str:
    """index.htmlのSHEET_URLS（月タブの読み込み先一覧）をシート一覧から再生成する。"""
    sheets = discover_month_sheets()
    if not sheets:
        print("SHEET_URLS: シート一覧が取得できないためスキップ（現状維持）")
        return html

    entries = ",\n".join(
        f"  {{ key:'{s['key']}', label:'{s['label']}', "
        f"url:'{SPREADSHEET_BASE}/pub?gid={s['gid']}&single=true&output=csv' }}"
        for s in sheets
    )
    start_tag = "// <<AUTO_UPDATE_SHEETS_START>>"
    end_tag = "// <<AUTO_UPDATE_SHEETS_END>>"
    replacement = f"{start_tag}\nvar SHEET_URLS = [\n{entries}\n];\n{end_tag}"
    pattern = re.compile(re.escape(start_tag) + r".*?" + re.escape(end_tag), re.DOTALL)
    updated, count = pattern.subn(lambda _: replacement, html)
    if count == 0:
        print(f"  ERROR: マーカーが見つかりません: {start_tag}", file=sys.stderr)
        return html
    print(f"SHEET_URLS: {len(sheets)}ヶ月分に更新（{sheets[0]['key']}〜{sheets[-1]['key']}）")
    return updated


def main():
    with open(HTML_PATH, "r", encoding="utf-8") as f:
        html = f.read()

    updated = False
    for target in TARGETS:
        print(f"[{target['marker']}] Googleスプレッドシートから取得中...")
        csv_text = fetch_csv(target["url"])
        if csv_text is None:
            print(f"  スキップ（現在の埋め込みデータを維持）")
            continue

        html = update_html(html, target["marker"], target["var"], csv_text)
        print(f"  OK: {target['var']} を更新しました")
        updated = True

    # 月タブの読み込み先一覧をシート一覧から自動更新（新しい月のシートを自動反映）
    new_html = update_sheet_urls(html)
    if new_html != html:
        html = new_html
        updated = True

    if updated:
        with open(HTML_PATH, "w", encoding="utf-8") as f:
            f.write(html)
        print("\nindex.html を更新しました。")
    else:
        print("\n更新するデータがありませんでした（全てのフェッチが失敗）。")
        sys.exit(1)


if __name__ == "__main__":
    main()
