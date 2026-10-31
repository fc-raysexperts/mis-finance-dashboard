import React, { useState, useEffect } from 'react';
import { fmt } from '../utils.js';
import { FY_CONFIG } from '../data/structure.js';
import { getRevData, getExpData } from '../data/dataService.js';
import { computeTotals } from '../data/quarterUtils.js';
import { loadInvestorData, saveInvestorData, DEFAULTS } from '../data/investorData.js';
import { GenericBarChart } from './Charts.jsx';
import { downloadOrderBookSheet } from '../orderBookExport.js';
import { getObMemo, loadObSaved, mergeIntoObMemo, isFresh } from '../data/savedTabData.js';

export default function Outlook({ curFY }) {
  const [editMode, setEditMode] = useState(false);
  const [inv, setInv] = useState(DEFAULTS);
  useEffect(() => { loadInvestorData().then(setInv); }, []);

  // Invoiced Amount / Status. The nightly run saves every project's figures, so
  // opening this tab is ONE cache-only read (mode=peek) that shows all of them at
  // once - and when App.jsx has already done that read in the background (it
  // does, right after the P&L figures appear) the figures are on screen the
  // moment the tab opens, with no request and no waiting.
  //
  // mode=status (the slower, self-healing call that may talk to Zoho) is used
  // ONLY for the batches of 5 projects that mode=peek reports as having nothing
  // saved - so normally it is never called at all and no "updating" banner shows.
  // Batches run strictly one at a time, in order. Retries follow a genuine
  // two-pass shape: Pass 1 attempts every needed batch once; any that failed are
  // retried in Pass 2 only after Pass 1 has finished, because the likely failure
  // cause is transient Zoho rate-limiting and an immediate retry hits the same
  // condition. A batch that still fails is skipped - it never blanks out
  // figures that are already showing.
  const TOTAL_BATCHES = 8;
  const ALL_BATCHES = Array.from({ length: TOTAL_BATCHES }, (_, i) => i + 1);
  const [invoiced, setInvoiced] = useState(() => getObMemo()?.invoiced || {});
  const [invoicedLoading, setInvoicedLoading] = useState(() => !getObMemo());
  const [healTotal, setHealTotal] = useState(0); // batches the background fill-in has to do (0 = nothing to fill / not known yet)
  const [invoicedBatchesDone, setInvoicedBatchesDone] = useState(0);
  const [invoicedRetrying, setInvoicedRetrying] = useState(0); // batches left in the retry pass
  const [obRefreshing, setObRefreshing] = useState(false);
  const [obRefreshDone, setObRefreshDone] = useState(0);
  const [obRefreshRetrying, setObRefreshRetrying] = useState(0);

  async function fetchJsonOnce(url) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch { return null; }
  }

  // Runs the given batches through urlFor(batch) in two passes as described
  // above. onResult(batch, data, isRetryPass) fires once per batch per pass it's
  // actually attempted in - data is null if that attempt failed. isCancelled() is
  // checked before every single fetch so an unmount (tab switch) stops promptly.
  async function runTwoPassSequential(urlFor, onResult, isCancelled, onPassOneDone, onRetryProgress, batches = ALL_BATCHES) {
    const failed = [];
    for (const batch of batches) {
      if (isCancelled()) return;
      const d = await fetchJsonOnce(urlFor(batch));
      if (d === null) failed.push(batch);
      onResult(batch, d, false);
    }
    if (onPassOneDone) onPassOneDone(failed.length);
    for (const batch of failed) {
      if (isCancelled()) return;
      const d = await fetchJsonOnce(urlFor(batch));
      onResult(batch, d, true);
      if (onRetryProgress) onRetryProgress();
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1. The saved copy: from memory if it is already here and recent, else one read.
      let memo = getObMemo();
      if (memo) setInvoiced(prev => ({ ...prev, ...memo.invoiced }));
      if (!isFresh(memo)) {
        try {
          memo = await loadObSaved();
          if (cancelled) return;
          setInvoiced(prev => ({ ...prev, ...memo.invoiced }));
        } catch { if (cancelled) return; /* could not read it: fall back to filling everything below */ }
      }

      // 2. Fill in ONLY what has nothing saved (normally nothing).
      const batches = memo && Array.isArray(memo.missingBatches) ? memo.missingBatches : ALL_BATCHES;
      if (batches.length === 0) { setInvoicedLoading(false); return; }
      setInvoicedLoading(true); setHealTotal(batches.length); setInvoicedBatchesDone(0); setInvoicedRetrying(0);
      await runTwoPassSequential(
        batch => `/api/obInvoiced?mode=status&batch=${batch}`,
        (batch, d, isRetryPass) => {
          if (d?.invoiced) { mergeIntoObMemo(d.invoiced); if (!cancelled) setInvoiced(prev => ({ ...prev, ...d.invoiced })); }
          if (cancelled) return;
          if (!isRetryPass) setInvoicedBatchesDone(done => done + 1); // count each batch once, not again on its retry
        },
        () => cancelled,
        (failedCount) => { if (!cancelled) { setInvoicedRetrying(failedCount); if (failedCount === 0) setInvoicedLoading(false); } },
        () => { if (!cancelled) setInvoicedRetrying(n => { const next = n - 1; if (next <= 0) setInvoicedLoading(false); return next; }); },
        batches
      );
      // 3. Re-read what is saved now, so the remembered copy is accurate for the next visit.
      if (cancelled) return;
      try { const fresh = await loadObSaved(); if (!cancelled) setInvoiced(prev => ({ ...prev, ...fresh.invoiced })); } catch { /* the per-batch merge above already holds the figures */ }
      if (!cancelled) setInvoicedLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);
  const invoicedFor = (projectId) => invoiced?.[projectId] || null;

  // "Refresh OB Data" — a genuine live pull from Zoho for every project,
  // same semantics as the global "Refresh Live Data" button (bypasses
  // cache entirely) but scoped to just this table: mode=monthly&force=1,
  // the same force-finalization path the monthly cron uses. Same two-pass
  // sequential shape as Stage 2 above, for the same reason. mode=monthly
  // doesn't return the full invoiced shape itself, so a final mode=peek
  // pulls the freshly-written cache back in once every batch (including
  // retries) has finished.
  async function refreshObData() {
    setObRefreshing(true);
    setObRefreshDone(0);
    setObRefreshRetrying(0);
    await runTwoPassSequential(
      batch => `/api/obInvoiced?mode=monthly&batch=${batch}&force=1`,
      (batch, d, isRetryPass) => { if (!isRetryPass) setObRefreshDone(done => done + 1); }, // count each batch once, not again on its retry
      () => false,
      (failedCount) => setObRefreshRetrying(failedCount),
      () => setObRefreshRetrying(n => n - 1)
    );
    try {
      const fresh = await loadObSaved();
      setInvoiced(prev => ({ ...prev, ...fresh.invoiced }));
    } catch { /* the per-batch cache writes already happened regardless */ }
    setObRefreshing(false);
  }

  const revD = getRevData(curFY);
  const expD = getExpData(curFY);
  const allIdxs = Array.from({ length: 12 }, (_, i) => i);
  const ytd = computeTotals(revD.data, expD.data, Object.keys(revD.data), Object.keys(expD.data), allIdxs);

  const epcProgressPct = inv.guidance.epcTargetMid > 0
    ? Math.min((ytd.totalRev / (inv.guidance.epcTargetMid * 10000000)) * 100, 100) : 0;
  const patProgressPct = inv.guidance.patTarget > 0
    ? Math.min((ytd.pbt / (inv.guidance.patTarget * 10000000)) * 100, 100) : 0;

  const update = (path, val) => {
    setInv(prev => {
      const next = structuredClone(prev);
      let obj = next;
      for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
      obj[path[path.length - 1]] = val;
      return next;
    });
  };
  const updateArrItem = (arrPath, idx, key, val) => {
    setInv(prev => {
      const next = structuredClone(prev);
      let arr = next;
      for (const p of arrPath) arr = arr[p];
      arr[idx][key] = val;
      return next;
    });
  };
  const addRow = () => {
    setInv(prev => {
      const next = structuredClone(prev);
      next.epcRevenueRecognition.push({
        client: 'New Client', projectId: null, park: '', dcCapacity: 0, bessCapacity: null,
        totalCost: 0, commissioningDate: '',
      });
      return next;
    });
  };
  const removeRow = (idx) => {
    setInv(prev => {
      const next = structuredClone(prev);
      next.epcRevenueRecognition.splice(idx, 1);
      return next;
    });
  };

  const handleSave = async () => { await saveInvestorData(inv); setEditMode(false); };

  // null = genuinely no value for this project (not a real 0) — shown blank, not "0.00"
  const fmtNum = (v, unit) => (v === null || v === undefined ? '—' : `${v.toFixed(2)} ${unit}`);
  const sumField = (field) => inv.epcRevenueRecognition.reduce((s, r) => s + (r[field] || 0), 0);
  // fyKey is 'FY26', 'FY27', or 'total' (the true grand total, not FY26+FY27 added)
  const sumInvoicedFY = (fyKey) => inv.epcRevenueRecognition.reduce((s, r) => {
    const iv = invoicedFor(r.projectId);
    const v = fyKey === 'total' ? iv?.total : iv?.byFY?.[fyKey];
    return s + (v || 0);
  }, 0);
  // Same shape, but only the "paid" subset — Receipt Amount.
  const sumReceiptFY = (fyKey) => inv.epcRevenueRecognition.reduce((s, r) => {
    const iv = invoicedFor(r.projectId);
    const v = fyKey === 'total' ? iv?.paidTotal : iv?.paidByFY?.[fyKey];
    return s + (v || 0);
  }, 0);
  // S No. and Client Name are frozen (position: sticky) so they stay in
  // view while the rest of the table scrolls horizontally — there are now
  // too many columns to fit without it. S No. is forced to an exact width
  // (not just assumed) so Client Name's left offset always lines up with
  // where S No. actually ends — an unforced width was the earlier bug:
  // the browser could render S No. narrower than the 52px Client Name
  // assumed, leaving a gap that showed scrolled content behind it.
  // Background must be set explicitly per row type or the frozen cell
  // would show whatever scrolls underneath it through its own transparency.
  const SNO_WIDTH = 52;
  const stickyCol = (leftPx, bg) => ({ position: 'sticky', left: `${leftPx}px`, background: bg, zIndex: 2 });
  const snoColStyle = (bg) => ({ ...stickyCol(0, bg), width: `${SNO_WIDTH}px`, minWidth: `${SNO_WIDTH}px`, maxWidth: `${SNO_WIDTH}px` });
  // Thin dividers after Client Name, Total Project Price, and Invoice
  // Status, to help visually separate the table's sections (identity /
  // capacity+price / invoiced / receipts). The Client Name one is folded
  // into its own sticky style below so it scrolls/sticks with that column
  // rather than being left behind.
  const vdl = { borderRight: '1px solid #cbd5e1' };
  const clientNameColStyle = (bg) => ({ ...stickyCol(52, bg), ...vdl });
  // Wraps these specific headers onto 2 lines instead of letting the
  // browser widen the whole column just to fit them on one — narrows
  // several columns that were otherwise wider than their actual data needs.
  const wrapHeader = { textTransform: 'none', whiteSpace: 'normal', maxWidth: '80px' };
  const numInputProps = (row, i, field) => ({
    className: 'edit-input edit-input-num', type: 'number', step: '0.01',
    value: row[field] === null || row[field] === undefined ? '' : row[field],
    onChange: e => updateArrItem(['epcRevenueRecognition'], i, field, e.target.value === '' ? null : Number(e.target.value)),
  });

  // Live Order Book — Revenue row. "Current yr" here means FY27 specifically
  // (the actual current fiscal year), fixed — not whichever FY tab happens
  // to be toggled at the top of the dashboard, unlike ytd/epcProgressPct
  // above which do follow curFY for the Guidance section.
  const revD27 = getRevData('FY27');
  const expD27 = getExpData('FY27');
  const ytd27 = computeTotals(revD27.data, expD27.data, Object.keys(revD27.data), Object.keys(expD27.data), allIdxs);
  const totalRevenueFY27 = ytd27.totalRev / 10000000; // raw rupees → Cr
  const orderBookCurrentRevenue = sumInvoicedFY('FY27');
  const otherThanOrderBookRevenue = totalRevenueFY27 - orderBookCurrentRevenue;
  const revenueToBeBooked = inv.orderBookTargets.targetRevenue - orderBookCurrentRevenue - otherThanOrderBookRevenue;
  // Current Order Book — total order value minus what's already been
  // invoiced in FY26, leaving what's actually relevant going into FY27
  // (the current year), rather than the full un-netted contract value.
  const currentOrderBook = sumField('totalCost') - sumInvoicedFY('FY26');

  return (
    <div className="tab-content">
      <div className="investor-header-bar">
        <span className="cmp-main-title">Order Book &amp; Outlook</span>
        <div className="cmp-selector-wrap">
          <button className="edit-btn" onClick={refreshObData} disabled={obRefreshing}>
            {obRefreshing
              ? (obRefreshDone >= TOTAL_BATCHES
                  ? `↻ Retrying ${obRefreshRetrying} failed batch${obRefreshRetrying === 1 ? '' : 'es'}…`
                  : `↻ Refreshing… ${obRefreshDone}/${TOTAL_BATCHES}`)
              : '↻ Refresh OB Data'}
          </button>
          {!editMode
            ? <button className="edit-btn" onClick={() => setEditMode(true)}>✎ Edit Outlook Data</button>
            : <button className="edit-btn edit-btn-save" onClick={handleSave}>💾 Save All</button>}
        </div>
      </div>

      {/* ═══ ORDER BOOK SECTIONS FIRST ═══ */}

      {/* Only shown while the saved figures are being read for the very first time,
          or while projects that have NO saved copy are being filled in. When
          everything is saved (the normal case) this never appears. */}
      {invoicedLoading && !obRefreshing && (
        <div className="npd-loading">
          <span className="npd-spinner" />
          {healTotal === 0
            ? ' Loading the saved Invoiced Amount figures…'
            : invoicedBatchesDone >= healTotal
              ? ` Retrying ${invoicedRetrying} batch${invoicedRetrying === 1 ? '' : 'es'} that didn't load the first time — figures already shown stay visible while this finishes…`
              : ` Filling in Invoiced Amount figures that had no saved copy — ${invoicedBatchesDone}/${healTotal} batches done (figures already shown stay visible while this finishes)…`}
        </div>
      )}
      {obRefreshing && (
        <div className="npd-loading">
          <span className="npd-spinner" />
          {obRefreshDone >= TOTAL_BATCHES
            ? ` Retrying ${obRefreshRetrying} batch${obRefreshRetrying === 1 ? '' : 'es'} that didn't load the first time…`
            : ` Refreshing Order Book data live from Zoho — ${obRefreshDone}/${TOTAL_BATCHES} batches done…`}
        </div>
      )}

      {/* Live Order Book — 2 rows of 4. Target Order Book / Target Revenue
          are the only manually-set figures here (inv.orderBookTargets);
          everything else is computed live from epcRevenueRecognition + the
          Zoho-fetched invoiced amounts, same as the Order Book table's own
          Total row, so none of it can drift out of sync or go stale. */}
      <div className="chart-card">
        <div className="chart-card-title">Live Order Book</div>
        <div className="kpi-row">
          <div className="kpi-card">
            {editMode
              ? <>₹<input className="edit-input edit-input-num" type="number" step="0.01" value={inv.orderBookTargets.targetOrderBook}
                  onChange={e => update(['orderBookTargets','targetOrderBook'], Number(e.target.value))} /> Cr</>
              : <div className="kpi-value">₹{inv.orderBookTargets.targetOrderBook.toFixed(2)} Cr</div>}
            <div className="kpi-label">Target Order Book</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">₹{currentOrderBook.toFixed(2)} Cr</div>
            <div className="kpi-label">Current Order Book</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{sumField('dcCapacity').toFixed(2)} MWp</div>
            <div className="kpi-label">Total Solar Capacity</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{sumField('bessCapacity').toFixed(2)} MWh</div>
            <div className="kpi-label">Total BESS Capacity</div>
          </div>
        </div>
        <div className="kpi-row" style={{ marginTop: '12px' }}>
          <div className="kpi-card">
            {editMode
              ? <>₹<input className="edit-input edit-input-num" type="number" step="0.01" value={inv.orderBookTargets.targetRevenue}
                  onChange={e => update(['orderBookTargets','targetRevenue'], Number(e.target.value))} /> Cr</>
              : <div className="kpi-value">₹{inv.orderBookTargets.targetRevenue.toFixed(2)} Cr</div>}
            <div className="kpi-label">Target Revenue</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">₹{orderBookCurrentRevenue.toFixed(2)} Cr</div>
            <div className="kpi-label">Order Book Current Revenue</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">₹{otherThanOrderBookRevenue.toFixed(2)} Cr</div>
            <div className="kpi-label">Other than Order Book Revenue</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">₹{revenueToBeBooked.toFixed(2)} Cr</div>
            <div className="kpi-label">Revenue to be Booked</div>
          </div>
        </div>
      </div>

      {/* Order Book (formerly "EPC Revenue Recognition") — full FY27 project
          log (current Order Book + already-commissioned clients). RVUNL/NTPC
          pinned last; Total row is computed here at render time from
          whatever rows currently exist, so it can't go stale after an
          edit/add/remove — it is never stored. */}
      <div className="chart-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="chart-card-title" style={{ marginBottom: 0 }}>Order Book</div>
          <button className="edit-btn" onClick={() => downloadOrderBookSheet(inv.epcRevenueRecognition, invoiced)}>
            ⬇ Download Order Book Excel Sheet
          </button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          {/* tableLayout:'auto' + textTransform:'none' override the app-wide
              equal-width / all-caps table defaults, scoped to just this table
              via inline style so no other tab's tables are affected. */}
          <table className="investor-cmp-table" style={{ tableLayout: 'auto', minWidth: 'auto' }}>
            <thead>
              <tr>
                <th rowSpan={2} style={{ textTransform: 'none', ...snoColStyle('#f0f4ff') }}>S No.</th>
                <th rowSpan={2} style={{ textTransform: 'none', ...clientNameColStyle('#f0f4ff') }}>Client Name</th>
                <th rowSpan={2} style={wrapHeader}>Park Location</th>
                <th rowSpan={2} style={wrapHeader}>DC Capacity</th>
                <th rowSpan={2} style={wrapHeader}>BESS Capacity</th>
                <th rowSpan={2} style={{ ...wrapHeader, ...vdl }}>Total Project Price</th>
                <th colSpan={3} style={{ textTransform: 'none', textAlign: 'center' }}>Invoiced Amount</th>
                <th rowSpan={2} style={{ ...wrapHeader, ...vdl }}>Invoice Status</th>
                <th colSpan={3} style={{ textTransform: 'none', textAlign: 'center' }}>Receipt Amount</th>
                <th rowSpan={2} style={wrapHeader}>Receipts Status</th>
                <th rowSpan={2} style={wrapHeader}>Commissioning Date</th>
                {editMode && <th rowSpan={2}></th>}
              </tr>
              <tr>
                <th style={{ textTransform: 'none' }}>FY26</th>
                <th style={{ textTransform: 'none' }}>FY27</th>
                <th style={{ textTransform: 'none' }}>Total</th>
                <th style={{ textTransform: 'none' }}>FY26</th>
                <th style={{ textTransform: 'none' }}>FY27</th>
                <th style={{ textTransform: 'none' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {inv.epcRevenueRecognition.map((row, i) => {
                const iv = invoicedFor(row.projectId);
                const fy26 = iv?.byFY?.FY26 ?? null;
                const fy27 = iv?.byFY?.FY27 ?? null;
                const totalInvoiced = iv?.total ?? null;
                const invoiceStatusPct = (totalInvoiced != null && row.totalCost) ? (totalInvoiced / row.totalCost) * 100 : null;
                const rFy26 = iv?.paidByFY?.FY26 ?? null;
                const rFy27 = iv?.paidByFY?.FY27 ?? null;
                // paidTotal already nets out credit notes applied against
                // Paid invoices specifically (see _obShared.js), so no
                // display-layer cap needed anymore — this is the real,
                // computed figure, not an approximation of it. It can, in
                // principle, still exceed Invoiced Amount in one genuine
                // scenario: most of a project's credit notes apply against
                // *unpaid* invoices while a large share remains genuinely
                // paid — that reflects real overpayment relative to net
                // billing, not a data artifact, so it's shown as-is.
                const totalReceipt = iv?.paidTotal ?? null;
                const receiptStatusPct = (totalReceipt != null && totalInvoiced) ? (totalReceipt / totalInvoiced) * 100 : null;
                const bodyBg = '#fff';
                return (
                  <tr key={i}>
                    <td style={snoColStyle(bodyBg)}>{i + 1}</td>
                    {editMode ? (
                      <>
                        <td style={clientNameColStyle(bodyBg)}><input className="edit-input edit-input-text" value={row.client} onChange={e => updateArrItem(['epcRevenueRecognition'], i, 'client', e.target.value)} /></td>
                        <td><input className="edit-input edit-input-text" value={row.park} onChange={e => updateArrItem(['epcRevenueRecognition'], i, 'park', e.target.value)} /></td>
                        <td><input {...numInputProps(row, i, 'dcCapacity')} /></td>
                        <td><input {...numInputProps(row, i, 'bessCapacity')} /></td>
                        <td style={vdl}><input {...numInputProps(row, i, 'totalCost')} /></td>
                        <td>{fmtNum(fy26, 'Cr')}</td>
                        <td>{fmtNum(fy27, 'Cr')}</td>
                        <td>{fmtNum(totalInvoiced, 'Cr')}</td>
                        <td style={vdl}>{invoiceStatusPct != null ? `${invoiceStatusPct.toFixed(1)}%` : '—'}</td>
                        <td>{fmtNum(rFy26, 'Cr')}</td>
                        <td>{fmtNum(rFy27, 'Cr')}</td>
                        <td>{fmtNum(totalReceipt, 'Cr')}</td>
                        <td>{receiptStatusPct != null ? `${receiptStatusPct.toFixed(1)}%` : '—'}</td>
                        <td><input className="edit-input edit-input-text" value={row.commissioningDate} onChange={e => updateArrItem(['epcRevenueRecognition'], i, 'commissioningDate', e.target.value)} /></td>
                        <td><button className="row-remove-btn" onClick={() => removeRow(i)}>✕</button></td>
                      </>
                    ) : (
                      <>
                        <td style={clientNameColStyle(bodyBg)}>{row.client}</td><td>{row.park}</td>
                        <td>{fmtNum(row.dcCapacity, 'MWp')}</td><td>{fmtNum(row.bessCapacity, 'MWh')}</td>
                        <td style={vdl}>{fmtNum(row.totalCost, 'Cr')}</td>
                        <td>{fmtNum(fy26, 'Cr')}</td>
                        <td>{fmtNum(fy27, 'Cr')}</td>
                        <td>{fmtNum(totalInvoiced, 'Cr')}</td>
                        <td style={vdl}>{invoiceStatusPct != null ? `${invoiceStatusPct.toFixed(1)}%` : '—'}</td>
                        <td>{fmtNum(rFy26, 'Cr')}</td>
                        <td>{fmtNum(rFy27, 'Cr')}</td>
                        <td>{fmtNum(totalReceipt, 'Cr')}</td>
                        <td>{receiptStatusPct != null ? `${receiptStatusPct.toFixed(1)}%` : '—'}</td>
                        <td>{row.commissioningDate || '—'}</td>
                      </>
                    )}
                  </tr>
                );
              })}
              <tr className="investor-row-strong">
                <td style={snoColStyle('#f8faff')}></td>
                <td style={clientNameColStyle('#f8faff')}>Total</td>
                <td></td>
                <td>{sumField('dcCapacity').toFixed(2)} MWp</td>
                <td>{sumField('bessCapacity').toFixed(2)} MWh</td>
                <td style={vdl}>{sumField('totalCost').toFixed(2)} Cr</td>
                <td>{sumInvoicedFY('FY26').toFixed(2)} Cr</td>
                <td>{sumInvoicedFY('FY27').toFixed(2)} Cr</td>
                <td>{sumInvoicedFY('total').toFixed(2)} Cr</td>
                <td style={vdl}>{sumField('totalCost') > 0 ? `${((sumInvoicedFY('total') / sumField('totalCost')) * 100).toFixed(1)}%` : '—'}</td>
                <td>{sumReceiptFY('FY26').toFixed(2)} Cr</td>
                <td>{sumReceiptFY('FY27').toFixed(2)} Cr</td>
                <td>{sumReceiptFY('total').toFixed(2)} Cr</td>
                <td>{sumInvoicedFY('total') > 0 ? `${((sumReceiptFY('total') / sumInvoicedFY('total')) * 100).toFixed(1)}%` : '—'}</td>
                <td></td>
                {editMode && <td></td>}
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '6px' }}>
          Invoiced Amount and Invoice Status are pulled from Zoho Books by a nightly refresh — blank cells mean that project's first refresh hasn't run yet, not that billing is zero. Receipt Amount covers only invoices Zoho has marked "Paid," minus any credit notes applied specifically against a Paid invoice; Receipts Status is Total Receipt Amount as a % of Total Invoiced Amount.
        </div>
        {editMode && <button className="add-row-btn" onClick={addRow}>+ Add Row</button>}
      </div>

      {/* FY Guidance Progress */}
      <div className="chart-card">
        <div className="chart-card-title">FY Guidance — Progress</div>
        <div className="guidance-row">
          <div className="guidance-label">
            EPC Revenue Target: {editMode
              ? <input className="edit-input edit-input-text" value={inv.guidance.epcTargetLabel}
                  onChange={e => update(['guidance','epcTargetLabel'], e.target.value)} />
              : inv.guidance.epcTargetLabel}
            {editMode && <> (mid ₹<input className="edit-input edit-input-num" type="number" value={inv.guidance.epcTargetMid}
              onChange={e => update(['guidance','epcTargetMid'], Number(e.target.value))} /> Cr)</>}
          </div>
          <div className="guidance-bar-track">
            <div className="guidance-bar-fill" style={{ width: `${epcProgressPct}%` }} />
            <span className="guidance-bar-text">{fmt(ytd.totalRev)}</span>
          </div>
          <div className="guidance-pct">{epcProgressPct.toFixed(0)}%</div>
        </div>
        <div className="guidance-row">
          <div className="guidance-label">
            PAT Target: &gt;₹{editMode
              ? <input className="edit-input edit-input-num" type="number" value={inv.guidance.patTarget}
                  onChange={e => update(['guidance','patTarget'], Number(e.target.value))} />
              : inv.guidance.patTarget} Cr
          </div>
          <div className="guidance-bar-track">
            <div className="guidance-bar-fill guidance-bar-fill-alt" style={{ width: `${patProgressPct}%` }} />
            <span className="guidance-bar-text">{fmt(ytd.pbt)} PBT</span>
          </div>
          <div className="guidance-pct">{patProgressPct.toFixed(0)}%</div>
        </div>
      </div>

      {/* EPC Revenue Recognition Outlook by Quarter */}
      <GenericBarChart
        title="EPC Revenue Recognition Outlook — by Quarter (₹ Cr)"
        categories={inv.epcQuarterly.quarters}
        values={inv.epcQuarterly.revenue}
        color="#3b82f6"
        valueLabel="Revenue (₹ Cr)"
      />

      {/* ═══ FINANCIAL OUTLOOK SECTIONS AFTER ═══ */}

      {/* Balance Sheet Strength */}
      <div className="chart-card">
        <div className="chart-card-title">Balance Sheet Strength</div>
        <div className="kpi-row">
          <div className="kpi-card">
            {editMode
              ? <>₹<input className="edit-input edit-input-num" type="number" step="0.01" value={inv.balanceSheet.shareholdersFunds}
                  onChange={e => update(['balanceSheet','shareholdersFunds'], Number(e.target.value))} /> Cr</>
              : <div className="kpi-value">₹{inv.balanceSheet.shareholdersFunds} Cr</div>}
            <div className="kpi-label">Shareholders' Funds</div>
          </div>
          <div className="kpi-card">
            {editMode
              ? <>₹<input className="edit-input edit-input-num" type="number" step="0.01" value={inv.balanceSheet.cash}
                  onChange={e => update(['balanceSheet','cash'], Number(e.target.value))} /> Cr</>
              : <div className="kpi-value">₹{inv.balanceSheet.cash} Cr</div>}
            <div className="kpi-label">Cash &amp; Equivalents</div>
          </div>
          <div className="kpi-card">
            {editMode
              ? <input className="edit-input edit-input-text" value={inv.balanceSheet.gearing}
                  onChange={e => update(['balanceSheet','gearing'], e.target.value)} />
              : <div className="kpi-value">{inv.balanceSheet.gearing}</div>}
            <div className="kpi-label">Gearing</div>
          </div>
          <div className="kpi-card">
            {editMode
              ? <input className="edit-input edit-input-text" value={inv.balanceSheet.rating}
                  onChange={e => update(['balanceSheet','rating'], e.target.value)} />
              : <div className="kpi-value">{inv.balanceSheet.rating}</div>}
            <div className="kpi-label">Credit Rating</div>
          </div>
        </div>
      </div>

      {/* Key Financial Ratios — positive/strong ratios only */}
      <div className="chart-card">
        <div className="chart-card-title">Key Financial Ratios — Strengths</div>
        <table className="investor-cmp-table">
          <thead>
            <tr><th>Ratio</th><th>FY24</th><th>FY25</th><th>FY26</th><th>STANDARD Benchmark</th><th>Assessment</th></tr>
          </thead>
          <tbody>
            {inv.keyRatios.map((r, i) => (
              <tr key={i}>
                <td>{r.ratio}</td><td>{r.fy24}</td><td>{r.fy25}</td><td>{r.fy26}</td><td>{r.benchmark}</td>
                <td><span className="ratio-pill">{r.assessment}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
