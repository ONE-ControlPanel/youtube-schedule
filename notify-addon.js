// notify-addon.js - 補足機能 + ChatWork通知（コピー方式）
;(function(){
    var CW_ROOM_ID = '399892175';
    // ---------- styles ----------
    var s = document.createElement('style');
    s.textContent = '.fb-note-badge{display:inline-block;background:#ff9500;color:#fff;font-size:9px;padding:1px 6px;border-radius:8px;margin-left:6px;font-weight:700;vertical-align:middle;}#fb-notify-btn{padding:10px 16px;background:linear-gradient(135deg,#7c4dff,#ff4dcb);color:#fff;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-size:12px;margin-left:8px;font-family:"Noto Sans JP",sans-serif;box-shadow:0 4px 12px rgba(124,77,255,0.3);}#fb-notify-btn:hover{transform:translateY(-1px);}#fb-nov{position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:"Noto Sans JP",sans-serif;}#fb-nov .box{background:#12121a;border:1px solid #2a2a40;border-radius:14px;padding:24px;width:600px;max-width:92vw;max-height:88vh;overflow-y:auto;color:#e8e8f0;}#fb-nov h3{margin:0 0 14px;font-size:16px;}#fb-nov .list{max-height:340px;overflow-y:auto;border:1px solid #2a2a40;border-radius:8px;padding:8px;background:#0a0a0f;}#fb-nov .item{display:flex;gap:10px;padding:6px 4px;align-items:flex-start;}#fb-nov .item label{flex:1;cursor:pointer;font-size:12px;line-height:1.5;color:#e8e8f0;}#fb-nov textarea{width:100%;min-height:220px;background:#0a0a0f;border:1px solid #2a2a40;border-radius:8px;padding:12px;color:#e8e8f0;font-size:13px;font-family:inherit;resize:vertical;line-height:1.6;box-sizing:border-box;}#fb-nov .row{display:flex;gap:8px;margin-top:14px;justify-content:flex-end;}#fb-nov button.primary{padding:10px 18px;background:#7c4dff;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:12px;}#fb-nov button.cancel{padding:10px 18px;background:transparent;color:#a8a8c0;border:1px solid #2a2a40;border-radius:8px;cursor:pointer;font-size:12px;}.fb-edit-row.note textarea{width:100%;min-height:70px;background:#0a0a0f;border:1px solid #2a2a40;border-radius:8px;padding:8px;color:#e8e8f0;font-size:12px;font-family:inherit;resize:vertical;box-sizing:border-box;}';
    document.head.appendChild(s);

    // ---------- helpers ----------
    function wkJP(d){ return ['日','月','火','水','木','金','土'][d.getDay()]; }
    function fmtDate(r){ var d=r.date||new Date(r.dateStr); return (d.getMonth()+1)+'/'+d.getDate()+'('+wkJP(d)+')'; }
    function escHtml(s){ return String(s||'').replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
    function currentKey(){
          var ats = document.querySelectorAll('[data-key]');
          for (var i=0;i<ats.length;i++){ if (ats[i].classList && ats[i].classList.contains('active')) return ats[i].getAttribute('data-key'); }
          var keys = Object.keys(window.months||{}); return keys.sort().pop();
    }

    // ---------- inject notify button ----------
    function injectNotifyBtn(){
          if (document.getElementById('fb-notify-btn')) return;
          var btns = document.querySelectorAll('button');
          var ref = null;
          for (var i=0;i<btns.length;i++){ if (btns[i].textContent.indexOf('最新データを読み込む')>=0){ ref = btns[i]; break; } }
          if (!ref){ setTimeout(injectNotifyBtn, 500); return; }
          var b = document.createElement('button');
          b.id = 'fb-notify-btn';
          b.type = 'button';
          b.textContent = '📢 素材アップ完了通知';
          b.addEventListener('click', openPicker);
          ref.parentNode.insertBefore(b, ref);
    }

    // ---------- picker ----------
    function openPicker(){
          var key = currentKey();
          if (!key || !window.months || !window.months[key]){ alert('月データを先に読み込んでください'); return; }
          var rows = window.months[key].rows.filter(function(r){ var t=r.__origTitle||r.title; return t && t.trim(); });
          if (!rows.length){ alert('対象動画がありません'); return; }
          var ov = document.createElement('div'); ov.id='fb-nov';
          var html = '<div class="box"><h3>📢 素材アップ完了通知 - 対象動画を選択</h3>'
            + '<div class="list">'
            + rows.map(function(r,i){
                        var n = (window.__fbNotes&&window.__fbNotes[key+'_'+r.no])||'';
                        var t = r.__origTitle||r.title;
                        return '<div class="item"><input type="checkbox" id="pk'+i+'" data-no="'+r.no+'"><label for="pk'+i+'">'+escHtml(fmtDate(r))+' - '+escHtml(t.substring(0,50))+(n?' <span style="color:#ff9500;font-weight:700">📝</span>':'')+'</label></div>';
            }).join('')
            + '</div>'
            + '<div class="row"><button class="cancel" id="pkc">キャンセル</button><button class="primary" id="pkn">次へ：プレビュー →</button></div></div>';
          ov.innerHTML = html;
          document.body.appendChild(ov);
          document.getElementById('pkc').onclick = function(){ ov.remove(); };
          document.getElementById('pkn').onclick = function(){
                  var picked = [];
                  ov.querySelectorAll('input[type=checkbox]:checked').forEach(function(cb){ picked.push(parseInt(cb.getAttribute('data-no'),10)); });
                  if (!picked.length){ alert('1件以上選択してください'); return; }
                  var pr = rows.filter(function(r){ return picked.indexOf(r.no)>=0; });
                  ov.remove();
                  openPreview(key, pr);
          };
    }

    function openPreview(key, rows){
          var dates = rows.map(fmtDate).join('・');
          var notes = [];
          rows.forEach(function(r){
                  var n = (window.__fbNotes&&window.__fbNotes[key+'_'+r.no])||'';
                  if (n.trim()) notes.push(fmtDate(r)+': '+n.trim());
          });
          var tmpl = '【依頼｜かずさんのYouTube】\n'
            + dates + '動画・サムネ素材アップ完了！\n'
            + '各担当者への依頼お願いします！\n'
            + '◾️補足' + (notes.length ? '\n'+notes.join('\n') : '(管理シートに記載がある場合)');
          var ov = document.createElement('div'); ov.id='fb-nov';
          ov.innerHTML = '<div class="box"><h3>📢 通知プレビュー（テキスト編集できます）</h3>'
            + '<textarea id="pvt"></textarea>'
            + '<div class="row"><button class="cancel" id="pvc">キャンセル</button>'
            + '<button class="primary" id="pvb">📋 コピーしてChatWorkを開く</button></div></div>';
          document.body.appendChild(ov);
          document.getElementById('pvt').value = tmpl;
          document.getElementById('pvc').onclick = function(){ ov.remove(); };
          document.getElementById('pvb').onclick = function(){
                  var txt = document.getElementById('pvt').value;
                  try {
                            navigator.clipboard.writeText(txt).then(function(){
                                        window.open('https://www.chatwork.com/#!rid'+CW_ROOM_ID, '_blank');
                                        ov.remove();
                            }, function(){
                                        var ta = document.getElementById('pvt'); ta.select(); document.execCommand('copy');
                                        window.open('https://www.chatwork.com/#!rid'+CW_ROOM_ID, '_blank');
                                        ov.remove();
                            });
                  } catch(e){
                            var ta = document.getElementById('pvt'); ta.select(); document.execCommand('copy');
                            window.open('https://www.chatwork.com/#!rid'+CW_ROOM_ID, '_blank');
                            ov.remove();
                  }
          };
    }

    // ---------- track current detail (key/no) ----------
    function hookShowDetail(){
          if (typeof window.showDetail !== 'function'){ setTimeout(hookShowDetail, 500); return; }
          if (window.__fbShowHooked) return;
          window.__fbShowHooked = true;
          var orig = window.showDetail;
          window.showDetail = function(key, no){
                  window.__fbCurKey = key;
                  window.__fbCurNo = no;
                  orig(key, no);
          };
    }

    // ---------- inject note textarea into edit panel ----------
    function watchEditPanel(){
          setInterval(function(){
                  var panel = document.getElementById('fb-edit-panel');
                  if (panel && !panel.querySelector('#fb-edit-note')){
                            var div = document.createElement('div');
                            div.className = 'fb-edit-row note';
                            div.innerHTML = '<label>◾️補足（注意事項等・ここはCW通知に乗ります）</label><textarea id="fb-edit-note" placeholder="例：5:24~7:25カット"></textarea>';
                            var save = panel.querySelector('#fb-save-btn');
                            if (save) panel.insertBefore(div, save); else panel.appendChild(div);
                            var k = window.__fbCurKey, n = window.__fbCurNo;
                            if (k && n && window.__fbNotes){
                                        var v = window.__fbNotes[k+'_'+n];
                                        if (v) document.getElementById('fb-edit-note').value = v;
                            }
                            // Hook save click to also persist myNote
                    save.addEventListener('click', function(){
                                var nv = document.getElementById('fb-edit-note') ? document.getElementById('fb-edit-note').value : '';
                                if (!firebase || !firebase.firestore) return;
                                var ck = window.__fbCurKey, cn = window.__fbCurNo;
                                if (!ck || !cn) return;
                                firebase.firestore().collection('edits').doc(ck+'_'+cn).set({
                                              myNote: nv,
                                              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                                }, {merge:true});
                    });
                  }
          }, 400);
    }

    // ---------- watch notes from Firestore ----------
    function watchNotes(){
          if (!window.firebase || !firebase.firestore){ setTimeout(watchNotes, 600); return; }
          if (!firebase.auth || !firebase.auth().currentUser){ setTimeout(watchNotes, 600); return; }
          if (window.__fbNotesHooked) return;
          window.__fbNotesHooked = true;
          firebase.firestore().collection('edits').onSnapshot(function(snap){
                  window.__fbNotes = window.__fbNotes || {};
                  snap.forEach(function(doc){
                            var d = doc.data();
                            if (d && d.myNote !== undefined) window.__fbNotes[doc.id] = d.myNote;
                  });
                  paintBadges();
          });
    }

    function paintBadges(){
          if (!window.__fbNotes || !window.months) return;
          var changed = false;
          Object.keys(window.months).forEach(function(k){
                  window.months[k].rows.forEach(function(r){
                            var nv = window.__fbNotes[k+'_'+r.no];
                            var has = nv && nv.trim();
                            if (has && r.title && r.title.indexOf('📝')<0){
                                        if (!r.__origTitle) r.__origTitle = r.title;
                                        r.title = '📝 ' + r.__origTitle; changed = true;
                            } else if (!has && r.__origTitle){
                                        r.title = r.__origTitle; delete r.__origTitle; changed = true;
                            }
                  });
          });
          if (changed){
                  if (typeof window.renderTabs === 'function') window.renderTabs();
                  if (typeof window.renderDashboard === 'function') window.renderDashboard();
          }
    }

    // ---------- boot ----------
    function boot(){
          injectNotifyBtn();
          hookShowDetail();
          watchEditPanel();
          watchNotes();
          // re-inject button on month re-render
      setInterval(injectNotifyBtn, 2000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
