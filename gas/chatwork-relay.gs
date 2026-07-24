/**
 * ChatWork送信 中継サーバー（Google Apps Script）
 * ダッシュボードの報告ボタン類から呼ばれ、APIトークンを公開せずに送信する。
 *
 * リクエスト形式（POST, JSON）:
 *   { "message": "本文" }                    → 既定ルーム(CW_ROOM_ID)へ送信
 *   { "message": "本文", "room": "123456" }  → 指定ルームへ送信
 *   { "action": "members", "room": "123456" } → ルームのメンバー一覧を返す（メンションID調査用）
 *
 * スクリプトプロパティ: CW_TOKEN, CW_ROOM_ID
 */
function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty('CW_TOKEN');
    var defaultRoom = props.getProperty('CW_ROOM_ID');
    if (!token) return json_({ error: 'CW_TOKEN が未設定です' });

    var data = JSON.parse(e.postData.contents);
    var room = String(data.room || defaultRoom || '');
    if (!room) return json_({ error: 'room が未設定です' });

    if (data.action === 'members') {
      var res = UrlFetchApp.fetch('https://api.chatwork.com/v2/rooms/' + room + '/members', {
        headers: { 'X-ChatWorkToken': token },
        muteHttpExceptions: true,
      });
      return ContentService.createTextOutput(res.getContentText())
        .setMimeType(ContentService.MimeType.JSON);
    }

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
