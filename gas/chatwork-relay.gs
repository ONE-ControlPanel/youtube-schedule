/**
 * ChatWork送信 中継サーバー（Google Apps Script）
 * ダッシュボードの「予約完了をCWに報告」ボタンから呼ばれ、
 * ChatWork APIトークンを公開せずにメッセージを送信する。
 *
 * セットアップ手順:
 * 1. https://script.google.com で「新しいプロジェクト」を作成
 * 2. このコードを貼り付けて保存
 * 3. 左の歯車（プロジェクトの設定）→「スクリプト プロパティ」に以下を追加:
 *      CW_TOKEN   = ChatWork APIトークン
 *      CW_ROOM_ID = 288597442
 * 4. 右上「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *      次のユーザーとして実行: 自分
 *      アクセスできるユーザー: 全員
 * 5. 発行された「ウェブアプリのURL」を report-addon.js の GAS_WEBHOOK_URL に設定
 */
function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty('CW_TOKEN');
    var room = props.getProperty('CW_ROOM_ID');
    if (!token || !room) return json_({ error: 'CW_TOKEN / CW_ROOM_ID が未設定です' });

    var data = JSON.parse(e.postData.contents);
    var message = String(data.message || '').substring(0, 2000);
    if (!message) return json_({ error: 'message が空です' });

    var res = UrlFetchApp.fetch('https://api.chatwork.com/v2/rooms/' + room + '/messages', {
      method: 'post',
      headers: { 'X-ChatWorkToken': token },
      payload: { body: message },
      muteHttpExceptions: true,
    });
    return json_({ status: res.getResponseCode() });
  } catch (err) {
    return json_({ error: String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
