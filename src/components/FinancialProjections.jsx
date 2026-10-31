import React, { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import fp from '../data/fpData.json';

/*
 * Financial Projections (FP) tab
 * ------------------------------
 * Shows every sheet of the group financial model, exactly as laid out in the Excel file,
 * from ONE static data file (src/data/fpData.json, produced by tools/fp_export.py).
 *   - left: scrollable list of all sheets (Dashboard open by default)
 *   - right: the chosen sheet, scrollable both ways, frozen panes kept as in Excel
 * Nothing here talks to Zoho or the server - it is static until the model file is re-exported.
 */

const BASE_PX = 11 * 4 / 3; // Excel default 11pt in CSS px
const BORDER_KINDS = { '': 'solid', d: 'dotted', s: 'dashed', '2': 'double' };
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#a9c8f0', '#7a5ab8', '#c9a227'];

/* ── style table → inline CSS (cached) ───────────────────────────────────── */
function border(tok) {
  if (!tok) return undefined;
  const [px, color, kind] = tok.split('|');
  return `${px}px ${BORDER_KINDS[kind || ''] || 'solid'} ${color}`;
}

function cssFromStyle(st) {
  const o = {};
  if (st.b) o.fontWeight = 700;
  if (st.i) o.fontStyle = 'italic';
  const deco = [];
  if (st.u) deco.push('underline');
  if (st.st) deco.push('line-through');
  if (deco.length) o.textDecoration = deco.join(' ');
  if (st.sz) o.fontSize = `${(st.sz * 4 / 3).toFixed(2)}px`;
  if (st.fc) o.color = st.fc;
  if (st.bg) o['--bg'] = st.bg;
  if (st.h === 'r') o.textAlign = 'right';
  else if (st.h === 'c') o.textAlign = 'center';
  if (st.v === 't') o.verticalAlign = 'top';
  else if (st.v === 'm') o.verticalAlign = 'middle';
  if (st.w) { o.whiteSpace = 'pre-wrap'; o.wordBreak = 'break-word'; o.lineHeight = 1.2; }
  if (st.in) o.paddingLeft = 3 + st.in * 9;
  if (st.fn) o.fontFamily = st.fn;
  if (st.bt) o.borderTop = border(st.bt);
  if (st.br) o.borderRight = border(st.br);
  if (st.bb) o.borderBottom = border(st.bb);
  if (st.bl) o.borderLeft = border(st.bl);
  return o;
}

/* ── sheet model: positions, spans, sticky offsets ───────────────────────── */
function buildModel(sheet) {
  const { rows, cols, colW, rowH, defH, cells, freeze } = sheet;
  const lefts = [0];
  for (let c = 0; c < cols; c++) lefts.push(lefts[c] + colW[c]);
  const heights = [0];
  const tops = [0];
  for (let r = 1; r <= rows; r++) {
    const h = rowH[r] != null ? rowH[r] : defH;
    heights.push(h);
    tops.push(tops[r - 1] + h);
  }
  const K = cols + 2;
  const covered = new Set();
  const byPos = new Map();
  for (const [rk, items] of Object.entries(cells)) {
    const r = +rk;
    for (const it of items) {
      const c = it[0];
      byPos.set(r * K + c, it);
      const ex = it[3];
      if (ex && ex.m) {
        const [rs, cs] = ex.m;
        for (let rr = r; rr < r + rs; rr++)
          for (let cc = c; cc < c + cs; cc++)
            if (rr !== r || cc !== c) covered.add(rr * K + cc);
      }
    }
  }
  return { lefts, heights, tops, K, covered, byPos, fr: freeze[0], fc: freeze[1], width: lefts[cols], height: tops[rows] };
}

/* ── one sheet ───────────────────────────────────────────────────────────── */
const CSS = fp.styles.map(cssFromStyle);

function SheetGrid({ sheet, userZoom, paneW, paneH, viewW }) {
  const model = useMemo(() => buildModel(sheet), [sheet]);
  const css = CSS;
  const { lefts, heights, tops, K, covered, byPos, width, height } = model;
  const zoom = (sheet.zoom / 100) * userZoom;
  // Excel's frozen panes are kept - unless they would swallow most of a small screen, then they just scroll.
  const fr = model.fr > 0 && tops[model.fr] * zoom <= paneH * 0.5 ? model.fr : 0;
  const fc = model.fc > 0 && lefts[model.fc] * zoom <= paneW * 0.6 ? model.fc : 0;
  // Title / section bands in Excel are ROW formats: they run on past the last column to the edge of the screen.
  // We add one trailing filler column that carries that band so it reaches the right-hand edge here too.
  const rowFill = sheet.rowFill || null;
  const fw = rowFill && viewW ? Math.max(0, Math.floor(viewW / zoom) - width) : 0;

  const rowsOut = [];
  for (let r = 1; r <= sheet.rows; r++) {
    const tds = [];
    for (let c = 1; c <= sheet.cols; c++) {
      const key = r * K + c;
      if (covered.has(key)) continue;
      const it = byPos.get(key);
      const frozenRow = r <= fr;
      const frozenCol = c <= fc;
      const sticky = frozenRow || frozenCol;
      let style = it ? { ...css[it[2]] } : {};
      if (sticky) {
        style.position = 'sticky';
        if (frozenRow) style.top = tops[r - 1];
        if (frozenCol) style.left = lefts[c - 1];
        // text that overflows into empty neighbours must stay above those (also sticky) neighbours
        const spills = !!(it && it[3] && it[3].ov);
        style.zIndex = frozenRow && frozenCol ? (spills ? 7 : 6) : frozenRow ? (spills ? 5 : 4) : (spills ? 3 : 2);
      }
      const cls = sticky ? 'fp-stk' : undefined;
      if (!it) { tds.push(<td key={c} className={cls} style={sticky ? style : undefined} />); continue; }

      const ex = it[3] || {};
      if (ex.m) { style.overflow = 'hidden'; }
      let content = it[1];
      if (ex.ov) {
        style.overflow = 'visible';
        content = <span className="fp-ov" style={{ maxWidth: ex.ov }}>{it[1]}</span>;
      }
      if (ex.l) {
        content = <a href={ex.l} target="_blank" rel="noopener noreferrer" className="fp-link">{content}</a>;
      }
      tds.push(
        <td key={c} className={[cls, ex.n ? 'fp-note' : ''].filter(Boolean).join(' ') || undefined}
            style={style} title={ex.n || undefined}
            rowSpan={ex.m && ex.m[0] > 1 ? ex.m[0] : undefined} colSpan={ex.m && ex.m[1] > 1 ? ex.m[1] : undefined}>
          {content}
        </td>
      );
    }
    if (fw > 0) {
      const fs = rowFill[r] != null ? { ...css[rowFill[r]] } : {};
      if (r <= fr) { fs.position = 'sticky'; fs.top = tops[r - 1]; fs.zIndex = 4; }
      tds.push(<td key="fill" className={r <= fr ? 'fp-stk' : undefined} style={fs} />);
    }
    rowsOut.push(<tr key={r} style={{ height: heights[r] }}>{tds}</tr>);
  }

  return (
    <div className={`fp-sheet${sheet.grid ? ' fp-grid' : ''}`} style={{ width, height, zoom }}>
      <table className="fp-tbl" style={{ width: width + fw }}>
        <colgroup>
          {sheet.colW.map((w, i) => <col key={i} style={{ width: w }} />)}
          {fw > 0 ? <col key="fill" style={{ width: fw }} /> : null}
        </colgroup>
        <tbody>{rowsOut}</tbody>
      </table>
      {(sheet.charts || []).map((ch, i) => (
        <div key={i} className="fp-chart"
             style={{ left: lefts[ch.c - 1] + ch.dx, top: tops[ch.r - 1] + ch.dy, width: ch.w, height: ch.h }}>
          <BarChart spec={ch} />
        </div>
      ))}
    </div>
  );
}

/* ── bar charts (the 8 charts that exist in the model) ───────────────────── */
function wrapLabel(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function BarChart({ spec }) {
  const { w, h, series, cats, ticks, vmin, vmax, grouping, dir, gap, catRev, title, titlePt, legend, legendPos } = spec;
  const horizontal = dir === 'bar';
  const stacked = grouping === 'stacked' || grouping === 'percentStacked';
  const nCat = cats.length;
  const nSer = series.length;
  const fontPx = 11;
  const axisTxt = '#595959';
  const colorOf = (s, i) => s.color || PALETTE[i % PALETTE.length];
  const tickW = Math.max(...ticks.map(t => t[1].length)) * 6.2 + 10;

  // outer paddings
  const titleH = title ? (titlePt ? titlePt * 4 / 3 : 16) + 18 : 8;
  const legendBottom = legend && legendPos !== 'r';
  const legendRight = legend && legendPos === 'r';
  const legendW = legendRight ? Math.min(150, Math.max(...series.map(s => s.name.length)) * 6.4 + 34) : 0;
  const bottomLegendH = legendBottom ? 26 : 0;

  // category-label column (horizontal) or row (vertical)
  const maxCatChars = horizontal ? Math.max(8, Math.floor((w * 0.34) / 6.2)) : 99;
  const catLines = cats.map(c => horizontal ? wrapLabel(c, maxCatChars) : [String(c)]);
  const catLabelW = horizontal ? Math.max(...catLines.map(l => Math.max(...l.map(x => x.length)))) * 6.2 + 12 : 0;

  const x0 = horizontal ? 8 + catLabelW : 8 + tickW;
  const x1 = w - 12 - legendW;
  const y0 = titleH;
  const y1 = h - bottomLegendH - (horizontal ? 24 : 24);
  const pw = x1 - x0;
  const ph = y1 - y0;
  const span = vmax - vmin || 1;
  const vx = v => x0 + ((v - vmin) / span) * pw;   // horizontal charts
  const vy = v => y1 - ((v - vmin) / span) * ph;   // vertical charts

  const els = [];
  // gridlines + tick labels
  ticks.forEach(([t, label], i) => {
    if (horizontal) {
      const x = vx(t);
      els.push(<line key={'g' + i} x1={x} y1={y0} x2={x} y2={y1} stroke="#d9d9d9" strokeWidth="1" />);
      els.push(<text key={'t' + i} x={x} y={y1 + 15} textAnchor="middle" fontSize={fontPx} fill={axisTxt}>{label}</text>);
    } else {
      const y = vy(t);
      els.push(<line key={'g' + i} x1={x0} y1={y} x2={x1} y2={y} stroke="#d9d9d9" strokeWidth="1" />);
      els.push(<text key={'t' + i} x={x0 - 6} y={y + 4} textAnchor="end" fontSize={fontPx} fill={axisTxt}>{label}</text>);
    }
  });

  // bars
  const gapF = 1 + (gap || 150) / 100;
  for (let ci = 0; ci < nCat; ci++) {
    const slot = horizontal ? ph / nCat : pw / nCat;
    const pos = horizontal ? (catRev ? ci : nCat - 1 - ci) : ci;
    const slotStart = (horizontal ? y0 : x0) + pos * slot;
    const bandW = slot / gapF;
    const bandStart = slotStart + (slot - bandW) / 2;
    let posAcc = 0, negAcc = 0;
    series.forEach((s, si) => {
      const v = s.vals[ci] || 0;
      const thick = stacked ? bandW : bandW / nSer;
      const off = stacked ? 0 : si * thick;
      let a, b; // value range of this bar
      if (stacked) {
        if (v >= 0) { a = posAcc; b = posAcc + v; posAcc = b; } else { a = negAcc; b = negAcc + v; negAcc = b; }
      } else { a = 0; b = v; }
      if (horizontal) {
        const xa = vx(Math.min(a, b)), xb = vx(Math.max(a, b));
        els.push(<rect key={`b${ci}-${si}`} x={xa} y={bandStart + off} width={Math.max(0, xb - xa)} height={thick} fill={colorOf(s, si)} />);
      } else {
        const ya = vy(Math.max(a, b)), yb = vy(Math.min(a, b));
        els.push(<rect key={`b${ci}-${si}`} x={bandStart + off} y={ya} width={thick} height={Math.max(0, yb - ya)} fill={colorOf(s, si)} />);
      }
    });
    // category label (kept outside the plot, as Excel's "low" label position)
    if (horizontal) {
      const lines = catLines[ci];
      const cy = slotStart + slot / 2 - ((lines.length - 1) * 13) / 2 + 4;
      els.push(
        <text key={'c' + ci} x={x0 - 8} y={cy} textAnchor="end" fontSize={fontPx} fill={axisTxt}>
          {lines.map((ln, li) => <tspan key={li} x={x0 - 8} dy={li === 0 ? 0 : 13}>{ln}</tspan>)}
        </text>
      );
    } else {
      els.push(<text key={'c' + ci} x={slotStart + slot / 2} y={y1 + 16} textAnchor="middle" fontSize={fontPx} fill={axisTxt}>{cats[ci]}</text>);
    }
  }

  // zero / axis line
  if (horizontal) els.push(<line key="axis" x1={vx(0)} y1={y0} x2={vx(0)} y2={y1} stroke="#bfbfbf" strokeWidth="1" />);
  else els.push(<line key="axis" x1={x0} y1={vy(0)} x2={x1} y2={vy(0)} stroke="#bfbfbf" strokeWidth="1" />);

  // legend
  const legendEls = [];
  if (legend) {
    if (legendRight) {
      series.forEach((s, i) => {
        const y = h / 2 - (nSer * 20) / 2 + i * 20 + 10;
        legendEls.push(<rect key={'lr' + i} x={w - legendW + 6} y={y - 5} width="10" height="10" fill={colorOf(s, i)} />);
        legendEls.push(<text key={'lt' + i} x={w - legendW + 22} y={y + 4} fontSize={fontPx} fill={axisTxt}>{s.name}</text>);
      });
    } else {
      const itemW = series.map(s => s.name.length * 6.2 + 30);
      const total = itemW.reduce((a, b) => a + b, 0);
      let x = (w - total) / 2;
      series.forEach((s, i) => {
        legendEls.push(<rect key={'lr' + i} x={x} y={h - 19} width="10" height="10" fill={colorOf(s, i)} />);
        legendEls.push(<text key={'lt' + i} x={x + 15} y={h - 10} fontSize={fontPx} fill={axisTxt}>{s.name}</text>);
        x += itemW[i];
      });
    }
  }

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title || 'Chart'} className="fp-chart-svg">
      <rect x="0.5" y="0.5" width={w - 1} height={h - 1} fill="#fff" stroke="#d9d9d9" />
      {title ? <text x={w / 2} y={(titlePt ? titlePt * 4 / 3 : 16) + 6} textAnchor="middle" fontSize={titlePt ? titlePt * 4 / 3 : 16} fill="#404040">{title}</text> : null}
      {els}
      {legendEls}
    </svg>
  );
}

