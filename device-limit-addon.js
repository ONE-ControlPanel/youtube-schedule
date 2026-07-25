// device-limit-addon.js - 1アカウント1端末制限（後勝ち方式）
// ページを開いた端末が「アクティブ端末」としてFirestoreに登録され、
// 別の端末が同じアカウントで開くと、先にいた端末は自動ログアウトされる。
// セッションIDはブラウザごとに保存されるため、同じブラウザのタブ間では競合しない。
;(function(){
  var KEY = 'deviceSessionId';

  function fb(){ return window.firebase; }

  function getSid(){
    var sid = null;
    try { sid = localStorage.getItem(KEY); } catch(e){}
    if (!sid){
      sid = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(KEY, sid); } catch(e){}
    }
    return sid;
  }

  function start(user){
    var db = fb().firestore();
    var ref = db.collection('sessions').doc(user.uid);
    var sid = getSid();

    // この端末をアクティブ端末として登録（後勝ち）
    ref.set({
      sid: sid,
      ua: (navigator.userAgent || '').slice(0, 120),
      email: user.email || '',
      at: fb().firestore.FieldValue.serverTimestamp(),
    }).catch(function(e){
      // 書き込み権限が無い等の場合は制限機能を無効化（ロックアウト防止）
      console.warn('[device-limit] 登録失敗のため端末制限は無効:', e.message);
    });

    // 他の端末に取られたら即ログアウト
    ref.onSnapshot(function(doc){
      var d = doc.data();
      if (d && d.sid && d.sid !== sid){
        try { alert('別の端末でログインされたため、この端末はログアウトされました。'); } catch(e){}
        fb().auth().signOut().then(function(){ location.reload(); });
      }
    }, function(err){
      console.warn('[device-limit] 監視エラー:', err.message);
    });
  }

  function boot(){
    try {
      if (!fb() || !fb().auth || !fb().apps || !fb().apps.length){ setTimeout(boot, 500); return; }
    } catch(e){ setTimeout(boot, 500); return; }
    var started = false;
    fb().auth().onAuthStateChanged(function(user){
      if (!user || started) return;
      started = true;
      start(user);
    });
  }
  boot();
})();
