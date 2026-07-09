// analytics-addon.js - YouTubeアナリティクス表示タブ
// data/analytics.json（GitHub Actionsが毎日更新）を読み込んで
// チャンネル統計・推移グラフ・動画別成績を表示する。
;(function(){
  var DATA_URL = 'data/analytics.json';
  var TAB_ID = 'yt-analytics-tab';
  var PANEL_ID = 'yt-analytics-panel';
  var data = null;

  // ---------- styles ----------
  var s = document.createElement('style');
  s.textContent = [
    '#'+TAB_ID+'{padding:14px 20px 12px;border:none;border-bottom:3px solid transparent;background:none;color:var(--text-muted);cursor:pointer;font-family:"Noto Sans JP",sans-serif;font-size:14px;font-weight:600;transition:all 0.2s;display:flex;flex-direction:column;align-items:flex-start;gap:3px;}',
    '#'+TAB_ID+':hover{color:var(--text);}',
    '#'+TAB_ID+'.active{color:var(--text);border-bottom-color:var(--accent2);}',
    '#'+TAB_ID+' .tab-meta{font-size:10px;font-family:"Space Mono";color:var(--text-dim);}',
    '#'+TAB_ID+'.active .tab-meta{color:var(--accent2);}',
    '#'+PANEL_ID+'{display:none;padding:24px 36px 60px;}',
    '#'+PANEL_ID+'.active{display:block;}',
    '.yta-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:24px;}',
    '.yta-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px 20px;position:relative;overflow:hidden;}',
    '.yta-card::before{content:"";position:absolute;top:0;left:0;width:100%;height:3px;background:var(--accent2);}',
    '.yta-card .yta-label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;}',
    '.yta-card .yta-value{font-size:26px;font-weight:700;font-family:"Space Mono",monospace;}',
    '.yta-card .yta-delta{font-size:11px;margin-top:4px;font-family:"Space Mono",monospace;}',
    '.yta-delta.up{color:var(--accent3);} .yta-delta.down{color:var(--accent);} .yta-delta.flat{color:var(--text-dim);}',
    '.yta-section-title{font-size:13px;font-weight:700;margin:26px 0 12px;color:var(--text);display:flex;align-items:center;gap:8px;}',
    '.yta-chart-box{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px;overflow-x:auto;}',
    '.yta-chart-tabs{display:flex;gap:8px;margin-bottom:10px;}',
    '.yta-chart-tabs button{padding:5px 14px;border-radius:20px;border:1px solid var(--border);background:var(--surface);color:var(--text-muted);cursor:pointer;font-size:11px;font-family:"Noto Sans JP",sans-serif;}',
    '.yta-chart-tabs button.active{border-color:var(--accent2);color:var(--accent2);}',
    '.yta-table-wrap{background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow-x:auto;}',
    '.yta-table-wrap table{width:100%;border-collapse:collapse;}',
    '.yta-table-wrap th{padding:12px 14px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);font-weight:500;white-space:nowrap;border-bottom:1px solid var(--border);}',
    '.yta-table-wrap td{padding:10px 14px;font-size:12px;border-bottom:1px solid var(--border);vertical-align:middle;}',
    '.yta-table-wrap tr:last-child td{border-bottom:none;}',
    '.yta-table-wrap tr:hover td{background:rgba(124,77,255,0.05);}',
    '.yta-num{font-family:"Space Mono",monospace;white-space:nowrap;}',
    '.yta-thumb{width:80px;height:45px;object-fit:cover;border-radius:6px;display:block;}',
    '.yta-vtitle{max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.yta-vtitle a{color:var(--text);text-decoration:none;}',
    '.yta-vtitle a:hover{color:var(--accent2);}',
    '.yta-empty{padding:60px 20px;text-align:center;color:var(--text-muted);font-size:13px;line-height:2;}',
    '.yta-updated{font-size:10px;color:var(--text-dim);font-family:"Space Mono",monospace;margin-bottom:16px;}',
    '@media(max-width:700px){#'+PANEL_ID+'{padding:16px 16px 60px;}.yta-vtitle{max-width:180px;}}'
  ].join('\n');
  document.head.appendChild(s);

  // ---------- helpers ----------
  function fmt(n){ return (n||0).toLocaleString('ja-JP'); }
  function esc(t){ return String(t||'').replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function deltaHtml(cur, prev, unit){
    if (prev == null) return '';
    var d = cur - prev;
    var cls = d > 0 ? 'up' : (d < 0 ? 'down' : 'flat');
    var sign = d > 0 ? '+' : '';
    return '<div class="yta-delta '+cls+'">'+sign+fmt(d)+' '+unit+'（過去30日）</div>';
  }
  function snapshotBefore(history, daysAgo){
    if (!history || !history.length) return null;
    var target = new Date(); target.setDate(target.getDate()-daysAgo);
    var ts = target.toISOString().slice(0,10);
    var cands = history.filter(function(h){ return h.date <= ts; });
    return cands.length ? cands[cands.length-1] : null;
  }

  // ---------- SVG line chart ----------
  function lineChart(history, field, color){
    if (!history || history.length < 2) return '<div class="yta-empty">グラフ表示にはデータの蓄積が必要です（毎日自動で記録されます）</div>';
    var pts = history.slice(-90);
    var W = 860, H = 220, PAD_L = 70, PAD_R = 16, PAD_T = 14, PAD_B = 28;
    var vals = pts.map(function(p){ return p[field]||0; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (min === max) { min -= 1; max += 1; }
    var span = max - min;
    min -= span*0.08; max += span*0.08;
    function x(i){ return PAD_L + (W-PAD_L-PAD_R) * i/(pts.length-1); }
    function y(v){ return PAD_T + (H-PAD_T-PAD_B) * (1-(v-min)/(max-min)); }
    var path = vals.map(function(v,i){ return (i?'L':'M')+x(i).toFixed(1)+','+y(v).toFixed(1); }).join(' ');
    var area = path + ' L'+x(vals.length-1).toFixed(1)+','+(H-PAD_B)+' L'+PAD_L+','+(H-PAD_B)+' Z';
    // y軸目盛り3本
    var grid = '';
    for (var g=0; g<3; g++){
      var gv = min + (max-min)*(g+0.5)/3;
      var gy = y(gv);
      grid += '<line x1="'+PAD_L+'" y1="'+gy+'" x2="'+(W-PAD_R)+'" y2="'+gy+'" stroke="var(--border)" stroke-dasharray="3,4" stroke-width="1"/>'
            + '<text x="'+(PAD_L-8)+'" y="'+(gy+3)+'" text-anchor="end" font-size="9" fill="var(--text-dim)" font-family="Space Mono">'+fmt(Math.round(gv))+'</text>';
    }
    // x軸ラベル（最初・中間・最後）
    var xl = [0, Math.floor((pts.length-1)/2), pts.length-1].map(function(i){
      return '<text x="'+x(i)+'" y="'+(H-8)+'" text-anchor="middle" font-size="9" fill="var(--text-dim)" font-family="Space Mono">'+pts[i].date.slice(5)+'</text>';
    }).join('');
    return '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;min-width:600px;height:auto;display:block">'
      + grid + xl
      + '<path d="'+area+'" fill="'+color+'" opacity="0.08"/>'
      + '<path d="'+path+'" fill="none" stroke="'+color+'" stroke-width="2" stroke-linejoin="round"/>'
      + '<circle cx="'+x(vals.length-1)+'" cy="'+y(vals[vals.length-1])+'" r="3.5" fill="'+color+'"/>'
      + '</svg>';
  }

  // ---------- render ----------
  var chartField = 'subscriberCount';
  var CHART_DEFS = [
    { field:'subscriberCount', label:'登録者数', color:'#7c4dff' },
    { field:'viewCount', label:'総再生回数', color:'#00e5a0' }
  ];

  function renderChart(){
    var box = document.getElementById('yta-chart');
    if (!box || !data) return;
    var def = CHART_DEFS.filter(function(d){ return d.field===chartField; })[0];
    box.innerHTML = lineChart(data.history, def.field, def.color);
    document.querySelectorAll('.yta-chart-tabs button').forEach(function(b){
      b.classList.toggle('active', b.dataset.field===chartField);
    });
  }

  function renderPanel(){
    var panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    if (!data || !data.channel){
      panel.innerHTML = '<div class="yta-empty">📊 アナリティクスデータがまだありません。<br>'
        + 'GitHub Actions の自動更新（YOUTUBE_API_KEY 設定後、毎日午前3時）をお待ちください。</div>';
      return;
    }
    var ch = data.channel;
    var prev30 = snapshotBefore(data.history, 30);
    var videos = (data.videos||[]).slice().sort(function(a,b){
      return (b.publishedAt||'').localeCompare(a.publishedAt||'');
    });

    panel.innerHTML =
      '<div class="yta-updated">最終更新: '+esc((data.updatedAt||'').replace('T',' ').slice(0,16))+'（毎日 午前3時に自動更新）</div>'
      + '<div class="yta-cards">'
      + '<div class="yta-card"><div class="yta-label">チャンネル登録者</div><div class="yta-value" style="color:var(--accent2)">'+fmt(ch.subscriberCount)+'</div>'+deltaHtml(ch.subscriberCount, prev30&&prev30.subscriberCount, '人')+'</div>'
      + '<div class="yta-card"><div class="yta-label">総再生回数</div><div class="yta-value" style="color:var(--accent3)">'+fmt(ch.viewCount)+'</div>'+deltaHtml(ch.viewCount, prev30&&prev30.viewCount, '回')+'</div>'
      + '<div class="yta-card"><div class="yta-label">公開動画数</div><div class="yta-value" style="color:var(--accent4)">'+fmt(ch.videoCount)+'</div>'+deltaHtml(ch.videoCount, prev30&&prev30.videoCount, '本')+'</div>'
      + '</div>'
      + '<div class="yta-section-title">📈 推移（直近90日）</div>'
      + '<div class="yta-chart-box"><div class="yta-chart-tabs">'
      + CHART_DEFS.map(function(d){ return '<button data-field="'+d.field+'">'+d.label+'</button>'; }).join('')
      + '</div><div id="yta-chart"></div></div>'
      + '<div class="yta-section-title">🎬 動画別成績（直近'+videos.length+'本）</div>'
      + '<div class="yta-table-wrap"><table><thead><tr><th></th><th>公開日</th><th>タイトル</th><th style="text-align:right">再生数</th><th style="text-align:right">高評価</th><th style="text-align:right">コメント</th></tr></thead><tbody>'
      + videos.map(function(v){
          return '<tr>'
            + '<td>'+(v.thumbnail?'<a href="https://youtu.be/'+esc(v.id)+'" target="_blank" rel="noopener"><img class="yta-thumb" src="'+esc(v.thumbnail)+'" loading="lazy" alt=""></a>':'')+'</td>'
            + '<td class="yta-num">'+esc((v.publishedAt||'').slice(0,10))+'</td>'
            + '<td class="yta-vtitle"><a href="https://youtu.be/'+esc(v.id)+'" target="_blank" rel="noopener" title="'+esc(v.title)+'">'+esc(v.title)+'</a></td>'
            + '<td class="yta-num" style="text-align:right;color:var(--accent3)">'+fmt(v.views)+'</td>'
            + '<td class="yta-num" style="text-align:right">'+fmt(v.likes)+'</td>'
            + '<td class="yta-num" style="text-align:right">'+fmt(v.comments)+'</td>'
            + '</tr>';
        }).join('')
      + '</tbody></table></div>';

    panel.querySelectorAll('.yta-chart-tabs button').forEach(function(b){
      b.addEventListener('click', function(){ chartField = b.dataset.field; renderChart(); });
    });
    renderChart();
  }

  // ---------- tab activation ----------
  function showAnalytics(){
    // silentSyncのrenderTabs()で月タブが再アクティブ化されないようactiveMonthを解除
    try { window.activeMonth = null; } catch(e){}
    document.querySelectorAll('.month-tab').forEach(function(t){ t.classList.remove('active'); });
    document.querySelectorAll('.dashboard').forEach(function(d){ d.classList.remove('active'); });
    var welcome = document.getElementById('welcome-screen');
    if (welcome) welcome.style.display = 'none';
    var bar = document.getElementById('month-tabs-bar');
    if (bar) bar.style.display = '';
    document.getElementById(TAB_ID).classList.add('active');
    document.getElementById(PANEL_ID).classList.add('active');
    renderPanel();
  }

  function hideAnalytics(){
    var tab = document.getElementById(TAB_ID);
    var panel = document.getElementById(PANEL_ID);
    if (tab) tab.classList.remove('active');
    if (panel) panel.classList.remove('active');
  }

  // 月タブに切り替えたらアナリティクスを閉じる
  function hookSetActiveMonth(){
    if (typeof window.setActiveMonth !== 'function'){ setTimeout(hookSetActiveMonth, 500); return; }
    if (window.__ytaHooked) return;
    window.__ytaHooked = true;
    var orig = window.setActiveMonth;
    window.setActiveMonth = function(){
      hideAnalytics();
      return orig.apply(this, arguments);
    };
  }

  // ---------- inject ----------
  function inject(){
    var bar = document.getElementById('month-tabs-bar');
    if (!bar){ setTimeout(inject, 500); return; }
    if (document.getElementById(TAB_ID)) return;

    var tab = document.createElement('button');
    tab.id = TAB_ID;
    tab.type = 'button';
    tab.innerHTML = '📊 アナリティクス<span class="tab-meta">CHANNEL STATS</span>';
    tab.addEventListener('click', showAnalytics);
    bar.insertBefore(tab, bar.firstChild);

    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    var container = document.getElementById('dashboards-container');
    container.parentNode.insertBefore(panel, container.nextSibling);
  }

  function load(){
    fetch(DATA_URL + '?_=' + Date.now())
      .then(function(r){ if(!r.ok) throw new Error(); return r.json(); })
      .then(function(j){
        data = j;
        var tab = document.getElementById(TAB_ID);
        if (tab && data.channel){
          tab.innerHTML = '📊 アナリティクス<span class="tab-meta">登録者 '+fmt(data.channel.subscriberCount)+'</span>';
        }
        if (document.getElementById(PANEL_ID) && document.getElementById(PANEL_ID).classList.contains('active')) renderPanel();
      })
      .catch(function(){ /* data未生成時は空表示のまま */ });
  }

  inject();
  hookSetActiveMonth();
  load();
  // 1時間ごとに再取得（デプロイ更新の反映用）
  setInterval(load, 3600000);
})();
