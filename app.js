/* Pechanga.net Tribal Gaming Dashboard
   A small data runtime (dash.data / dash.calc / dash.draw) plus the dashboard's drawing code.
   Data lives in data/*.json and is refreshed daily. */
(function () {
  const DATASETS = ['meta', 'ggr_trend', 'ggr_regions', 'ggr_ranges', 'litigation', 'policy', 'key_dates', 'news_stories', 'news_mentions'];
  const store = {};
  const calcs = {};
  const draws = {};
  DATASETS.forEach((id) => { store[id] = { status: 'loading' }; });

  function runCalcs() {
    Object.keys(calcs).forEach((id) => {
      const def = calcs[id];
      const ins = def.inputs.map((i) => store[i] || { status: 'loading' });
      if (ins.some((x) => x.status === 'error')) { store[id] = { status: 'error' }; return; }
      if (!ins.every((x) => x.status === 'ok')) { store[id] = { status: 'loading' }; return; }
      try { store[id] = { status: 'ok', data: def.fn(...ins.map((x) => x.data)) }; }
      catch (e) { console.error('calc ' + id, e); store[id] = { status: 'error' }; }
    });
  }
  function drawOne(name) {
    const fn = draws[name];
    if (!fn) return;
    document.querySelectorAll('[data-draw="' + name + '"]').forEach((el) => {
      try { fn(el); } catch (e) { console.error('draw ' + name, e); }
    });
  }
  function drawAll() { runCalcs(); Object.keys(draws).forEach(drawOne); }

  window.dash = {
    data: (id) => store[id] || { status: 'loading' },
    calc: (id, def) => { calcs[id] = def; store[id] = { status: 'loading' }; },
    draw: (name, fn) => { if (fn) draws[name] = fn; drawOne(name); },
    setLink: (id) => { try { history.replaceState(null, '', id === 'tab-overview' ? location.pathname : '#' + id); } catch (e) { /* ignore */ } },
    redrawAll: drawAll
  };

  window.addEventListener('load', () => {
    const bust = new Date().toISOString().slice(0, 13);
    Promise.allSettled(DATASETS.map((id) =>
      fetch('data/' + id + '.json?v=' + bust, { cache: 'no-cache' })
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then((data) => { store[id] = { status: 'ok', data }; })
        .catch((e) => { console.warn('dataset ' + id, e); store[id] = { status: 'error' }; })
    )).then(drawAll);
  });
  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => ['trend', 'regions', 'tin-heat'].forEach(drawOne), 200); });
})();

(function () {
  window.tgFmt = {
    date(s) {
      if (!s) return '';
      const str = String(s);
      if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(str)) return d3.utcFormat('%b %-d, %Y')(d3.utcParse('%Y-%m-%d')(str));
      if (/^[0-9]{4}-[0-9]{2}$/.test(str)) return d3.utcFormat('%b %Y')(d3.utcParse('%Y-%m')(str));
      return str;
    },
    safeUrl(u) { return typeof u === 'string' && (u.startsWith('https://') || u.startsWith('http://')) ? u : null; },
    badgeClass(v) {
      if (v === 'Tribes' || v === 'States' || v === 'Supportive') return 'ok';
      if (v === 'Kalshi' || v === 'Opposed') return 'bad';
      if (v === 'Pending' || v === 'Monitoring') return 'warn';
      return '';
    }
  };
  window.tgCaseFilter = '';
  dash.calc('ggr_headline', {
    inputs: ['ggr_trend'],
    fn: (trend) => {
      const v = (y) => Number((trend.find((r) => Number(r.fiscal_year) === y) || {}).ggr_billion);
      const cur = v(2025), prev = v(2024);
      return [{ fy2025: cur, fy2024: prev, change_billion: +(cur - prev).toFixed(2), change_pct: +((cur - prev) / prev * 100).toFixed(1) }];
    }
  });
  dash.calc('ops_total', { inputs: ['ggr_regions'], fn: (regions) => d3.sum(regions, (r) => Number(r.operations_fy2025)) });
  dash.calc('case_tally', {
    inputs: ['litigation'],
    fn: (cases) => [
      { side: 'All', count: cases.length },
      { side: 'Tribal suits', count: cases.filter((c) => c.type === 'Tribal').length },
      { side: 'Decided', count: cases.filter((c) => c.leaning !== 'Pending').length },
      { side: 'States or tribes', count: cases.filter((c) => c.leaning === 'States' || c.leaning === 'Tribes').length }
    ]
  });
  dash.calc('policy_tally', {
    inputs: ['policy'],
    fn: (items) => [
      { group: 'All', count: items.length },
      { group: 'Opposed', count: items.filter((p) => p.tribal_position === 'Opposed').length }
    ]
  });
})();