/* ── tab ─────────────────────────────────────────────────────────────────── */
export default function FinancialProjections() {
  const sheets = fp.sheets;
  const first = Math.max(0, sheets.findIndex(s => s.name === 'Dashboard'));
  const [sel, setSel] = useState(first);
  const [zoomStep, setZoomStep] = useState(0); // -3 … +3, each step = 10 %
  const wrapRef = useRef(null);
  const scrollRef = useRef(null);
  const listRef = useRef(null);
  const [boxH, setBoxH] = useState(620);
  const [paneW, setPaneW] = useState(1100);
  const [viewW, setViewW] = useState(0); // real inner width of the scrolling pane (for full-width row bands)

  // fill the screen below the sticky header (header + tab rows can change height)
  useLayoutEffect(() => {
    const fit = () => {
      const sticky = document.querySelector('.sticky-top-group');
      const top = sticky ? sticky.offsetHeight : 120;
      setBoxH(Math.max(380, window.innerHeight - top - 44));
      setPaneW(Math.max(320, window.innerWidth - 330));
    };
    fit();
    window.addEventListener('resize', fit);
    const sticky = document.querySelector('.sticky-top-group');
    const ro = sticky && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(sticky);
    return () => { window.removeEventListener('resize', fit); if (ro) ro.disconnect(); };
  }, []);

  useEffect(() => {
    if (scrollRef.current) { scrollRef.current.scrollTop = 0; scrollRef.current.scrollLeft = 0; }
  }, [sel]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const measure = () => setViewW(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sheet = sheets[sel];
  const userZoom = 1 + zoomStep * 0.1;

  const onListKey = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(sheets.length - 1, s + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
  };
  useEffect(() => {
    const btn = listRef.current && listRef.current.querySelector('.fp-item.active');
    if (btn && btn.scrollIntoView) btn.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  return (
    <div className="fp-wrap" ref={wrapRef} style={{ height: boxH }}>
      <aside className="fp-list" aria-label="Sheets in the financial model">
        <div className="fp-list-head">Sheets <span>{sheets.length}</span></div>
        <ul ref={listRef} onKeyDown={onListKey}>
          {sheets.map((s, i) => (
            <li key={s.name}>
              <button className={`fp-item${i === sel ? ' active' : ''}`} onClick={() => setSel(i)} title={s.name}>
                {s.name}
              </button>
            </li>
          ))}
        </ul>
        <div className="fp-list-foot">
          Static data · model {fp.meta.version}{fp.meta.date ? ` · ${fp.meta.date}` : ''}
        </div>
      </aside>

      <section className="fp-view">
        <div className="fp-view-head">
          <div className="fp-view-title">{sheet.name}</div>
          <div className="fp-zoom">
            <button onClick={() => setZoomStep(z => Math.max(-3, z - 1))} disabled={zoomStep <= -3} aria-label="Zoom out">−</button>
            <span>{Math.round((sheet.zoom * userZoom))}%</span>
            <button onClick={() => setZoomStep(z => Math.min(3, z + 1))} disabled={zoomStep >= 3} aria-label="Zoom in">+</button>
          </div>
        </div>
        <div className="fp-scroll" ref={scrollRef}>
          <SheetGrid key={sheet.name} sheet={sheet} userZoom={userZoom} paneW={paneW} paneH={boxH - 44} viewW={viewW} />
        </div>
      </section>
    </div>
  );
}
