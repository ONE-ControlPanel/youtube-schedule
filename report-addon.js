// report-addon.js - 予約完了のChatWork報告ボタン
// 動画詳細モーダルに「予約完了をCWに報告」ボタンを追加する。
// GAS_WEBHOOK_URL が設定されていればワンクリックで自動送信、
// 未設定の間はテキストをコピーしてChatWorkを開く（貼り付け方式）。
;(function(){
  // GAS中継サーバーのURL（デプロイ後にここへ貼る）
  var GAS_WEBHOOK_URL = '';
  var CW_ROOM_ID = '288597442';  // コピー方式のとき開くルーム

  function toast(msg){
    if (typeof window.showToast === 'function') { window.showToast(msg); return; }
    alert(msg);
  }

  function currentRow(){
    var key = window.__fbCurKey, no = window.__fbCurNo;
    if (!key || no == null || !window.months || !window.months[key]) return null;
    var r = window.months[key].rows.find(function(x){ return x.no === no; });
    return r || null;
  }

  function buildMessage(r){
    var md = '?';
    if (r.date) md = (r.date.getMonth()+1) + '/' + r.date.getDate();
    else if (r.dateStr) {
      var m = String(r.dateStr).match(/(\d{1,2})\D+(\d{1,2})\D*$/);
      if (m) md = parseInt(m[1],10) + '/' + parseInt(m[2],10);
    }
    var link = (r.youtubeLink || '').trim();
    if (!link) {
      link = (prompt('予約リンク（YouTubeのURL）を入力してください。\n空欄のままOKを押すと「（リンク未記入）」になります。','') || '').trim();
    }
    if (!link) link = '（リンク未記入）';
    return '【報告】\n' + md + '分の投稿動画が予約完了！\n予約リンク：' + link;
  }

  function copyFallback(msg){
    function open(){ window.open('https://www.chatwork.com/#!rid' + CW_ROOM_ID, '_blank'); }
    try {
      navigator.clipboard.writeText(msg).then(function(){
        toast('報告文をコピーしました。ChatWorkに貼り付けてください');
        open();
      }, function(){ prompt('コピーできませんでした。以下を手動でコピーしてください', msg); open(); });
    } catch(e){ prompt('以下を手動でコピーしてください', msg); open(); }
  }

  function send(msg, btn){
    if (!GAS_WEBHOOK_URL){ copyFallback(msg); return; }
    btn.disabled = true; btn.textContent = '送信中...';
    fetch(GAS_WEBHOOK_URL, {
      method: 'POST',
      headers: {'Content-Type': 'text/plain'},  // preflight回避（GAS用）
      body: JSON.stringify({ message: msg })
    })
      .then(function(res){ return res.json(); })
      .then(function(j){
        if (j && (j.status === 200 || j.ok)) {
          toast('✓ ChatWorkへ報告しました');
          btn.textContent = '✓ 報告済み';
        } else { throw new Error('status ' + (j && j.status)); }
      })
      .catch(function(e){
        console.warn('GAS送信失敗、コピー方式に切替:', e);
        btn.disabled = false; btn.textContent = '📮 予約完了をCWに報告';
        copyFallback(msg);
      });
  }

  function onClick(ev){
    var r = currentRow();
    if (!r){ alert('動画情報を取得できませんでした'); return; }
    var msg = buildMessage(r);
    if (!confirm('以下の内容でChatWorkに報告します：\n\n' + msg)) return;
    send(msg, ev.currentTarget);
  }

  function injectButton(){
    var body = document.getElementById('modal-body');
    if (!body || document.getElementById('cw-report-btn')) return;
    var wrap = document.createElement('div');
    wrap.style.cssText = 'margin-top:14px;';
    var btn = document.createElement('button');
    btn.id = 'cw-report-btn';
    btn.type = 'button';
    btn.textContent = '📮 予約完了をCWに報告';
    btn.style.cssText = 'width:100%;padding:12px 16px;background:linear-gradient(135deg,#00b4d8,#0077b6);color:#fff;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-size:13px;font-family:"Noto Sans JP",sans-serif;box-shadow:0 4px 12px rgba(0,150,200,0.3);';
    btn.addEventListener('click', onClick);
    wrap.appendChild(btn);
    body.appendChild(wrap);
  }

  // showDetailをラップしてモーダル描画後にボタンを差し込む
  function hook(){
    if (typeof window.showDetail !== 'function'){ setTimeout(hook, 500); return; }
    if (window.__cwReportHooked) return;
    window.__cwReportHooked = true;
    var orig = window.showDetail;
    window.showDetail = function(key, no){
      window.__fbCurKey = key; window.__fbCurNo = no;
      var ret = orig.apply(this, arguments);
      try { injectButton(); } catch(e){}
      return ret;
    };
  }
  hook();
})();
