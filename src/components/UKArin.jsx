import React, { useState, useEffect } from 'react';
import { loadInvestorData, saveInvestorData, DEFAULTS } from '../data/investorData.js';
import { GenericDualChart, TierBreakdownBars } from './Charts.jsx';

function KPICard({ label, value, sub }) {
  return (
    <div className="kpi-card">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export default function UKArin() {
  const [editMode, setEditMode] = useState(false);
  const [inv, setInv] = useState(DEFAULTS);
  useEffect(() => { loadInvestorData().then(setInv); }, []);
  const arin = inv.ukArin;

  const updateTier = (i, key, val) => setInv(prev => {
    const next = structuredClone(prev); next.ukArin.orderBook.tiers[i][key] = val; return next;
  });
  const update = (path, val) => setInv(prev => {
    const next = structuredClone(prev);
    let obj = next; for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
    obj[path[path.length - 1]] = val; return next;
  });
  const handleSave = async () => { await saveInvestorData(inv); setEditMode(false); };

  // P75, P90, P100 order — matches the order already stored in investorData.js
  const orderBookItems = arin.orderBook.tiers.map(t => ({
    label: t.tier,
    pct: (t.cr / arin.orderBook.totalCr) * 100,
    cr: t.cr, orders: t.orders, gbp: t.gbp,
  }));

  return (
    <div className="tab-content">
      <div className="investor-header-bar">
        <span className="cmp-main-title">UK Business — Arin Power</span>
        <div className="cmp-selector-wrap">
          {!editMode
            ? <button className="edit-btn" onClick={() => setEditMode(true)}>✎ Edit Data</button>
            : <button className="edit-btn edit-btn-save" onClick={handleSave}>💾 Save</button>}
        </div>
      </div>

      <GenericDualChart
        title="Arin Power UK — Turnover vs Gross Profit (₹ Cr), FY23–FY28"
        categories={arin.financials.years}
        series1={arin.financials.turnoverCr} series1Label="Turnover (₹ Cr)"
        series2={arin.financials.grossProfitCr} series2Label="Gross Profit (₹ Cr)"
        asLine2={false}
      />
      <p className="investor-note-line">FY23–FY24 Actual · FY25 Provisional · FY26–FY28 Projected. £1 = ₹115</p>

      <div className="chart-card">
        <div className="chart-card-title">Order Book by Probability Tier — Summary</div>
        <div className="kpi-row">
          <KPICard label="Total Order Book" value={editMode
            ? <>₹<input className="edit-input edit-input-num" type="number" step="0.01" value={arin.orderBook.totalCr}
                onChange={e => update(['ukArin','orderBook','totalCr'], Number(e.target.value))} /> Cr</>
            : `₹${arin.orderBook.totalCr} Cr`}
            sub={editMode
              ? <><input className="edit-input edit-input-num" type="number" value={arin.orderBook.totalOrders}
                  onChange={e => update(['ukArin','orderBook','totalOrders'], Number(e.target.value))} /> orders · £<input className="edit-input edit-input-num" type="number" step="0.01" value={arin.orderBook.totalGBP}
                  onChange={e => update(['ukArin','orderBook','totalGBP'], Number(e.target.value))} />M</>
              : `${arin.orderBook.totalOrders} orders · £${arin.orderBook.totalGBP}M`} />
          {arin.orderBook.tiers.map((t, i) => (
            <KPICard key={i} label={t.tier} value={editMode
              ? <>₹<input className="edit-input edit-input-num" type="number" step="0.01" value={t.cr} onChange={e => updateTier(i, 'cr', Number(e.target.value))} /> Cr</>
              : `₹${t.cr} Cr`}
              sub={editMode
                ? <><input className="edit-input edit-input-num" type="number" value={t.orders} onChange={e => updateTier(i, 'orders', Number(e.target.value))} /> orders · £<input className="edit-input edit-input-num" type="number" step="0.01" value={t.gbp} onChange={e => updateTier(i, 'gbp', Number(e.target.value))} />M</>
                : `${t.orders} orders · £${t.gbp}M`} />
          ))}
        </div>
      </div>

      <TierBreakdownBars items={orderBookItems} />
    </div>
  );
}
