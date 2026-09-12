import React, { useState, useEffect } from 'react';
import { fmt } from '../utils.js';
import { FY_CONFIG } from '../data/structure.js';
import { getRevData, getExpData } from '../data/dataService.js';
import { computeTotals } from '../data/quarterUtils.js';
import { loadInvestorData, saveInvestorData, DEFAULTS } from '../data/investorData.js';
import { GenericBarChart } from './Charts.jsx';
import { downloadOrderBookSheet } from '../orderBookExport.js';

export default function Outlook({ curFY }) {
  const [editMode, setEditMode] = useState(false);
  const [inv, setInv] = useState(DEFAULTS);
  useEffect(() => { loadInvestorData().then(setInv); }, []);

  // Invoiced Amount / Status — read-only, populated by a nightly cron
  // (obInvoicedRefreshBatch.js) from Zoho Books, never entered by hand.
  // null = not fetched yet; {} = fetched but a given project's cache entry
  // may still be missing until its first cron run completes.
  const [invoiced, setInvoiced] = useState(null);
  useEffect(() => {
    fetch('/api/obInvoicedStatus').then(r => r.json()).then(d => setInvoiced(d.invoiced || {})).catch(() => setInvoiced({}));
  }, []);
  const invoicedFor = (client) => invoiced?.[client] || null;

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
        client: 'New Client', park: '', dcCapacity: 0, bessCapacity: null,
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
    const iv = invoicedFor(r.client);
    const v = fyKey === 'total' ? iv?.total : iv?.byFY?.[fyKey];
    return s + (v || 0);
  }, 0);
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
          {!editMode
            ? <button className="edit-btn" onClick={() => setEditMode(true)}>✎ Edit Outlook Data</button>
            : <button className="edit-btn edit-btn-save" onClick={handleSave}>💾 Save All</button>}
        </div>
      </div>

      {/* ═══ ORDER BOOK SECTIONS FIRST ═══ */}

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
                <th rowSpan={2} style={{ textTransform: 'none' }}>S No.</th>
                <th rowSpan={2} style={{ textTransform: 'none' }}>Client Name</th>
                <th rowSpan={2} style={{ textTransform: 'none' }}>Park Location</th>
                <th rowSpan={2} style={{ textTransform: 'none' }}>DC Capacity</th>
                <th rowSpan={2} style={{ textTransform: 'none' }}>BESS Capacity</th>
                <th rowSpan={2} style={{ textTransform: 'none' }}>Total Project Price</th>
                <th colSpan={3} style={{ textTransform: 'none', textAlign: 'center' }}>Invoiced Amount</th>
                <th rowSpan={2} style={{ textTransform: 'none' }}>Status</th>
                <th rowSpan={2} style={{ textTransform: 'none' }}>Commissioning Date</th>
                {editMode && <th rowSpan={2}></th>}
              </tr>
              <tr>
                <th style={{ textTransform: 'none' }}>FY26</th>
                <th style={{ textTransform: 'none' }}>FY27</th>
                <th style={{ textTransform: 'none' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {inv.epcRevenueRecognition.map((row, i) => {
                const iv = invoicedFor(row.client);
                const fy26 = iv?.byFY?.FY26 ?? null;
                const fy27 = iv?.byFY?.FY27 ?? null;
                const totalInvoiced = iv?.total ?? null;
                const statusPct = (totalInvoiced != null && row.totalCost) ? (totalInvoiced / row.totalCost) * 100 : null;
                return (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    {editMode ? (
                      <>
                        <td><input className="edit-input edit-input-text" value={row.client} onChange={e => updateArrItem(['epcRevenueRecognition'], i, 'client', e.target.value)} /></td>
                        <td><input className="edit-input edit-input-text" value={row.park} onChange={e => updateArrItem(['epcRevenueRecognition'], i, 'park', e.target.value)} /></td>
                        <td><input {...numInputProps(row, i, 'dcCapacity')} /></td>
                        <td><input {...numInputProps(row, i, 'bessCapacity')} /></td>
                        <td><input {...numInputProps(row, i, 'totalCost')} /></td>
                        <td>{fmtNum(fy26, 'Cr')}</td>
                        <td>{fmtNum(fy27, 'Cr')}</td>
                        <td>{fmtNum(totalInvoiced, 'Cr')}</td>
                        <td>{statusPct != null ? `${statusPct.toFixed(1)}%` : '—'}</td>
                        <td><input className="edit-input edit-input-text" value={row.commissioningDate} onChange={e => updateArrItem(['epcRevenueRecognition'], i, 'commissioningDate', e.target.value)} /></td>
                        <td><button className="row-remove-btn" onClick={() => removeRow(i)}>✕</button></td>
                      </>
                    ) : (
                      <>
                        <td>{row.client}</td><td>{row.park}</td>
                        <td>{fmtNum(row.dcCapacity, 'MWp')}</td><td>{fmtNum(row.bessCapacity, 'MWh')}</td>
                        <td>{fmtNum(row.totalCost, 'Cr')}</td>
                        <td>{fmtNum(fy26, 'Cr')}</td>
                        <td>{fmtNum(fy27, 'Cr')}</td>
                        <td>{fmtNum(totalInvoiced, 'Cr')}</td>
                        <td>{statusPct != null ? `${statusPct.toFixed(1)}%` : '—'}</td>
                        <td>{row.commissioningDate || '—'}</td>
                      </>
                    )}
                  </tr>
                );
              })}
              <tr className="investor-row-strong">
                <td></td>
                <td>Total</td>
                <td></td>
                <td>{sumField('dcCapacity').toFixed(2)} MWp</td>
                <td>{sumField('bessCapacity').toFixed(2)} MWh</td>
                <td>{sumField('totalCost').toFixed(2)} Cr</td>
                <td>{sumInvoicedFY('FY26').toFixed(2)} Cr</td>
                <td>{sumInvoicedFY('FY27').toFixed(2)} Cr</td>
                <td>{sumInvoicedFY('total').toFixed(2)} Cr</td>
                <td>{sumField('totalCost') > 0 ? `${((sumInvoicedFY('total') / sumField('totalCost')) * 100).toFixed(1)}%` : '—'}</td>
                <td></td>
                {editMode && <td></td>}
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '6px' }}>
          Invoiced Amount and Status are pulled from Zoho Books by a nightly refresh — blank cells mean that project's first refresh hasn't run yet, not that billing is zero.
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
