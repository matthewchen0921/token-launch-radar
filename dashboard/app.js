// Token Radar's dashboard (radar-2). It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable and sortable table, a per-protocol detail view with
// the model's own breakdown and the costed farm plan, a compare tray, and the live-token anchors.
// No network: every byte it shows is in data.js.
//
// The model, as the page states it: implied value = TVL x fitted multiple x growth x maturity.
// The fitted multiple is the median market-cap/TVL ratio of the tokenised protocols in the same
// category (shrunk toward the global median, k = 5; ratios winsorised to [0.005, 2.0]), fitted by
// main.ts from the snapshot and carried in DATA.model_fit; the blind test in DATA.model_test
// scores that fit on a 20% holdout the fit never saw. Growth is the 7-day TVL change clamped to
// [-60, +120]% at weight 0.5; maturity rises with days listed, 0.6 to 1.0 over three years.
// The page recomputes a row's implied value from the row's own stored multiple and checks the
// number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var rows = DATA.rows, live = DATA.live;
  var state = { q: '', category: 'all', chain: 'all', verdict: 'all', momentum: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, compare: [] };

  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFmt.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // The model in one function: the page recomputes a row from its stored fitted multiple and
  // checks the number board.json carries.
  function impliedOf(row) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * row.multiple * growthMult * maturity));
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  // ---- KPI strip -------------------------------------------------------------
  (function renderKpis() {
    var kpis = $('kpis');
    var top = rows[0];
    var items = [
      [DATA.totals.protocols, 'protocols in snapshot'],
      [DATA.board_size, 'pre-token rows ranked'],
      [DATA.watchlist_size, 'watchlist covered'],
      [DATA.verdict_counts.FARM + ' FARM', DATA.verdict_counts.THIN + ' THIN · ' + DATA.verdict_counts.SKIP + ' SKIP'],
      [top ? fmtUsd(top.implied_value_usd) : '—', 'top implied value' + (top ? ' · ' + top.name : '')],
      [DATA.model_test.fitted_med_log_err, 'blind-test med |log err| (flat ' + DATA.model_test.flat_med_log_err + ')'],
    ];
    items.forEach(function (it) {
      var d = el('div', 'kpi');
      d.appendChild(el('b', null, String(it[0])));
      d.appendChild(el('span', null, it[1]));
      kpis.appendChild(d);
    });
    $('asof').textContent = 'Snapshot ' + DATA.as_of + ' · model ' + DATA.model_version;
    $('source').textContent = 'Source: ' + DATA.source + '.';
  })();

  // ---- Model panel -----------------------------------------------------------
  (function renderModel() {
    var box = $('model');
    var t = DATA.model_test, f = DATA.model_fit, m = DATA.model;
    box.appendChild(el('h2', null, 'How the value is fitted — and tested blind'));
    var p = el('p');
    p.innerHTML = 'Each protocol’s implied value is its TVL times a <b>fitted multiple</b>: the median ' +
      'market-cap / TVL ratio of the <b>' + f.comps + ' tokenised protocols</b> in the same category, ' +
      'shrunk toward the global median (' + f.global_multiple.toFixed(3) + ') with k = ' + m.shrink_k +
      ', ratios winsorised to [' + m.winsor_low + ', ' + m.winsor_high + ']. A category with no comps takes the ' +
      'global multiple. Growth is the 7-day TVL change (clamped to [' + m.growth_floor + ', +' + m.growth_cap +
      ']%, weight ' + m.growth_weight + '); maturity rises with days listed, ' + m.maturity_floor + ' to ' +
      (m.maturity_floor + m.maturity_range) + ' over ' + (m.maturity_days / 365) + ' years. ' +
      'Wrapped, staked and bridged products are never ranked — they are not launches waiting to happen.';
    box.appendChild(p);
    var formula = el('p', 'formula', 'implied = TVL × multiple(category) × (1 + clamp(7d, −60, +120)% × 0.5) × (0.6 + min(age, 1095) / 1095 × 0.4)');
    box.appendChild(formula);
    var test = el('p', 'test');
    test.innerHTML = '<b>Blind test</b> (' + esc(t.split) + ', ' + t.fit_n + ' fitted, ' + t.test_n +
      ' held out): median |log error| <b>fitted ' + t.fitted_med_log_err + '</b> vs flat fitted median ' +
      t.flat_med_log_err + ' vs starter flat 0.25 ' + t.starter_med_log_err +
      '. The test scores the fitted multiple only; growth and maturity are the house’s stated adjustments, applied on top.';
    box.appendChild(test);
    var wrap = el('div', 'multis');
    Object.keys(f.by_category).sort(function (a, b) { return f.by_category[b] - f.by_category[a]; }).slice(0, 12).forEach(function (c) {
      var s = el('span', 'multi');
      s.innerHTML = esc(c) + ' <b>×' + f.by_category[c].toFixed(3) + '</b>';
      wrap.appendChild(s);
    });
    box.appendChild(wrap);
  })();

  // ---- Filters ---------------------------------------------------------------
  var catSel = $('f-category'), chainSel = $('f-chain');
  (function fillFilters() {
    var cats = {}, chains = {};
    rows.forEach(function (r) { if (r.category) cats[r.category] = 1; r.chains.forEach(function (c) { chains[c] = 1; }); });
    [['all', 'All categories']].concat(Object.keys(cats).sort().map(function (c) { return [c, c]; })).forEach(function (o) {
      catSel.appendChild(new Option(o[1], o[0]));
    });
    [['all', 'All chains']].concat(Object.keys(chains).sort().map(function (c) { return [c, c]; })).forEach(function (o) {
      chainSel.appendChild(new Option(o[1], o[0]));
    });
  })();

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (state.momentum === 'up' && !(r.change_7d !== null && r.change_7d >= 0)) return false;
      if (state.momentum === 'down' && !(r.change_7d !== null && r.change_7d < 0)) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function sorted(list) {
    var key = state.sort, dir = state.dir;
    var val = function (r) {
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
      if (key === 'age') return r.age_days === null ? -1 : r.age_days;
      if (key === 'name') return r.name.toLowerCase();
      if (key === 'multiple') return r.multiple;
      if (key === 'rank') return r.rank;
      if (key === 'verdict') return { FARM: 0, THIN: 1, SKIP: 2 }[r.verdict];
      return r.implied_value_usd;
    };
    return list.slice().sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.slug < b.slug ? -1 : 1;
    });
  }

  // ---- Table -----------------------------------------------------------------
  function renderTable() {
    var tbody = $('rows');
    tbody.innerHTML = '';
    if (state.tab !== 'pre-token') { $('empty').hidden = true; $('count').textContent = ''; return; }
    var list = sorted(filtered());
    $('count').textContent = list.length + ' of ' + rows.length + ' pre-token protocols · click a row for its model breakdown and farm plan.';
    $('empty').hidden = list.length > 0;
    list.slice(0, 120).forEach(function (r) {
      var tr = document.createElement('tr');
      if (state.selected === r.slug) tr.className = 'sel';
      tr.setAttribute('tabindex', '0');
      tr.innerHTML =
        '<td class="num">' + r.rank + '</td>' +
        '<td class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.slug) + ' · ' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'up' : 'down') + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">×' + r.multiple.toFixed(3) + '</td>' +
        '<td class="num"><b>' + fmtUsd(r.implied_value_usd) + '</b>' + (impliedOf(r) !== r.implied_value_usd ? ' ≠' : '') + '</td>' +
        '<td><span class="badge ' + r.verdict + '">' + r.verdict + '</span></td>' +
        '<td><input type="checkbox" aria-label="Compare ' + esc(r.name) + '"' + (state.compare.indexOf(r.slug) >= 0 ? ' checked' : '') + '></td>';
      tr.addEventListener('click', function (ev) {
        if (ev.target.tagName === 'INPUT') return;
        select(r.slug);
      });
      tr.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') select(r.slug); });
      var box = tr.querySelector('input');
      box.addEventListener('click', function (ev) { ev.stopPropagation(); toggleCompare(r.slug); });
      tbody.appendChild(tr);
    });
    if (list.length > 120) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = 8; td.textContent = 'Showing the top 120 of ' + list.length + ' matches — narrow the filters to see more.';
      td.style.color = 'var(--muted)'; tr.appendChild(td); tbody.appendChild(tr);
    }
  }

  // ---- Detail ----------------------------------------------------------------
  function select(slug) {
    state.selected = slug;
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    var box = $('detail');
    if (!r) { box.hidden = true; renderTable(); return; }
    var m = DATA.model;
    box.hidden = false;
    box.innerHTML = '';
    var head = el('div', 'head');
    var h = el('div');
    h.appendChild(el('h2', null, '#' + r.rank + ' ' + r.name));
    h.appendChild(el('p', 'meta', r.slug + ' · ' + (r.category || 'Uncategorised') + ' · ' + r.chains.join(', ') +
      ' · listed ' + (r.listed_at || 'unknown') + ' (' + fmtAge(r.age_days) + ') · records no token'));
    head.appendChild(h);
    var close = el('button', 'close', 'Close');
    close.addEventListener('click', function () { state.selected = null; box.hidden = true; renderTable(); });
    head.appendChild(close);
    box.appendChild(head);
    var bd = el('div', 'breakdown');
    var cells = [
      ['TVL', fmtUsd(r.tvl_usd), ''],
      ['Fitted multiple', '×' + r.multiple.toFixed(3), 'category ' + (r.category || 'Uncategorised') + ' · global ×' + DATA.model_fit.global_multiple.toFixed(3)],
      ['Growth × maturity', '×' + r.growth_multiplier.toFixed(3) + ' × ' + r.maturity_multiplier.toFixed(3), fmtPct(r.change_7d) + ' over 7d · ' + fmtAge(r.age_days) + ' listed'],
      ['Implied value', fmtUsd(r.implied_value_usd), 'verdict ' + r.verdict + ' · farmer pool (5%) ' + fmtUsd(r.farmer_pool_usd)],
    ];
    cells.forEach(function (c) {
      var d = el('div', 'step-box');
      d.appendChild(el('span', null, c[0]));
      d.appendChild(el('b', null, c[1]));
      d.appendChild(el('small', null, c[2]));
      bd.appendChild(d);
    });
    box.appendChild(bd);
    var note = el('p', 'test');
    note.innerHTML = 'Check: recomputing from the row’s own multiple gives <b>' + fmtUsd(impliedOf(r)) + '</b>' +
      (impliedOf(r) === r.implied_value_usd ? ' — the page and the board agree.' : ' — differs from the board; see board.json.');
    box.appendChild(note);
    box.appendChild(el('h2', null, 'Farm plan — ' + r.verdict + ' · about $' + r.plan_cost_usd + ' gas, ' + r.plan_hours + 'h'));
    var ol = el('ol', 'steps');
    r.farm_steps.forEach(function (s) {
      var li = el('li');
      li.textContent = s;
      ol.appendChild(li);
    });
    box.appendChild(ol);
    box.scrollIntoView({ behavior: 'auto', block: 'start' });
    renderTable();
  }

  // ---- Compare ----------------------------------------------------------------
  function toggleCompare(slug) {
    var i = state.compare.indexOf(slug);
    if (i >= 0) state.compare.splice(i, 1);
    else { state.compare.push(slug); if (state.compare.length > 2) state.compare.shift(); }
    renderCompare();
    renderTable();
  }
  function renderCompare() {
    var box = $('compare');
    if (state.compare.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '';
    box.appendChild(el('h2', null, 'Compare — pick two rows'));
    var grid = el('div', 'grid');
    state.compare.forEach(function (slug) {
      var r = null; rows.forEach(function (x) { if (x.slug === slug) r = x; });
      if (!r) return;
      var d = el('div');
      d.appendChild(el('h2', null, '#' + r.rank + ' ' + r.name));
      var dl = document.createElement('dl');
      [['Implied value', fmtUsd(r.implied_value_usd)], ['TVL', fmtUsd(r.tvl_usd)], ['7d', fmtPct(r.change_7d)],
       ['Fitted multiple', '×' + r.multiple.toFixed(3)], ['Age', fmtAge(r.age_days)],
       ['Verdict', r.verdict + ' · pool ' + fmtUsd(r.farmer_pool_usd)], ['Plan cost', '$' + r.plan_cost_usd + ' gas · ' + r.plan_hours + 'h']].forEach(function (kv) {
        dl.appendChild(el('dt', null, kv[0]));
        dl.appendChild(el('dd', null, kv[1]));
      });
      d.appendChild(dl);
      grid.appendChild(d);
    });
    box.appendChild(grid);
    box.appendChild(el('p', 'vs', 'The higher implied value wins the rank; the verdict says whether the farm plan is worth running.'));
  }

  // ---- Live tokens -------------------------------------------------------------
  function renderLive() {
    var box = $('live');
    if (state.tab !== 'live') { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '';
    box.appendChild(el('h2', null, 'Live tokens — the anchors the multiples are fitted from'));
    var p = el('p', 'test', 'These protocols already trade. The board shows the market’s own value for them, never a model’s — they are the comps the fitted multiples come from.');
    box.appendChild(p);
    var t = document.createElement('table');
    t.innerHTML = '<thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">mcap / TVL</th><th class="num">7d</th></tr></thead>';
    var tb = document.createElement('tbody');
    live.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td><td class="num">' + fmtUsd(r.mcap_usd) + '</td>' +
        '<td class="num">' + (r.mcap_usd !== null && r.tvl_usd ? '×' + (r.mcap_usd / r.tvl_usd).toFixed(3) : 'n/a') + '</td>' +
        '<td class="num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'up' : 'down') + '">' + fmtPct(r.change_7d) + '</td>';
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    box.appendChild(t);
  }

  // ---- Wiring ------------------------------------------------------------------
  function setTab(tab) {
    state.tab = tab;
    $('tab-board').setAttribute('aria-selected', tab === 'pre-token' ? 'true' : 'false');
    $('tab-live').setAttribute('aria-selected', tab === 'live' ? 'true' : 'false');
    document.querySelector('.tablewrap').style.display = tab === 'pre-token' ? '' : 'none';
    document.querySelector('.controls .filters').style.display = tab === 'pre-token' ? '' : 'none';
    renderLive();
    renderTable();
  }
  $('tab-board').addEventListener('click', function () { setTab('pre-token'); });
  $('tab-live').addEventListener('click', function () { setTab('live'); });
  $('q').addEventListener('input', function (ev) { state.q = ev.target.value; renderTable(); });
  catSel.addEventListener('change', function (ev) { state.category = ev.target.value; renderTable(); });
  chainSel.addEventListener('change', function (ev) { state.chain = ev.target.value; renderTable(); });
  $('f-verdict').addEventListener('change', function (ev) { state.verdict = ev.target.value; renderTable(); });
  $('f-momentum').addEventListener('change', function (ev) { state.momentum = ev.target.value; renderTable(); });
  $('f-sort').addEventListener('change', function (ev) { state.sort = ev.target.value; state.dir = -1; renderTable(); });
  document.querySelectorAll('#table th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
      renderTable();
    });
  });

  // Deep links for the screenshots and for sharing a view: #p=<slug> opens the detail,
  // #category=<name>, #verdict=FARM|THIN|SKIP and #q=<text> set the filters, #tab=live opens anchors.
  (function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) { state.q = params.get('q'); $('q').value = state.q; }
    if (params.get('category')) { state.category = params.get('category'); catSel.value = state.category; }
    if (params.get('chain')) { state.chain = params.get('chain'); chainSel.value = state.chain; }
    if (params.get('verdict')) { state.verdict = params.get('verdict'); $('f-verdict').value = state.verdict; }
    if (params.get('tab')) setTab(params.get('tab'));
    if (params.get('p')) select(params.get('p'));
  })();

  renderTable();
  document.getElementById('board').setAttribute('aria-busy', 'false');
})();
