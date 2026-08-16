/**
 * LINE送信 中継サーバー（Google Apps Script）
 * リサーチ結果などのテキストをLINEグループへ自動送信する。
 *
 * リクエスト形式（POST, JSON）:
 *   { "message": "本文" }  → 登録済みグループへ送信
 *   LINEのWebhookイベント   → ボットが招待されたグループのIDを自動記録
 *
 * セットアップ:
 * 1. LINE Developers (https://developers.line.biz/) でMessaging APIチャネルを作成
 * 2. チャネルアクセストークン（長期）を発行
 * 3. このGASをウェブアプリとしてデプロイ（実行: 自分 / アクセス: 全員）
 * 4. スクリプトプロパティに LINE_TOKEN を設定
 * 5. LINE DevelopersのWebhook URLにこのGASのURLを設定して「利用する」をON
 * 6. ボットを送信先グループに招待 → グループで誰かが1回発言 → グループID自動記録
 */
function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty('LINE_TOKEN');
    var body = JSON.parse(e.postData.contents || '{}');

    // (A) LINE Webhookイベント → グループIDを自動記録
    if (Array.isArray(body.events)) {
      body.events.forEach(function(ev) {
        var src = ev.source || {};
        if (src.groupId) props.setProperty('LINE_TO', src.groupId);
      });
      return json_({ ok: true });
    }

    // (B) メッセージ送信
    if (!token) return json_({ error: 'LINE_TOKEN が未設定です' });
    var to = String(body.to || props.getProperty('LINE_TO') || '');
    if (!to) return json_({ error: '送信先グループが未登録です。ボットをグループに招待して誰かが発言してください' });
    var message = String(body.message || '');
    if (!message) return json_({ error: 'message が空です' });

    var chunks = [];
    while (message.length > 0) {
      chunks.push(message.substring(0, 4900));
      message = message.substring(4900);
    }
    var results = [];
    chunks.slice(0, 5).forEach(function(chunk) {
      var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
        method: 'post',
        contentType: 'application/json',
        headers: { 'Authorization': 'Bearer ' + token },
        payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: chunk }] }),
        muteHttpExceptions: true,
      });
      results.push(res.getResponseCode());
    });
    return json_({ status: results });
  } catch (err) {
    return json_({ error: String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
