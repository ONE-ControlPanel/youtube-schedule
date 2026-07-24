// firestore-data-addon.js - 完全脱スプレッドシート化
// Firestoreの edits コレクションに「行データ全体」(_full=true) を保存し、
// スプレッドシートを読まずにダッシュボードを構築する。
//
// 動作モード:
//   Firestoreに _full な行が1件も無い → 従来通りスプレッドシート読み込み（何もしない）
//   Firestoreに _full な行がある     → Firestoreモード（スプシ不要、リアルタイム同期）
//
// 移行: ログイン済みの状態でスプシのデータを表示してから、コンソールで
//   migrateToFirestore()
// を実行すると、表示中の全データがFirestoreに書き込まれる。
;(function(){
  var MODE = null;            // 'firestore' | 'sheet'
  var unsubscribe = null;
  var rebuildTimer = null;

  function fb(){ return window.firebase; }
  function db(){ return fb().firestore(); }

  // ---------- 行データ <-> Firestoreドキュメント ----------
  var FIELDS = ['dateStr','changedDate','title','videoStaff','thumbStaff','videoCheck',
                'thumbCheck','reserved','requestDone','deliveryUrl','draftVideoUrl','fixedVideoUrl','reviewUrl','materialUrl1',
                'materialUrl2','materialUrl3','materialUrl4','materialUrl5','thumbUrl','thumbIdea','thumbData','imageIdeaUrl','imageIdeaData','thumbMaterialUrl','youtubeLink','notes'];

  function docToRow(id, d){
    var us = id.indexOf('_');
    var key = id.slice(0, us);
    var no = parseInt(id.slice(us + 1), 10);
    var r = { no: no, _monthKey: key, origDate: null, date: null, weekday: '' };
    FIELDS.forEach(function(f){ r[f] = (d[f] != null) ? d[f] : ''; });
    var ds = r.changedDate || r.dateStr;
    if (ds){
      var p = String(ds).split('/');
      if (p.length === 3){
        r.date = new Date(+p[0], +p[1]-1, +p[2]);
        r.date.setHours(0,0,0,0);
        r.weekday = ['日','月','火','水','木','金','土'][r.date.getDay()];
      }
    }
    // 旧「サムネ画像案」のテキストから イメージ画像/サムネ素材 URLを引き継ぐ
    if ((!r.imageIdeaUrl || !r.thumbMaterialUrl) && r.thumbIdea){
      var cur = '';
      String(r.thumbIdea).split(/\n/).forEach(function(line){
        var urls = line.match(/https?:\/\/[^\s]+/g);
        if (!urls){
          if (line.indexOf('イメージ') !== -1) cur = 'image';
          else if (line.indexOf('素材') !== -1) cur = 'material';
          return;
        }
        urls.forEach(function(u){
          if (cur === 'image' && !r.imageIdeaUrl) r.imageIdeaUrl = u;
          else if (cur === 'material' && !r.thumbMaterialUrl) r.thumbMaterialUrl = u;
          else if (!r.imageIdeaUrl) r.imageIdeaUrl = u;
          else if (!r.thumbMaterialUrl) r.thumbMaterialUrl = u;
        });
      });
    }
    return r;
  }

  function rowToDoc(r){
    var d = { _full: true, no: r.no };
    FIELDS.forEach(function(f){ d[f] = r[f] || ''; });
    return d;
  }

  function monthLabel(key){
    var p = key.split('-');
    return parseInt(p[0],10) + '年' + parseInt(p[1],10) + '月';
  }

  // ---------- Firestoreモード: monthsを構築 ----------
  function buildFromSnapshot(snap){
    var monthsData = {};
    snap.forEach(function(doc){
      var d = doc.data();
      if (!d._full || d._deleted) return;
      var id = doc.id;
      var us = id.indexOf('_');
      if (us < 1) return;
      var key = id.slice(0, us);
      if (!/^\d{4}-\d{2}$/.test(key)) return;
      if (!monthsData[key]) monthsData[key] = [];
      if (!d._monthMarker) monthsData[key].push(docToRow(id, d));
    });

    Object.keys(monthsData).sort().forEach(function(key){
      var rows = monthsData[key];
      rows.sort(function(a,b){
        var da = a.date ? a.date.getTime() : 9e15;
        var db_ = b.date ? b.date.getTime() : 9e15;
        return da - db_ || a.no - b.no;
      });
      if (window.months[key]) {
        window.months[key].rows = rows;
      } else {
        window.months[key] = { label: monthLabel(key), rows: rows };
        window.filters[key] = 'all';
        window.searches[key] = '';
        createDashboard(key);
      }
    });
    // Firestoreから消えた月を除去
    Object.keys(window.months).forEach(function(key){
      if (!monthsData[key]){
        delete window.months[key];
        var d = document.querySelector('.dashboard[data-key="'+key+'"]');
        if (d) d.remove();
      }
    });

    document.getElementById('welcome-screen').style.display = 'none';
    document.getElementById('month-tabs-bar').style.display = '';
    renderTabs();
    var todayKey = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0');
    var active = window.activeMonth && window.months[window.activeMonth] ? window.activeMonth
               : (window.months[todayKey] ? todayKey : Object.keys(window.months).sort()[0]);
    if (active) setActiveMonth(active);
    injectAddButtons();
  }

  function startFirestoreMode(){
    MODE = 'firestore';
    console.log('[firestore-data] Firestoreモードで起動（スプレッドシート不使用）');
    // スプシ読み込みを無効化（welcome画面のボタンもFirestore再読込に差し替え）
    window.loadBuiltinData = function(){ /* firestoreモードでは何もしない */ };
    unsubscribe = db().collection('edits').onSnapshot(function(snap){
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(function(){ buildFromSnapshot(snap); }, 100);
    }, function(err){ console.error('[firestore-data] sync error:', err); });
  }

  // ---------- 追加・削除UI ----------
  function injectAddButtons(){
    // 各月に「＋ 動画を追加」
    Object.keys(window.months).forEach(function(key){
      var ctrl = document.getElementById('ctrl-' + key);
      if (!ctrl || ctrl.querySelector('.fsd-add-video')) return;
      var btn = document.createElement('button');
      btn.className = 'filter-btn fsd-add-video';
      btn.textContent = '＋ 動画を追加';
      btn.style.cssText = 'border-color:var(--accent3);color:var(--accent3);';
      btn.addEventListener('click', function(){ addVideo(key); });
      var search = ctrl.querySelector('.search-box');
      ctrl.insertBefore(btn, search || null);
    });
    // 「＋ 月を追加」を空の月作成に差し替え
    var addTab = document.getElementById('tab-add-btn');
    if (addTab && !addTab.dataset.fsd){
      addTab.dataset.fsd = '1';
      addTab.onclick = function(){
        var now = new Date();
        var def = now.getFullYear() + '-' + String(now.getMonth()+2 > 12 ? 1 : now.getMonth()+2).padStart(2,'0');
        if (now.getMonth()+2 > 12) def = (now.getFullYear()+1) + '-01';
        var key = prompt('追加する月を入力してください（例: ' + def + '）', def);
        if (!key) return;
        key = key.trim();
        if (!/^\d{4}-\d{2}$/.test(key)){ alert('形式が違います。「2026-08」のように入力してください'); return; }
        if (window.months[key]){ alert(monthLabel(key) + ' はすでに存在します'); return; }
        db().collection('edits').doc(key + '__month').set({
          _full: true, _monthMarker: true,
          updatedAt: fb().firestore.FieldValue.serverTimestamp(),
          updatedBy: (fb().auth().currentUser || {}).email || 'unknown',
        }).then(function(){ showToast('✓ ' + monthLabel(key) + ' を追加しました'); });
      };
    }
  }

  function addVideo(key){
    var rows = (window.months[key] || {rows:[]}).rows;
    var maxNo = rows.reduce(function(mx, r){ return Math.max(mx, r.no || 0); }, 0);
    var no = maxNo + 1;
    // 空タイトルだと一覧に表示されない(empty扱い)ため仮タイトルを入れる
    var doc = rowToDoc({ no: no, dateStr: '', title: '新規動画（タイトル未設定）' });
    doc.updatedAt = fb().firestore.FieldValue.serverTimestamp();
    doc.updatedBy = (fb().auth().currentUser || {}).email || 'unknown';
    db().collection('edits').doc(key + '_' + no).set(doc, {merge:true}).then(function(){
      showToast('✓ 動画枠を追加しました（No.' + no + '）');
      // 反映後に詳細モーダルを開いて編集開始
      setTimeout(function(){ try { showDetail(key, no); } catch(e){} }, 600);
    }).catch(function(e){ alert('追加に失敗しました: ' + e.message); });
  }

  // 詳細モーダルに削除ボタンを追加
  function injectDeleteButton(key, no){
    if (MODE !== 'firestore') return;
    var body = document.getElementById('modal-body');
    if (!body || document.getElementById('fsd-del-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'fsd-del-btn';
    btn.type = 'button';
    btn.textContent = '🗑 この動画を削除';
    btn.style.cssText = 'width:100%;margin-top:10px;padding:10px;background:transparent;border:1px solid var(--accent);border-radius:10px;color:var(--accent);font-size:12px;cursor:pointer;font-family:"Noto Sans JP",sans-serif;';
    btn.addEventListener('click', function(){
      var r = (window.months[key] || {rows:[]}).rows.find(function(x){ return x.no === no; });
      var title = r && r.title ? '「' + r.title.slice(0,30) + '」' : 'No.' + no;
      if (!confirm(title + ' を削除します。よろしいですか？')) return;
      db().collection('edits').doc(key + '_' + no).set({
        _deleted: true,
        updatedAt: fb().firestore.FieldValue.serverTimestamp(),
        updatedBy: (fb().auth().currentUser || {}).email || 'unknown',
      }, {merge:true}).then(function(){
        document.getElementById('modal-overlay').classList.remove('open');
        showToast('✓ 削除しました');
      });
    });
    body.appendChild(btn);
  }

  function hookShowDetailForDelete(){
    if (typeof window.showDetail !== 'function'){ setTimeout(hookShowDetailForDelete, 500); return; }
    if (window.__fsdDelHooked) return;
    window.__fsdDelHooked = true;
    var orig = window.showDetail;
    window.showDetail = function(key, no){
      var ret = orig.apply(this, arguments);
      try { injectDeleteButton(key, no); } catch(e){}
      return ret;
    };
  }

  // ---------- 移行（スプシ表示中に1回実行） ----------
  window.migrateToFirestore = function(){
    if (!window.months || !Object.keys(window.months).length){
      console.error('先に「最新データを読み込む」でスプレッドシートのデータを表示してください');
      return Promise.reject('no data');
    }
    var batchWrites = [];
    Object.keys(window.months).forEach(function(key){
      window.months[key].rows.forEach(function(r){
        // 完全に空の行はスキップ
        var hasContent = r.title || r.videoStaff || r.deliveryUrl || r.youtubeLink || r.reserved === 'TRUE';
        if (!hasContent) return;
        var doc = rowToDoc(r);
        doc.updatedAt = fb().firestore.FieldValue.serverTimestamp();
        doc.updatedBy = 'migration';
        batchWrites.push({ id: key + '_' + r.no, doc: doc });
      });
      batchWrites.push({ id: key + '__month', doc: { _full: true, _monthMarker: true, updatedBy: 'migration' } });
    });
    console.log('移行対象: ' + batchWrites.length + ' 件');
    var chain = Promise.resolve(), done = 0;
    batchWrites.forEach(function(w){
      chain = chain.then(function(){
        return db().collection('edits').doc(w.id).set(w.doc, {merge:true}).then(function(){
          done++;
          if (done % 20 === 0) console.log(done + '/' + batchWrites.length);
        });
      });
    });
    return chain.then(function(){
      console.log('✅ 移行完了: ' + done + ' 件。リロードするとFirestoreモードで動きます。');
      return done;
    });
  };

  // ---------- 起動 ----------
  function boot(){
    // SDK読み込みだけでなく initializeApp 完了(apps.length>0)まで待つ
    try {
      if (!fb() || !fb().auth || !fb().apps || !fb().apps.length){ setTimeout(boot, 500); return; }
    } catch(e){ setTimeout(boot, 500); return; }
    var checking = false;
    function checkMode(retry){
      if (MODE || checking) return;
      checking = true;
      db().collection('edits').where('_full','==',true).limit(1).get().then(function(snap){
        checking = false;
        if (MODE) return;
        if (!snap.empty){
          startFirestoreMode();
        } else {
          MODE = 'sheet';
          console.log('[firestore-data] シートモード（移行するには migrateToFirestore() を実行）');
        }
      }).catch(function(e){
        checking = false;
        console.error('[firestore-data] mode check failed (retry ' + retry + '):', e);
        // 通信失敗時は少し待って再試行（画面が空のままになるのを防ぐ）
        if (retry < 5) setTimeout(function(){ checkMode(retry + 1); }, 3000);
      });
    }
    fb().auth().onAuthStateChanged(function(user){
      if (!user) return;
      checkMode(0);
    });
  }
  boot();
  hookShowDetailForDelete();
})();