(function () {
  const C = { copper: '#c8743a', amber: '#e9a25b', ember: '#ff9a4d', gold: '#f0c27a', bad: '#ef7a5f', muted: '#c4a88f' };
  document.querySelectorAll('#tg-case-filter').forEach((s) => s.addEventListener('change', () => { window.tgCaseFilter = s.value; dash.draw('cases'); dash.draw('cases-more'); }));

  function txt(el, fn) { el.textContent = fn(); }
  function rowOf(id, pred) {
    const d = dash.data(id);
    if (d.status !== 'ok') return null;
    return Array.isArray(d.data) ? d.data.find(pred) : d.data;
  }
  const fmtB = (v) => Number(v).toFixed(2);
  const fmtPct = (v) => (v >= 0 ? '+' : '') + Number(v).toFixed(1) + '%';

  dash.draw('asof', (el) => {
    const m = dash.data('meta');
    el.textContent = m.status === 'ok' && m.data.updated ? 'Data as of ' + window.tgFmt.date(m.data.updated) + ' · updated every morning' : 'Updated every morning';
  });
  ['lede-ggr', 'kpi-ggr'].forEach((n) => dash.draw(n, (el) => {
    const r = rowOf('ggr_trend', (x) => Number(x.fiscal_year) === 2025);
    txt(el, () => r ? fmtB(r.ggr_billion) : '—');
  }));
  ['lede-chg', 'kpi-chg'].forEach((n) => dash.draw(n, (el) => {
    const r = rowOf('ggr_headline', () => true);
    txt(el, () => r ? fmtPct(r.change_pct) : '—');
  }));
  dash.draw('kpi-ops', (el) => {
    const d = dash.data('ops_total');
    txt(el, () => d.status === 'ok' ? d3.format(',')(d.data) : '—');
  });
  const tally = (id, key, val) => (el) => {
    const r = rowOf(id, (x) => x[key] === val);
    txt(el, () => r ? String(r.count) : '—');
  };
  dash.draw('lede-wins', tally('case_tally', 'side', 'States or tribes'));
  dash.draw('lede-decided', tally('case_tally', 'side', 'Decided'));
  dash.draw('kpi-cases', tally('case_tally', 'side', 'All'));
  dash.draw('kpi-tribal', tally('case_tally', 'side', 'Tribal suits'));
  dash.draw('kpi-policy', tally('policy_tally', 'group', 'All'));
  dash.draw('kpi-opposed', tally('policy_tally', 'group', 'Opposed'));

  function statusRow(tbody, d, cols, label) {
    tbody.replaceChildren();
    if (d.status === 'ok') return false;
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = cols;
    if (d.status === 'error') { td.className = 'tg-err'; td.textContent = label + ' could not be loaded.'; }
    else { td.textContent = 'Loading…'; td.className = 'tg-small'; }
    tr.appendChild(td); tbody.appendChild(tr);
    return true;
  }
  function cell(tr, text, cls) {
    const td = document.createElement('td');
    if (cls) td.className = cls;
    td.textContent = text == null ? '' : text;
    tr.appendChild(td);
    return td;
  }
  function badge(tr, text) {
    const td = document.createElement('td');
    td.className = 'tg-nowrap';
    const s = document.createElement('span');
    s.className = 'tg-badge ' + window.tgFmt.badgeClass(text);
    s.textContent = text;
    td.appendChild(s); tr.appendChild(td);
  }

  dash.draw('cases', (tbody) => {
    const d = dash.data('litigation');
    if (statusRow(tbody, d, 6, 'The case list')) return;
    const f = window.tgCaseFilter;
    const rows = d.data.filter((r) => !f || r.type === f).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    (window.tgCasesAll ? rows : rows.slice(0, 5)).forEach((r) => {
      const tr = document.createElement('tr');
      const c = cell(tr, '');
      const b = document.createElement('div'); b.className = 'tg-case-name'; b.textContent = r.case; c.appendChild(b);
      const sub = document.createElement('div'); sub.className = 'tg-small'; sub.textContent = r.jurisdiction; c.appendChild(sub);
      const t = document.createElement('span'); t.className = 'tg-type' + (r.type === 'Tribal' ? ' tribal' : ''); t.textContent = r.type; c.appendChild(t);
      cell(tr, r.court, 'tg-small');
      const la = cell(tr, r.latest_action);
      const src = window.tgFmt.safeUrl(r.source_url);
      if (src) { const a = document.createElement('a'); a.href = src; a.target = '_blank'; a.rel = 'noopener'; a.className = 'tg-small'; a.textContent = ' Source ›'; la.appendChild(a); }
      cell(tr, window.tgFmt.date(r.date), 'tg-nowrap');
      badge(tr, r.leaning);
      cell(tr, r.next_step, 'tg-small');
      tbody.appendChild(tr);
    });
  });

  dash.draw('policy', (tbody) => {
    const d = dash.data('policy');
    if (statusRow(tbody, d, 6, 'The watch list')) return;
    const order = { 'Federal bill': 0, 'Federal rule': 1, 'Multistate': 2, 'State law': 3, 'State bill': 4, 'State policy': 5, 'State enforcement': 6 };
    d.data.slice().sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9)).slice(0, window.tgPolicyAll ? undefined : 5).forEach((r) => {
      const tr = document.createElement('tr');
      const c = cell(tr, '');
      const url = window.tgFmt.safeUrl(r.pechanga_url);
      if (url) {
        const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.className = 'tg-policy-link'; a.textContent = r.item; c.appendChild(a);
      } else { const s = document.createElement('span'); s.className = 'tg-case-name'; s.textContent = r.item; c.appendChild(s); }
      cell(tr, r.level, 'tg-small');
      const st = cell(tr, r.status, 'tg-nowrap');
      const dt = document.createElement('div'); dt.className = 'tg-small'; dt.textContent = window.tgFmt.date(r.date); st.appendChild(dt);
      badge(tr, r.tribal_position);
      cell(tr, r.why_it_matters);
      cell(tr, r.next_step, 'tg-small');
      tbody.appendChild(tr);
    });
  });

  function moreButton(el, total, flag, noun, redrawName) {
    el.replaceChildren();
    if (total <= 5) return;
    const open = !!window[flag];
    const b = document.createElement('button'); b.type = 'button'; b.className = 'tg-more-btn';
    b.setAttribute('aria-expanded', open ? 'true' : 'false');
    b.textContent = open ? 'Show fewer ▲' : 'Show all ' + total + ' ' + noun + ' ▼';
    b.addEventListener('click', () => { window[flag] = !window[flag]; dash.draw(redrawName); dash.draw(redrawName + '-more'); });
    const note = document.createElement('span'); note.className = 'tg-small';
    note.textContent = open ? '' : 'Showing 5 of ' + total;
    el.append(note, b);
  }
  dash.draw('cases-more', (el) => {
    const d = dash.data('litigation');
    if (d.status !== 'ok') { el.replaceChildren(); return; }
    const f = window.tgCaseFilter;
    moreButton(el, d.data.filter((r) => !f || r.type === f).length, 'tgCasesAll', 'cases', 'cases');
  });
  dash.draw('policy-more', (el) => {
    const d = dash.data('policy');
    if (d.status !== 'ok') { el.replaceChildren(); return; }
    moreButton(el, d.data.length, 'tgPolicyAll', 'items', 'policy');
  });

  dash.draw('ranges', (tbody) => {
    const d = dash.data('ggr_ranges');
    if (statusRow(tbody, d, 3, 'Revenue concentration')) return;
    d.data.forEach((r) => {
      const tr = document.createElement('tr');
      cell(tr, r.revenue_range, 'tg-case-name');
      [r.pct_of_operations, r.pct_of_ggr].forEach((v, i) => {
        const td = cell(tr, '');
        const wrap = document.createElement('div'); wrap.style.display = 'flex'; wrap.style.alignItems = 'center'; wrap.style.gap = '10px';
        const bar = document.createElement('div'); bar.style.height = '8px'; bar.style.borderRadius = '4px'; bar.style.flex = 'none';
        bar.style.width = Math.max(2, Number(v) * 1.4) + 'px';
        bar.style.background = i === 0 ? 'linear-gradient(90deg,#8a4a24,#c8743a)' : 'linear-gradient(90deg,#c8743a,#ff9a4d)';
        const lab = document.createElement('span'); lab.textContent = Number(v).toFixed(1) + '%'; lab.style.fontVariantNumeric = 'tabular-nums';
        wrap.append(bar, lab); td.appendChild(wrap);
      });
      tbody.appendChild(tr);
    });
  });

  function chartMsg(el, d, label) {
    el.replaceChildren();
    if (d.status === 'ok') return false;
    const p = document.createElement('p');
    p.className = d.status === 'error' ? 'tg-err' : 'tg-small';
    p.textContent = d.status === 'error' ? label + ' could not be loaded.' : '—';
    el.appendChild(p);
    return true;
  }
  function tip(container) {
    const t = document.createElement('div'); t.className = 'tg-tip'; t.hidden = true;
    container.style.position = 'relative';
    container.appendChild(t);
    return {
      show(lines, x, y) {
        t.replaceChildren(); lines.forEach((line, i) => { const s = document.createElement('div'); s.textContent = line; if (i === 0) { s.style.fontWeight = '600'; s.style.color = C.gold; } t.appendChild(s); });
        t.hidden = false;
        const w = container.clientWidth, tw = t.offsetWidth;
        t.style.left = Math.max(0, Math.min(w - tw, x - tw / 2)) + 'px';
        t.style.top = Math.max(0, y - t.offsetHeight - 10) + 'px';
      },
      hide() { t.hidden = true; }
    };
  }
  const motion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
  let trendAnimated = false, regionAnimated = false;
  const visible = (el) => el.offsetParent !== null;

  dash.draw('trend', (el) => {
    const d = dash.data('ggr_trend');
    if (chartMsg(el, d, 'The revenue trend')) return;
    const data = d.data.map((r) => ({ y: Number(r.fiscal_year), v: Number(r.ggr_billion) })).sort((a, b) => a.y - b.y);
    const W = Math.max(280, el.clientWidth), H = 240, m = { t: 26, r: 18, b: 28, l: 38 };
    const x = d3.scalePoint().domain(data.map((r) => r.y)).range([m.l, W - m.r]).padding(0.3);
    const y = d3.scaleLinear().domain([0, d3.max(data, (r) => r.v) * 1.15]).nice().range([H - m.b, m.t]);
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img')
      .attr('aria-label', 'Line chart of tribal gross gaming revenue, FY2019 to FY2025, in billions of dollars');
    const defs = svg.append('defs');
    const g = defs.append('linearGradient').attr('id', 'tgArea').attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
    g.append('stop').attr('offset', '0%').attr('stop-color', C.ember).attr('stop-opacity', 0.45);
    g.append('stop').attr('offset', '100%').attr('stop-color', C.copper).attr('stop-opacity', 0);
    const gl = defs.append('filter').attr('id', 'tgGlow').attr('x', '-20%').attr('y', '-20%').attr('width', '140%').attr('height', '140%');
    gl.append('feGaussianBlur').attr('stdDeviation', 3).attr('result', 'b');
    const fm = gl.append('feMerge'); fm.append('feMergeNode').attr('in', 'b'); fm.append('feMergeNode').attr('in', 'SourceGraphic');
    svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat((v) => '$' + v))
      .call((a) => a.select('.domain').remove()).call((a) => a.selectAll('.tick line').attr('stroke-dasharray', '2 4'));
    svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickFormat((v) => 'FY' + String(v).slice(2)).tickSizeOuter(0));
    svg.append('path').datum(data).attr('fill', 'url(#tgArea)').attr('d', d3.area().x((r) => x(r.y)).y0(H - m.b).y1((r) => y(r.v)));
    const line = svg.append('path').datum(data).attr('fill', 'none').style('stroke', C.ember).attr('stroke-width', 2.5).attr('filter', 'url(#tgGlow)')
      .attr('d', d3.line().x((r) => x(r.y)).y((r) => y(r.v)));
    if (motion && !trendAnimated && visible(el)) {
      trendAnimated = true;
      const len = line.node().getTotalLength();
      line.attr('stroke-dasharray', len + ' ' + len).attr('stroke-dashoffset', len).transition().duration(1100).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0)
        .on('end', function () { d3.select(this).attr('stroke-dasharray', null); });
    }
    svg.selectAll('circle.pt').data(data).join('circle').attr('class', 'pt').attr('cx', (r) => x(r.y)).attr('cy', (r) => y(r.v)).attr('r', 4.5)
      .style('fill', '#1a0d07').style('stroke', C.gold).attr('stroke-width', 2);
    svg.selectAll('.tg-lbl').data(data.filter((r, i) => i === data.length - 1 || r.y === 2020)).join('text')
      .attr('class', 'tg-lbl').attr('x', (r) => x(r.y)).attr('y', (r) => y(r.v) - 12).attr('text-anchor', (r) => r.y === 2020 ? 'middle' : 'end')
      .text((r) => r.y === 2020 ? 'Pandemic $' + r.v.toFixed(1) : 'Record $' + r.v.toFixed(2));
    const tt = tip(el);
    svg.selectAll('.hit').data(data).join('rect').attr('class', 'hit').attr('fill', 'transparent')
      .attr('x', (r) => x(r.y) - x.step() / 2).attr('width', x.step()).attr('y', m.t).attr('height', H - m.t - m.b)
      .on('pointermove', (ev, r) => {
        const prev = data.find((p) => p.y === r.y - 1);
        const lines = ['FY' + r.y, '$' + r.v.toFixed(2) + ' billion'];
        if (prev) lines.push(((r.v - prev.v) / prev.v * 100 >= 0 ? '+' : '') + ((r.v - prev.v) / prev.v * 100).toFixed(1) + '% vs. FY' + prev.y);
        const scale = el.clientWidth / W;
        tt.show(lines, x(r.y) * scale, y(r.v) * scale);
      })
      .on('pointerleave', () => tt.hide());
  });

  dash.draw('regions', (el) => {
    const d = dash.data('ggr_regions');
    if (chartMsg(el, d, 'Regional revenue')) return;
    const data = d.data.map((r) => ({ name: r.region, v: Number(r.ggr_fy2025) / 1e9, pct: Number(r.pct_change), ops: Number(r.operations_fy2025) })).sort((a, b) => b.v - a.v);
    const W = Math.max(280, el.clientWidth), rowH = 28, m = { t: 4, r: 104, b: 4, l: 104 };
    const H = m.t + m.b + data.length * rowH;
    const x = d3.scaleLinear().domain([0, d3.max(data, (r) => r.v)]).range([m.l, W - m.r]);
    const y = d3.scaleBand().domain(data.map((r) => r.name)).range([m.t, H - m.b]).padding(0.28);
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img')
      .attr('aria-label', 'Bar chart of FY2025 tribal gross gaming revenue by NIGC region with change from FY2024');
    const g = svg.append('defs').append('linearGradient').attr('id', 'tgBar').attr('x1', 0).attr('x2', 1);
    g.append('stop').attr('offset', '0%').attr('stop-color', '#7a3e1c');
    g.append('stop').attr('offset', '70%').attr('stop-color', C.copper);
    g.append('stop').attr('offset', '100%').attr('stop-color', C.ember);
    svg.selectAll('.nm').data(data).join('text').attr('x', m.l - 10).attr('y', (r) => y(r.name) + y.bandwidth() / 2).attr('dy', '0.35em').attr('text-anchor', 'end').text((r) => r.name);
    svg.selectAll('rect.track').data(data).join('rect').attr('class', 'track').attr('x', m.l).attr('y', (r) => y(r.name))
      .attr('width', W - m.r - m.l).attr('height', y.bandwidth()).attr('rx', 4).style('fill', 'rgba(200,116,58,0.07)');
    const bars = svg.selectAll('rect.bar').data(data).join('rect').attr('class', 'bar').attr('x', m.l).attr('y', (r) => y(r.name))
      .attr('height', y.bandwidth()).attr('rx', 4).style('fill', (r) => r.pct < 0 ? C.bad : 'url(#tgBar)');
    const wOf = (r) => Math.max(2, x(r.v) - m.l);
    if (motion && !regionAnimated && visible(el)) { regionAnimated = true; bars.attr('width', 0).transition().duration(900).delay((r, i) => i * 60).ease(d3.easeCubicOut).attr('width', wOf); }
    else bars.attr('width', wOf);
    svg.selectAll('.val').data(data).join('text').attr('x', (r) => x(r.v) + 8).attr('y', (r) => y(r.name) + y.bandwidth() / 2).attr('dy', '0.35em')
      .text((r) => '$' + r.v.toFixed(1) + 'B')
      .style('fill', '#f4e7d8').style('font-weight', 600)
      .append('tspan').attr('dx', 6).text((r) => (r.pct >= 0 ? '▲ ' : '▼ ') + Math.abs(r.pct).toFixed(1) + '%')
      .style('fill', (r) => r.pct < 0 ? C.bad : '#9ccc7d').style('font-weight', 500);
    const tt = tip(el);
    svg.selectAll('rect.hit').data(data).join('rect').attr('class', 'hit').attr('fill', 'transparent').attr('x', 0).attr('width', W)
      .attr('y', (r) => y(r.name) - 3).attr('height', y.bandwidth() + 6)
      .on('pointermove', (ev, r) => {
        const scale = el.clientWidth / W;
        tt.show([r.name + ' region', '$' + d3.format(',.2f')(r.v) + ' billion', (r.pct >= 0 ? '+' : '') + r.pct.toFixed(1) + '% vs. FY2024', r.ops + ' operations'], x(r.v) * scale, y(r.name) * scale);
      })
      .on('pointerleave', () => tt.hide());
  });

  const TABS = ['tab-overview', 'tab-courts', 'tab-tribes', 'tab-revenue'];
  window.tgOpenTab = (id) => {
    document.querySelectorAll('.tg-tabs [data-tab]').forEach((b) => {
      const on = b.getAttribute('data-tab') === id;
      b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.tg-tab').forEach((p) => { p.hidden = p.id !== id; });
    dash.setLink(id);
    dash.redrawAll();
  };
  document.querySelectorAll('.tg-tabs [data-tab]').forEach((b) => b.addEventListener('click', () => window.tgOpenTab(b.getAttribute('data-tab'))));
  const tabBtns = [...document.querySelectorAll('.tg-tabs [data-tab]')];
  tabBtns.forEach((b, i) => b.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const n = tabBtns[(i + (e.key === 'ArrowRight' ? 1 : tabBtns.length - 1)) % tabBtns.length];
    n.focus(); n.click();
  }));
  const startTab = (location.hash || '').slice(1);
  if (TABS.slice(1).includes(startTab)) {
    document.querySelectorAll('.tg-tab').forEach((p) => { p.hidden = p.id !== startTab; });
    tabBtns.forEach((b) => { const on = b.getAttribute('data-tab') === startTab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
  }

  window.tgKdAll = false;
  const todayMs = (() => { const t = new Date(); return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()); })();
  const upcoming = (rows) => rows.filter((r) => Date.parse(r.sort_date + 'T00:00:00Z') >= todayMs).sort((a, b) => a.sort_date.localeCompare(b.sort_date));
  dash.draw('key-dates', (ul) => {
    const d = dash.data('key_dates');
    ul.replaceChildren();
    if (d.status !== 'ok') { const li = document.createElement('li'); li.className = d.status === 'error' ? 'tg-err' : 'tg-small'; li.textContent = d.status === 'error' ? 'Dates could not be loaded.' : '—'; ul.appendChild(li); return; }
    const rows = upcoming(d.data);
    if (!rows.length) { const li = document.createElement('li'); li.className = 'tg-small'; li.textContent = 'No upcoming dates on file.'; ul.appendChild(li); return; }
    (window.tgKdAll ? rows : rows.slice(0, 5)).forEach((r) => {
      const li = document.createElement('li');
      const days = Math.round((Date.parse(r.sort_date + 'T00:00:00Z') - todayMs) / 864e5);
      const dt = document.createElement('div'); dt.className = 'kd-date' + (days <= 7 ? ' soon' : '');
      const b = document.createElement('b'); b.textContent = r.when;
      const sm = document.createElement('small'); sm.textContent = r.when.startsWith('Early') ? 'date TBA' : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : 'in ' + days + ' days';
      dt.append(b, sm);
      const body = document.createElement('div');
      const ev = document.createElement('div'); ev.className = 'kd-event'; ev.textContent = r.event;
      const meta = document.createElement('div'); meta.className = 'kd-meta';
      const ty = document.createElement('span'); ty.className = 'kd-type' + (r.type === 'Policy' ? ' policy' : ''); ty.textContent = r.type;
      meta.append(ty, document.createTextNode(r.jurisdiction + ' · ' + r.related));
      body.append(ev, meta);
      li.append(dt, body); ul.appendChild(li);
    });
  });
  dash.draw('key-dates-more', (el) => {
    el.replaceChildren();
    const d = dash.data('key_dates'); if (d.status !== 'ok') return;
    const n = upcoming(d.data).length; if (n <= 5) return;
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'tg-more-btn';
    btn.textContent = window.tgKdAll ? 'Show fewer ▲' : 'Show all ' + n + ' dates ▼';
    btn.addEventListener('click', () => { window.tgKdAll = !window.tgKdAll; dash.draw('key-dates'); dash.draw('key-dates-more'); });
    el.appendChild(btn);
  });

  const STATES = { AK:'Alaska',AL:'Alabama',AR:'Arkansas',AZ:'Arizona',CA:'California',CO:'Colorado',CT:'Connecticut',DC:'District of Columbia',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',IA:'Iowa',ID:'Idaho',IL:'Illinois',IN:'Indiana',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',MA:'Massachusetts',MD:'Maryland',ME:'Maine',MI:'Michigan',MN:'Minnesota',MO:'Missouri',MS:'Mississippi',MT:'Montana',NC:'North Carolina',ND:'North Dakota',NE:'Nebraska',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NV:'Nevada',NY:'New York',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VA:'Virginia',VT:'Vermont',WA:'Washington',WI:'Wisconsin',WV:'West Virginia',WY:'Wyoming' };
  dash.calc('state_mentions', {
    inputs: ['news_mentions'],
    fn: (mentions) => {
      const day = (s) => Date.parse(s + 'T00:00:00Z');
      const end = Math.max(...mentions.map((m) => day(m.date)));
      const start = end - 29 * 864e5;
      const c = {};
      mentions.filter((m) => m.kind === 'Tribe' && day(m.date) >= start).forEach((m) => String(m.state || '').split('/').forEach((s) => { if (s.length === 2) c[s] = (c[s] || 0) + 1; }));
      return Object.entries(c).map(([state, mentions]) => ({ state, mentions })).sort((a, b) => b.mentions - a.mentions);
    }
  });
  window.tgMapSel = null;
  dash.draw('news-map', (el) => {
    const d = dash.data('state_mentions');
    el.replaceChildren();
    if (d.status !== 'ok') { const p = document.createElement('p'); p.className = d.status === 'error' ? 'tg-err' : 'tg-small'; p.textContent = d.status === 'error' ? 'The map could not be loaded.' : '—'; el.appendChild(p); return; }
    const v = {}; d.data.forEach((r) => { v[r.state] = Number(r.mentions); });
    const max = Math.max(1, ...Object.values(v));
    const MAP = window.US_MAP || {};
    const NS = 'http://www.w3.org/2000/svg';
    const box = document.createElement('div'); box.className = 'geo-map';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '-20 10 980 600'); svg.setAttribute('width', '100%');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Map of tribe mentions by state: ' + d.data.slice(0, 5).map((r) => STATES[r.state] + ' ' + r.mentions).join(', '));
    const tipEl = document.createElement('div'); tipEl.className = 'tg-tip'; tipEl.hidden = true;
    const labels = [];
    Object.keys(MAP).forEach((st) => {
      const n = v[st] || 0;
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', MAP[st]);
      p.setAttribute('class', 'geo-state' + (n ? ' has' : '') + (window.tgMapSel === st ? ' sel' : ''));
      p.style.fill = n ? d3.interpolateRgb('#4a2614', '#ff9a4d')(Math.sqrt(n / max)) : '#22130b';
      p.addEventListener('pointermove', (e) => {
        const r = box.getBoundingClientRect();
        tipEl.replaceChildren();
        const a = document.createElement('div'); a.textContent = STATES[st] || st; a.style.fontWeight = '600'; a.style.color = '#f0c27a';
        const b = document.createElement('div'); b.textContent = n + (n === 1 ? ' tribe mention' : ' tribe mentions');
        tipEl.append(a, b); tipEl.hidden = false;
        tipEl.style.left = Math.max(0, Math.min(r.width - tipEl.offsetWidth, e.clientX - r.left - tipEl.offsetWidth / 2)) + 'px';
        tipEl.style.top = Math.max(0, e.clientY - r.top - tipEl.offsetHeight - 12) + 'px';
      });
      p.addEventListener('pointerleave', () => { tipEl.hidden = true; });
      if (n) p.addEventListener('click', () => { window.tgMapSel = window.tgMapSel === st ? null : st; dash.draw('news-map'); dash.draw('news-map-detail'); });
      svg.appendChild(p);
      if (n >= 10) labels.push([st, n, p]);
    });
    box.append(svg, tipEl);
    el.appendChild(box);
    labels.forEach(([st, n, p]) => {
      let bb; try { bb = p.getBBox(); } catch (e) { return; }
      if (!bb || bb.width < 40) return;
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', bb.x + bb.width / 2); t.setAttribute('y', bb.y + bb.height / 2 + 5);
      t.setAttribute('class', 'geo-label'); t.textContent = st + ' ' + n;
      svg.appendChild(t);
    });
    const lg = document.createElement('div'); lg.className = 'map-legend';
    lg.append(document.createTextNode('Fewer'), document.createElement('i'), document.createTextNode('More mentions'));
    el.appendChild(lg);
  });
  dash.draw('news-map-detail', (el) => {
    el.replaceChildren();
    const st = window.tgMapSel; if (!st) return;
    const m = dash.data('news_mentions'); if (m.status !== 'ok') return;
    const day = (s) => Date.parse(s + 'T00:00:00Z');
    const end = Math.max(...m.data.map((x) => day(x.date)));
    const c = new Map();
    m.data.filter((x) => x.kind === 'Tribe' && day(x.date) >= end - 29 * 864e5 && String(x.state || '').split('/').includes(st)).forEach((x) => c.set(x.name, (c.get(x.name) || 0) + 1));
    const box = document.createElement('div'); box.className = 'map-detail';
    const h = document.createElement('h4'); h.textContent = STATES[st] + ' Tribes In The News'; box.appendChild(h);
    [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([name, n]) => {
      const b = document.createElement('button'); b.type = 'button';
      const a = document.createElement('span'); a.textContent = name + ' ›';
      const k = document.createElement('span'); k.textContent = n + (n === 1 ? ' story' : ' stories');
      b.append(a, k);
      b.addEventListener('click', () => {
        TIN.sel = { kind: 'Tribe', name };
        TIN.period = '30';
        syncPeriod();
        window.tgOpenTab('tab-tribes');
        const sec = document.getElementById('tribes-in-news'); if (sec) sec.scrollIntoView({ block: 'start' });
      });
      box.appendChild(b);
    });
    const note = document.createElement('p'); note.className = 'tg-small'; note.style.margin = '6px 0 0'; note.textContent = 'Select a tribe to open its stories in Tribes In The News.';
    box.appendChild(note);
    el.appendChild(box);
  });

  dash.calc('news_summary', {
    inputs: ['news_stories', 'news_mentions'],
    fn: (stories, mentions) => {
      const day = (s) => Date.parse(s + 'T00:00:00Z');
      const end = Math.max(...stories.map((s) => day(s.date)));
      return ['30', '7'].map((p) => {
        const start = end - (Number(p) - 1) * 864e5;
        const inP = (d) => day(d) >= start;
        const st = stories.filter((s) => inP(s.date));
        const m = mentions.filter((x) => inP(x.date));
        const tribes = new Set(m.filter((x) => x.kind === 'Tribe').map((x) => x.name));
        const ic = {};
        m.filter((x) => x.kind === 'Issue').forEach((x) => { ic[x.name] = (ic[x.name] || 0) + 1; });
        const top = Object.entries(ic).sort((a, b) => b[1] - a[1])[0];
        return { period: p, stories: st.length, tribes: tribes.size, top_issue: top ? top[0] : '', top_issue_stories: top ? top[1] : 0 };
      });
    }
  });

  const TIN = { period: '30', sel: null };
  const DAY = 864e5;
  const dnum = (s) => Date.parse(s + 'T00:00:00Z');
  function tinWindow(rows, period) {
    const end = Math.max(...rows.map((r) => dnum(r.date)));
    const days = Number(period);
    const start = end - (days - 1) * DAY;
    return { end, start, pstart: start - days * DAY };
  }
  function tinCounts(rows, kind, from, to) {
    const c = new Map();
    rows.forEach((r) => {
      if (r.kind !== kind) return;
      const t = dnum(r.date);
      if (t < from || t > to) return;
      const e = c.get(r.name) || { name: r.name, state: r.state, n: 0 };
      e.n++; c.set(r.name, e);
    });
    return c;
  }
  function tinDefaultSel(rows) {
    const w = tinWindow(rows, '30');
    const top = [...tinCounts(rows, 'Tribe', w.start, w.end).values()].sort((a, b) => b.n - a.n)[0];
    return top ? { kind: 'Tribe', name: top.name } : null;
  }
  function tinRedraw() { ['tin-tribes', 'tin-issues', 'tin-stories', 'tin-tribes-more', 'tin-issues-more', 'tin-heat'].forEach((n) => dash.draw(n)); }
  function syncPeriod() {
    document.querySelectorAll('[data-tin-period]').forEach((x) => {
      const on = x.getAttribute('data-tin-period') === TIN.period;
      x.classList.toggle('on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    document.querySelectorAll('.tin-summary [data-period]').forEach((s) => { s.hidden = s.getAttribute('data-period') !== TIN.period; });
  }
  document.querySelectorAll('[data-tin-period]').forEach((b) => b.addEventListener('click', () => {
    TIN.period = b.getAttribute('data-tin-period');
    syncPeriod();
    tinRedraw();
  }));

  const sumRow = (p, f) => (el) => {
    const r = rowOf('news_summary', (x) => x.period === p);
    txt(el, () => r ? String(r[f]) : '—');
  };
  ['30', '7'].forEach((p) => {
    dash.draw('tin-s' + p, sumRow(p, 'stories'));
    dash.draw('tin-t' + p, sumRow(p, 'tribes'));
    dash.draw('tin-i' + p, sumRow(p, 'top_issue'));
  });

  function tinRank(ul, kind, limit) {
    const d = dash.data('news_mentions');
    ul.replaceChildren();
    if (d.status !== 'ok') {
      const li = document.createElement('li'); li.className = d.status === 'error' ? 'tg-err' : 'tg-small';
      li.textContent = d.status === 'error' ? 'Mentions could not be loaded.' : '—'; ul.appendChild(li); return;
    }
    if (!TIN.sel) TIN.sel = tinDefaultSel(d.data);
    const w = tinWindow(d.data, TIN.period);
    const cur = [...tinCounts(d.data, kind, w.start, w.end).values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, window[kind === 'Tribe' ? 'tinTribesAll' : 'tinIssuesAll'] ? limit : 7);
    const prev = TIN.period === '7' ? tinCounts(d.data, kind, w.pstart, w.start - 1) : null;
    const max = Math.max(1, ...cur.map((c) => c.n));
    if (!cur.length) { const li = document.createElement('li'); li.className = 'tg-small'; li.textContent = 'No mentions in this period.'; ul.appendChild(li); return; }
    cur.forEach((c, i) => {
      const li = document.createElement('li');
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      const isSel = TIN.sel && TIN.sel.kind === kind && TIN.sel.name === c.name;
      if (isSel) li.classList.add('sel');
      li.setAttribute('aria-pressed', isSel ? 'true' : 'false');
      const num = document.createElement('span'); num.className = 'tin-num'; num.textContent = String(i + 1);
      const nm = document.createElement('div'); nm.className = 'tin-name'; nm.textContent = c.name;
      if (kind === 'Tribe' && c.state) { const sm = document.createElement('small'); sm.textContent = c.state; nm.appendChild(sm); }
      const bar = document.createElement('div'); bar.className = 'tin-bar ' + (kind === 'Tribe' ? 'tribe' : 'issue');
      bar.style.width = Math.max(4, c.n / max * 100) + '%';
      nm.appendChild(bar);
      const ct = document.createElement('div'); ct.className = 'tin-count';
      ct.textContent = c.n + (c.n === 1 ? ' story' : ' stories');
      if (prev) {
        const p = (prev.get(c.name) || { n: 0 }).n; const dlt = c.n - p;
        const ds = document.createElement('span'); ds.className = 'tin-delta';
        ds.textContent = dlt > 0 ? '▲ ' + dlt + ' vs prior week' : dlt < 0 ? '▼ ' + Math.abs(dlt) + ' vs prior week' : 'same as prior week';
        ds.style.color = dlt > 0 ? '#9ccc7d' : dlt < 0 ? '#ef7a5f' : '#c4a88f';
        ct.appendChild(ds);
      }
      li.append(num, nm, ct);
      const pick = () => { TIN.sel = { kind, name: c.name }; tinRedraw(); };
      li.addEventListener('click', pick);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      ul.appendChild(li);
    });
  }
  dash.draw('tin-tribes', (ul) => tinRank(ul, 'Tribe', 25));
  dash.draw('tin-issues', (ul) => tinRank(ul, 'Issue', 14));
  function tinMore(el, kind, limit, flag, noun, listName) {
    el.replaceChildren();
    const d = dash.data('news_mentions');
    if (d.status !== 'ok') return;
    const w = tinWindow(d.data, TIN.period);
    const total = Math.min(limit, tinCounts(d.data, kind, w.start, w.end).size);
    if (total <= 7) return;
    const open = !!window[flag];
    const b = document.createElement('button'); b.type = 'button'; b.className = 'tg-more-btn';
    b.setAttribute('aria-expanded', open ? 'true' : 'false');
    b.textContent = open ? 'Show fewer ▲' : 'Show top ' + total + ' ' + noun + ' ▼';
    b.addEventListener('click', () => { window[flag] = !window[flag]; dash.draw(listName); dash.draw(listName + '-more'); });
    const note = document.createElement('span'); note.className = 'tg-small';
    note.textContent = open ? '' : 'Showing top 7';
    el.append(note, b);
  }
  dash.draw('tin-tribes-more', (el) => tinMore(el, 'Tribe', 25, 'tinTribesAll', 'tribes', 'tin-tribes'));
  dash.draw('tin-issues-more', (el) => tinMore(el, 'Issue', 14, 'tinIssuesAll', 'issues', 'tin-issues'));

  function storyLi(r, withChips) {
    const li = document.createElement('li');
    const url = window.tgFmt.safeUrl(r.url);
    const a = document.createElement(url ? 'a' : 'span');
    if (url) { a.href = url; a.target = '_blank'; a.rel = 'noopener'; }
    a.textContent = r.headline;
    const meta = document.createElement('span'); meta.className = 'tg-cat';
    meta.textContent = window.tgFmt.date(r.date);
    li.append(a, meta);
    if (withChips) {
      const chips = document.createElement('span'); chips.className = 'tin-chips';
      const tags = []; String(r.issues || '').split('; ').filter(Boolean).forEach((x) => tags.push(['issue', x]));
      String(r.tribes || '').split('; ').filter(Boolean).slice(0, 3).forEach((x) => tags.push(['tribe', x]));
      tags.forEach(([k, x]) => {
        if (x === TIN.sel.name) return;
        const c = document.createElement('button'); c.type = 'button'; c.className = 'tin-chip ' + k; c.textContent = x;
        c.addEventListener('click', () => { TIN.sel = { kind: k === 'tribe' ? 'Tribe' : 'Issue', name: x }; tinRedraw(); });
        chips.appendChild(c);
      });
      li.appendChild(chips);
    }
    return li;
  }

  dash.draw('tin-stories', (el) => {
    const s = dash.data('news_stories'); const m = dash.data('news_mentions');
    el.replaceChildren();
    if (s.status !== 'ok' || m.status !== 'ok') {
      const p = document.createElement('p'); p.className = (s.status === 'error' || m.status === 'error') ? 'tg-err' : 'tg-small';
      p.textContent = (s.status === 'error' || m.status === 'error') ? 'Stories could not be loaded.' : '—'; el.appendChild(p); return;
    }
    if (!TIN.sel) TIN.sel = tinDefaultSel(m.data);
    if (!TIN.sel) return;
    const w = tinWindow(s.data, TIN.period);
    const field = TIN.sel.kind === 'Tribe' ? 'tribes' : 'issues';
    const rows = s.data.filter((r) => { const t = dnum(r.date); return t >= w.start && t <= w.end && String(r[field] || '').split('; ').includes(TIN.sel.name); })
      .sort((a, b) => b.date.localeCompare(a.date) || b.story_id - a.story_id);
    const h = document.createElement('h3'); h.className = 'tin-panel-title';
    const lbl = document.createElement('span'); lbl.textContent = (TIN.sel.kind === 'Tribe' ? 'Stories Naming ' : 'Stories About ');
    const nm = document.createElement('span'); nm.className = 'tin-sel-name'; nm.textContent = TIN.sel.name;
    const ct = document.createElement('span'); ct.className = 'tin-sel-count'; ct.textContent = rows.length + (rows.length === 1 ? ' story' : ' stories') + (TIN.period === '7' ? ' · last 7 days' : ' · last 30 days');
    h.append(lbl, nm, ct); el.appendChild(h);
    const ul = document.createElement('ul'); ul.className = 'tg-news';
    if (!rows.length) { const li = document.createElement('li'); li.className = 'tg-small'; li.textContent = 'No stories in this period. Try the 30-day view.'; ul.appendChild(li); }
    rows.slice(0, 25).forEach((r) => ul.appendChild(storyLi(r, true)));
    el.appendChild(ul);
    if (rows.length > 25) { const more = document.createElement('p'); more.className = 'tg-small'; more.textContent = 'Showing the 25 most recent of ' + rows.length + ' stories.'; el.appendChild(more); }
  });

  dash.draw('tin-heat', (el) => {
    const d = dash.data('news_mentions');
    el.replaceChildren();
    if (d.status !== 'ok') { const p = document.createElement('p'); p.className = d.status === 'error' ? 'tg-err' : 'tg-small'; p.textContent = d.status === 'error' ? 'Issue trends could not be loaded.' : '—'; el.appendChild(p); return; }
    const end = Math.max(...d.data.map((r) => dnum(r.date)));
    const weeks = [3, 2, 1, 0].map((k) => ({ to: end - k * 7 * DAY, from: end - (k * 7 + 6) * DAY }));
    const fmt = d3.utcFormat('%b %-d');
    const issues = [...tinCounts(d.data, 'Issue', weeks[0].from, end).values()].sort((a, b) => b.n - a.n);
    const grid = issues.map((i) => ({ name: i.name, vals: weeks.map((w) => d.data.filter((r) => r.kind === 'Issue' && r.name === i.name && dnum(r.date) >= w.from && dnum(r.date) <= w.to).length) }));
    const max = Math.max(1, ...grid.flatMap((g) => g.vals));
    const H = window.tinHeat || (window.tinHeat = { issue: null, week: null });
    const s = dash.data('news_stories');
    const wrap = document.createElement('div'); wrap.className = 'tin-sm';
    el.appendChild(wrap);
    const NS = 'http://www.w3.org/2000/svg';
    const wkLabel = (w) => fmt(new Date(w.from)) + '–' + fmt(new Date(w.to));
    const openHeat = (name, week) => {
      if (H.issue === name && H.week === week) { H.issue = null; H.week = null; } else { H.issue = name; H.week = week; }
      dash.draw('tin-heat');
    };
    const cards = [];
    function buildDrawer(g) {
      const dr = document.createElement('div'); dr.className = 'tin-drawer';
      const head = document.createElement('div'); head.className = 'tin-drawer-head';
      const tl = document.createElement('span'); tl.className = 'tin-drawer-title'; tl.textContent = 'Stories About ' + g.name;
      const sb = document.createElement('span'); sb.className = 'tin-sel-count';
      sb.textContent = H.week === null ? 'All 4 Weeks' : 'Week Of ' + wkLabel(weeks[H.week]);
      const cl = document.createElement('button'); cl.type = 'button'; cl.className = 'tin-chip tin-drawer-close'; cl.textContent = '✕ Close';
      cl.addEventListener('click', () => { H.issue = null; H.week = null; dash.draw('tin-heat'); });
      head.append(tl, sb, cl); dr.appendChild(head);
      const chips = document.createElement('div'); chips.className = 'tin-weeks';
      const mk = (label, wi) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'tin-week-chip' + (H.week === wi ? ' on' : ''); b.textContent = label;
        b.setAttribute('aria-pressed', H.week === wi ? 'true' : 'false');
        b.addEventListener('click', () => { H.week = wi; dash.draw('tin-heat'); });
        chips.appendChild(b);
      };
      mk('All 4 weeks · ' + g.vals.reduce((a, b) => a + b, 0), null);
      weeks.forEach((w, i) => mk(wkLabel(w) + ' · ' + g.vals[i], i));
      dr.appendChild(chips);
      if (s.status !== 'ok') { const p = document.createElement('p'); p.className = s.status === 'error' ? 'tg-err' : 'tg-small'; p.textContent = s.status === 'error' ? 'Stories could not be loaded.' : 'Loading stories…'; dr.appendChild(p); return dr; }
      const show = H.week === null ? [3, 2, 1, 0] : [H.week];
      show.forEach((wi) => {
        const w = weeks[wi];
        const rows = s.data.filter((r) => { const t = dnum(r.date); return t >= w.from && t <= w.to && String(r.issues || '').split('; ').includes(g.name); })
          .sort((a, b) => b.date.localeCompare(a.date) || b.story_id - a.story_id);
        if (H.week === null) { const h5 = document.createElement('h5'); h5.className = 'tin-week-head'; h5.textContent = 'Week Of ' + wkLabel(w) + ' · ' + rows.length + (rows.length === 1 ? ' story' : ' stories'); dr.appendChild(h5); }
        const ul = document.createElement('ul'); ul.className = 'tg-news tin-drawer-list';
        if (!rows.length) { const li = document.createElement('li'); li.className = 'tg-small'; li.textContent = 'No stories this week.'; ul.appendChild(li); }
        const cap = H.week === null ? 8 : 40;
        rows.slice(0, cap).forEach((r) => ul.appendChild(storyLi(r, false)));
        dr.appendChild(ul);
        if (rows.length > cap) {
          const more = document.createElement('button'); more.type = 'button'; more.className = 'tin-chip'; more.textContent = 'See all ' + rows.length + ' stories from this week';
          more.addEventListener('click', () => { H.week = wi; dash.draw('tin-heat'); });
          dr.appendChild(more);
        }
      });
      return dr;
    }
    grid.forEach((g) => {
      const card = document.createElement('div'); card.tabIndex = 0; card.setAttribute('role', 'button');
      card.className = 'tin-sm-card' + (H.issue === g.name ? ' sel' : '');
      card.setAttribute('aria-expanded', H.issue === g.name ? 'true' : 'false');
      const nm = document.createElement('div'); nm.className = 'tin-sm-name'; nm.textContent = g.name;
      const row = document.createElement('div'); row.className = 'tin-sm-row';
      const num = document.createElement('span'); num.className = 'tin-sm-num'; num.textContent = String(g.vals[3]);
      const sub = document.createElement('span'); sub.className = 'tin-sm-sub'; sub.textContent = 'this week';
      const dlt = g.vals[3] - g.vals[2];
      const dl = document.createElement('span'); dl.className = 'tin-sm-delta';
      dl.textContent = dlt > 0 ? '▲ ' + dlt : dlt < 0 ? '▼ ' + Math.abs(dlt) : '— same';
      dl.style.color = dlt > 0 ? '#9ccc7d' : dlt < 0 ? '#ef7a5f' : '#c4a88f';
      row.append(num, sub, dl);
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 120 40'); svg.setAttribute('width', '100%'); svg.setAttribute('height', '40');
      svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', g.name + ' weekly stories: ' + g.vals.join(', '));
      const px = (i) => 6 + i * 36, py = (v) => 35 - v / max * 29;
      const pts = g.vals.map((v, i) => px(i) + ',' + py(v)).join(' ');
      const area = document.createElementNS(NS, 'polygon');
      area.setAttribute('points', px(0) + ',36 ' + pts + ' ' + px(3) + ',36'); area.setAttribute('fill', 'rgba(255,154,77,0.16)');
      const line = document.createElementNS(NS, 'polyline');
      line.setAttribute('points', pts); line.setAttribute('fill', 'none'); line.setAttribute('stroke', '#ff9a4d');
      line.setAttribute('stroke-width', '2'); line.setAttribute('stroke-linejoin', 'round'); line.setAttribute('stroke-linecap', 'round');
      svg.append(area, line);
      g.vals.forEach((v, i) => {
        const on = H.issue === g.name && H.week === i;
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', px(i)); c.setAttribute('cy', py(v)); c.setAttribute('r', on ? 4.5 : i === 3 ? 3.5 : 2.5);
        c.setAttribute('fill', on || i === 3 ? '#f0c27a' : '#c8743a');
        if (on) { c.setAttribute('stroke', '#fff1df'); c.setAttribute('stroke-width', '1.5'); }
        svg.appendChild(c);
        const hit = document.createElementNS(NS, 'circle');
        hit.setAttribute('cx', px(i)); hit.setAttribute('cy', py(v)); hit.setAttribute('r', '10');
        hit.setAttribute('fill', 'transparent'); hit.setAttribute('class', 'tin-pt');
        const tt = document.createElementNS(NS, 'title'); tt.textContent = wkLabel(weeks[i]) + ': ' + v + (v === 1 ? ' story' : ' stories'); hit.appendChild(tt);
        hit.addEventListener('click', (e) => { e.stopPropagation(); openHeat(g.name, i); });
        svg.appendChild(hit);
      });
      const wk = document.createElement('div'); wk.className = 'tin-sm-weeks'; wk.textContent = g.vals.join(' · ');
      card.append(nm, row, svg, wk);
      card.addEventListener('click', () => openHeat(g.name, null));
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openHeat(g.name, null); } });
      wrap.appendChild(card); cards.push(card);
    });
    if (H.issue) {
      const idx = grid.findIndex((g) => g.name === H.issue);
      if (idx < 0) { H.issue = null; H.week = null; } else {
        const cols = Math.max(1, getComputedStyle(wrap).gridTemplateColumns.split(' ').filter(Boolean).length);
        const last = Math.min(grid.length - 1, (Math.floor(idx / cols) + 1) * cols - 1);
        cards[last].after(buildDrawer(grid[idx]));
      }
    }
    const cap = document.createElement('p'); cap.className = 'tg-small tin-sm-cap';
    cap.textContent = 'Weeks shown, oldest to newest: ' + weeks.map((w) => fmt(new Date(w.from)) + '–' + fmt(new Date(w.to))).join(', ') + '.';
    el.appendChild(cap);
  });
})();
