// ui-enhance-addon.js - 編集パネルのURL入力欄に「開く」ボタンを追加
// 編集モード中でも、入力されているURLをワンクリックで開けるようにする。
;(function(){
  var URL_KEYS = ['deliveryUrl','reviewUrl','materialUrl1','materialUrl2','thumbUrl','youtubeLink'];

  function enhancePanel(){
    var panel = document.getElementById('fb-edit-panel');
    if (!panel || panel.dataset.uiEnh === '1') return;
    var found = false;
    URL_KEYS.forEach(function(key){
      var input = document.getElementById('fb-edit-ext-' + key);
      if (!input || input.dataset.uiEnh === '1') return;
      input.dataset.uiEnh = '1';
      found = true;
      // 入力欄とボタンを横並びにする
      var wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;gap:6px;align-items:center;';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      input.style.flex = '1';
      input.style.minWidth = '0';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '開く ↗';
      btn.style.cssText = 'flex-shrink:0;padding:8px 12px;background:var(--surface2,#222);border:1px solid var(--border,#444);border-radius:7px;color:var(--text,#eee);font-size:11px;cursor:pointer;font-family:"Noto Sans JP",sans-serif;white-space:nowrap;';
      btn.addEventListener('click', function(ev){
        ev.preventDefault(); ev.stopPropagation();
        var url = input.value.trim();
        if (!url){ alert('URLが入力されていません'); return; }
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        window.open(url, '_blank', 'noopener');
      });
      wrap.appendChild(btn);
    });
    if (found) panel.dataset.uiEnh = '1';
  }

  // 編集パネルは動的に生成されるので出現を監視する
  var mo = new MutationObserver(function(){ enhancePanel(); });
  mo.observe(document.body, { childList: true, subtree: true });
})();
