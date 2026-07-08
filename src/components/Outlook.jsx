import React, { useState, useEffect } from 'react';
import { fmt } from '../utils.js';
import { FY_CONFIG } from '../data/structure.js';
import { getRevData, getExpData } from '../data/dataService.js';
import { computeTotals } from '../data/quarterUtils.js';
import { loadInvestorData, saveInvestorData, DEFAULTS } from '../data/investorData.js';
import { GenericBarChart } from './Charts.jsx';

export default function Outlook({ curFY }) {
  const [editMode, setEditMode] = useState(false);
  const [inv, setInv] = useState(DEFAULTS);
  useEffect(() => { loadInvestorData().then(setInv); }, []);

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
      next.scheduledRevenue.push({ client: 'New Client', park: '', capacity: '', cr: 0, quarter: 'Q1 FY' + (parseInt(curFY.slice(2))+1) });
      return next;
    });
  };
  const removeRow = (idx) => {
    setInv(prev => {
      const next = structuredClone(prev);
      next.scheduledRevenue.splice(idx, 1);
      return next;
    });
  };

  const handleSave = async () => { await saveInvestorData(inv); setEditMode(false); };

  return (
    <div className="tab-content">
      <div className="investor-header-bar">
        <span className="cmp-main-title">Outlook &amp; Order Book</span>
        <div className="cmp-selector-wrap">
          {!editMode
            ? <button className="edit-btn" onClick={() => setEditMode(true)}>✎ Edit Outlook Data</button>
            : <button className="edit-btn edit-btn-save" onClick={handleSave}>💾 Save All</button>}
        </div>
      </div>

      {/* ═══ FINANCIAL OUTLOOK SECTIONS FIRST ═══ */}

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

      {/* ═══ ORDER BOOK SECTIONS AFTER ═══ */}

      {/* Live Order Book */}
      <div className="chart-card">
        <div className="chart-card-title">Live Order Book</div>
        <div className="kpi-row">
          <div className="kpi-card">
            {editMode
              ? <>₹<input className="edit-input edit-input-num" type="number" value={inv.orderBook.total}
                  onChange={e => update(['orderBook','total'], Number(e.target.value))} /> Cr</>
              : <div className="kpi-value">₹{inv.orderBook.total} Cr</div>}
            <div className="kpi-label">Total Order Book</div>
            <div className="kpi-sub">EPC + Govt BESS combined</div>
          </div>
          <div className="kpi-card">
            {editMode
              ? <>₹<input className="edit-input edit-input-num" type="number" value={inv.orderBook.activeEPC}
                  onChange={e => update(['orderBook','activeEPC'], Number(e.target.value))} /> Cr</>
              : <div className="kpi-value">₹{inv.orderBook.activeEPC} Cr</div>}
            <div className="kpi-label">Active EPC Orders</div>
            <div className="kpi-sub">
              {editMode
                ? <input className="edit-input edit-input-text" value={inv.orderBook.activeEPCDetail}
                    onChange={e => update(['orderBook','activeEPCDetail'], e.target.value)} />
                : inv.orderBook.activeEPCDetail}
            </div>
          </div>
          <div className="kpi-card">
            {editMode
              ? <>₹<input className="edit-input edit-input-num" type="number" value={inv.orderBook.govtBESS}
                  onChange={e => update(['orderBook','govtBESS'], Number(e.target.value))} /> Cr</>
              : <div className="kpi-value">₹{inv.orderBook.govtBESS} Cr</div>}
            <div className="kpi-label">Govt BESS Tenders</div>
            <div className="kpi-sub">
              {editMode
                ? <input className="edit-input edit-input-text" value={inv.orderBook.govtBESSDetail}
                    onChange={e => update(['orderBook','govtBESSDetail'], e.target.value)} />
                : inv.orderBook.govtBESSDetail}
            </div>
          </div>
          <div className="kpi-card">
            {editMode
              ? <input className="edit-input edit-input-text" value={inv.orderBook.orderToFY26Rev}
                  onChange={e => update(['orderBook','orderToFY26Rev'], e.target.value)} />
              : <div className="kpi-value">{inv.orderBook.orderToFY26Rev}</div>}
            <div className="kpi-label">Order Book / FY26 Revenue</div>
            <div className="kpi-sub">Strong revenue visibility</div>
          </div>
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

      {/* Scheduled EPC Revenue Recognition */}
      <div className="chart-card">
        <div className="chart-card-title">Scheduled EPC Revenue Recognition</div>
        <table className="investor-cmp-table">
          <thead>
            <tr><th>Client</th><th>Park</th><th>Capacity</th><th>₹ Cr</th><th>Quarter</th>{editMode && <th></th>}</tr>
          </thead>
          <tbody>
            {inv.scheduledRevenue.map((row, i) => (
              <tr key={i}>
                {editMode ? (
                  <>
                    <td><input className="edit-input edit-input-text" value={row.client} onChange={e => updateArrItem(['scheduledRevenue'], i, 'client', e.target.value)} /></td>
                    <td><input className="edit-input edit-input-text" value={row.park} onChange={e => updateArrItem(['scheduledRevenue'], i, 'park', e.target.value)} /></td>
                    <td><input className="edit-input edit-input-text" value={row.capacity} onChange={e => updateArrItem(['scheduledRevenue'], i, 'capacity', e.target.value)} /></td>
                    <td><input className="edit-input edit-input-num" type="number" step="0.01" value={row.cr} onChange={e => updateArrItem(['scheduledRevenue'], i, 'cr', Number(e.target.value))} /></td>
                    <td><input className="edit-input edit-input-text" value={row.quarter} onChange={e => updateArrItem(['scheduledRevenue'], i, 'quarter', e.target.value)} /></td>
                    <td><button className="row-remove-btn" onClick={() => removeRow(i)}>✕</button></td>
                  </>
                ) : (
                  <>
                    <td>{row.client}</td><td>{row.park}</td><td>{row.capacity}</td>
                    <td>{row.cr.toFixed(2)}</td><td>{row.quarter}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {editMode && <button className="add-row-btn" onClick={addRow}>+ Add Row</button>}
      </div>
    </div>
  );
}
