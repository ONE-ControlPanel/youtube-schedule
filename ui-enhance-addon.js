// ui-enhance-addon.js - 編集パネルのURL入力欄に「開く」ボタンを追加
// 編集モード中でも、入力されているURLをワンクリックで開けるようにする。
;(function(){
  var URL_KEYS = ['deliveryUrl','reviewUrl','materialUrl1','materialUrl2','materialUrl3','materialUrl4','materialUrl5','thumbUrl','imageIdeaUrl','thumbMaterialUrl','youtubeLink'];

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

  // ---------- 素材URL②〜⑤: 空欄は隠して「＋追加」で順次表示 ----------
  var EXTRA_MATERIALS = ['materialUrl2','materialUrl3','materialUrl4','materialUrl5'];

  function setupMaterialRows(){
    var panel = document.getElementById('fb-edit-panel');
    if (!panel || panel.dataset.matEnh === '1') return;
    var rows = [];
    EXTRA_MATERIALS.forEach(function(key){
      var input = document.getElementById('fb-edit-ext-' + key);
      if (!input) return;
      var row = input.closest('.fb-edit-row');
      if (row) rows.push({ row: row, input: input });
    });
    if (!rows.length) return;
    panel.dataset.matEnh = '1';

    // 空欄の行は隠す
    rows.forEach(function(o){ if (!o.input.value.trim()) o.row.style.display = 'none'; });

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '＋ 素材URLを追加';
    btn.style.cssText = 'margin:2px 0 10px;padding:7px 14px;background:transparent;border:1px dashed var(--border,#555);border-radius:8px;color:var(--text-muted,#999);font-size:11px;cursor:pointer;font-family:"Noto Sans JP",sans-serif;';
    function refreshBtn(){
      var hidden = rows.filter(function(o){ return o.row.style.display === 'none'; });
      btn.style.display = hidden.length ? '' : 'none';
    }
    btn.addEventListener('click', function(ev){
      ev.preventDefault(); ev.stopPropagation();
      var next = rows.find(function(o){ return o.row.style.display === 'none'; });
      if (next){ next.row.style.display = ''; next.input.focus(); }
      refreshBtn();
    });
    var lastRow = rows[rows.length - 1].row;
    lastRow.parentNode.insertBefore(btn, lastRow.nextSibling);
    refreshBtn();
  }

  // ---------- イメージ画像のライブプレビュー ----------
  function imgCandidates(url){
    var gy = url.match(/gyazo\.com\/([a-z0-9]{10,})/i);
    if (gy) return ['https://i.gyazo.com/'+gy[1]+'.png', 'https://i.gyazo.com/'+gy[1]+'.jpg', 'https://i.gyazo.com/thumb/1000/'+gy[1]+'-heic.jpg'];
    if (/\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(url)) return [url];
    return [url];  // 一応試す（読めなければ非表示）
  }

  function setupImagePreview(){
    var input = document.getElementById('fb-edit-ext-imageIdeaUrl');
    if (!input || input.dataset.prevEnh === '1') return;
    input.dataset.prevEnh = '1';
    var row = input.closest('.fb-edit-row') || input.parentNode;
    var img = document.createElement('img');
    img.id = 'image-idea-preview';
    img.style.cssText = 'display:none;max-width:100%;max-height:200px;border-radius:8px;margin:6px 0 10px;border:1px solid var(--border,#444);';
    row.parentNode.insertBefore(img, row.nextSibling);

    function update(){
      var url = input.value.trim();
      if (!url){ img.style.display = 'none'; return; }
      var cands = imgCandidates(url);
      var i = 0;
      img.onerror = function(){ i++; if (i < cands.length){ img.src = cands[i]; } else { img.style.display = 'none'; } };
      img.onload = function(){ img.style.display = 'block'; };
      img.src = cands[0];
    }
    input.addEventListener('change', update);
    input.addEventListener('paste', function(){ setTimeout(update, 50); });
    update();
  }

  // ---------- サムネ画像の貼り付けゾーン ----------
  function currentRow(){
    var key = window.__fbCurKey, no = window.__fbCurNo;
    if (!key || no == null || !window.months || !window.months[key]) return null;
    return window.months[key].rows.find(function(r){ return r.no === no; }) || null;
  }

  function saveThumbData(dataUrl, done){
    var key = window.__fbCurKey, no = window.__fbCurNo;
    var fb = window.firebase;
    if (!key || no == null || !fb){ alert('保存先が特定できませんでした'); return; }
    var u = fb.auth().currentUser;
    fb.firestore().collection('edits').doc(key + '_' + no).set({
      thumbData: dataUrl,
      updatedAt: fb.firestore.FieldValue.serverTimestamp(),
      updatedBy: (u && u.email) || 'unknown',
    }, {merge:true}).then(function(){
      var r = currentRow();
      if (r) r.thumbData = dataUrl;
      if (done) done(true);
    }).catch(function(e){ alert('保存失敗: ' + e.message); if (done) done(false); });
  }

  function processImageFile(file, zone){
    var fr = new FileReader();
    fr.onload = function(){
      var img = new Image();
      img.onload = function(){
        var W = 480;
        var scale = Math.min(1, W / img.width);
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        var dataUrl = c.toDataURL('image/jpeg', 0.82);
        if (dataUrl.length > 700000){ alert('画像の変換後サイズが大きすぎます'); return; }
        zone.querySelector('.tpz-msg').textContent = '保存中...';
        saveThumbData(dataUrl, function(ok){
          if (ok) renderZone(zone, dataUrl);
          if (ok && typeof window.showToast === 'function') window.showToast('✓ サムネ画像を保存しました');
        });
      };
      img.onerror = function(){ alert('この画像形式は貼り付けできません（HEICはスクショで貼り付けてください）'); };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  function renderZone(zone, dataUrl){
    var prev = zone.querySelector('.tpz-preview');
    var msg = zone.querySelector('.tpz-msg');
    var del = zone.querySelector('.tpz-del');
    if (dataUrl){
      prev.src = dataUrl; prev.style.display = 'block';
      msg.textContent = '画像を差し替えるには、ここをクリックして Cmd+V（または画像ファイルをドロップ）';
      del.style.display = 'inline-block';
    } else {
      prev.style.display = 'none';
      msg.textContent = '📋 ここをクリックして Cmd+V でサムネ画像を貼り付け（ドロップ・クリックで選択も可）';
      del.style.display = 'none';
    }
  }

  function injectPasteZone(){
    var panel = document.getElementById('fb-edit-panel');
    if (!panel || document.getElementById('thumb-paste-zone')) return;
    var thumbInput = document.getElementById('fb-edit-ext-thumbUrl');
    if (!thumbInput) return;
    var row = thumbInput.closest('.fb-edit-row') || thumbInput.parentNode;

    var zone = document.createElement('div');
    zone.id = 'thumb-paste-zone';
    zone.tabIndex = 0;
    zone.style.cssText = 'margin:8px 0 4px;padding:14px;border:2px dashed var(--border,#444);border-radius:10px;text-align:center;cursor:pointer;outline:none;background:var(--surface2,#1a1a28);';
    zone.innerHTML = '<div class="tpz-msg" style="font-size:11px;color:var(--text-muted,#999);line-height:1.6;"></div>' +
      '<img class="tpz-preview" style="display:none;max-width:100%;max-height:180px;border-radius:8px;margin:8px auto 0;">' +
      '<button type="button" class="tpz-del" style="display:none;margin-top:8px;padding:5px 14px;background:transparent;border:1px solid var(--accent,#f36);border-radius:7px;color:var(--accent,#f36);font-size:11px;cursor:pointer;">🗑 貼り付け画像を削除</button>' +
      '<input type="file" class="tpz-file" accept="image/*" style="display:none;">';
    row.parentNode.insertBefore(zone, row.nextSibling);

    var r = currentRow();
    renderZone(zone, r && r.thumbData && r.thumbData.indexOf('data:image') === 0 ? r.thumbData : '');

    zone.addEventListener('focus', function(){ zone.style.borderColor = 'var(--accent2,#7c4dff)'; });
    zone.addEventListener('blur', function(){ zone.style.borderColor = 'var(--border,#444)'; });
    zone.addEventListener('paste', function(ev){
      var items = (ev.clipboardData || {}).items || [];
      for (var i = 0; i < items.length; i++){
        if (items[i].type.indexOf('image') === 0){
          ev.preventDefault();
          processImageFile(items[i].getAsFile(), zone);
          return;
        }
      }
      zone.querySelector('.tpz-msg').textContent = 'クリップボードに画像がありません。スクショや画像をコピーしてから Cmd+V してください';
    });
    zone.addEventListener('dragover', function(ev){ ev.preventDefault(); zone.style.borderColor = 'var(--accent3,#0c6)'; });
    zone.addEventListener('dragleave', function(){ zone.style.borderColor = 'var(--border,#444)'; });
    zone.addEventListener('drop', function(ev){
      ev.preventDefault();
      zone.style.borderColor = 'var(--border,#444)';
      var f = ev.dataTransfer.files[0];
      if (f && f.type.indexOf('image') === 0) processImageFile(f, zone);
    });
    zone.addEventListener('click', function(ev){
      if (ev.target.classList.contains('tpz-del')){
        if (!confirm('貼り付けたサムネ画像を削除しますか？')) return;
        saveThumbData('', function(ok){ if (ok) renderZone(zone, ''); });
        return;
      }
      if (ev.target.classList.contains('tpz-preview')) return;
      zone.focus();
      zone.querySelector('.tpz-file').click();
    });
    zone.querySelector('.tpz-file').addEventListener('change', function(){
      if (this.files[0]) processImageFile(this.files[0], zone);
      this.value = '';
    });
  }

  // 編集パネルは動的に生成されるので出現を監視する
  var mo = new MutationObserver(function(){ enhancePanel(); try { setupMaterialRows(); } catch(e){} try { setupImagePreview(); } catch(e){} try { injectPasteZone(); } catch(e){} });
  mo.observe(document.body, { childList: true, subtree: true });
})();
