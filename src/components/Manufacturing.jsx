import React, { useState, useEffect } from 'react';
import { loadInvestorData, saveInvestorData, DEFAULTS } from '../data/investorData.js';
import { GenericDualChart } from './Charts.jsx';

function KPICard({ label, value, sub }) {
  return (
    <div className="kpi-card">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export default function Manufacturing() {
  const [editMode, setEditMode] = useState(false);
  const [inv, setInv] = useState(DEFAULTS);
  useEffect(() => { loadInvestorData().then(setInv); }, []);
  const m = inv.manufacturing;

  const update = (path, val) => setInv(prev => {
    const next = structuredClone(prev);
    let obj = next; for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
    obj[path[path.length - 1]] = val; return next;
  });
  const handleSave = async () => { await saveInvestorData(inv); setEditMode(false); };

  return (
    <div className="tab-content">
      <div className="investor-header-bar">
        <span className="cmp-main-title">Transformer &amp; Battery Manufacturing</span>
        <div className="cmp-selector-wrap">
          {!editMode
            ? <button className="edit-btn" onClick={() => setEditMode(true)}>✎ Edit Data</button>
            : <button className="edit-btn edit-btn-save" onClick={handleSave}>💾 Save</button>}
        </div>
      </div>

      {/* Transformer */}
      <div className="chart-card">
        <div className="chart-card-title">Transformer — RPE Technologies Pvt Ltd</div>
        <div className="kpi-row">
          <KPICard label="Phase 1 CapEx" value={editMode
            ? <>₹<input className="edit-input edit-input-num" type="number" value={m.transformer.capex} onChange={e => update(['manufacturing','transformer','capex'], Number(e.target.value))} /> Cr</>
            : `₹${m.transformer.capex} Cr`} sub="Transformer line" />
          <KPICard label="Annual Capacity" value={editMode
            ? <input className="edit-input edit-input-text" value={m.transformer.capacity} onChange={e => update(['manufacturing','transformer','capacity'], e.target.value)} />
            : m.transformer.capacity} sub="Planned, full ramp-up" />
          <KPICard label="Projected Revenue" value={editMode
            ? <>₹<input className="edit-input edit-input-num" type="number" value={m.transformer.revenue} onChange={e => update(['manufacturing','transformer','revenue'], Number(e.target.value))} /> Cr</>
            : `₹${m.transformer.revenue} Cr`} sub="At full utilisation" />
          <KPICard label="Target EBITDA Margin" value={editMode
            ? <><input className="edit-input edit-input-num" type="number" value={m.transformer.ebitdaMargin} onChange={e => update(['manufacturing','transformer','ebitdaMargin'], Number(e.target.value))} />%</>
            : `${m.transformer.ebitdaMargin}%`} sub="Per director's guidance" />
          <KPICard label="Projected EBITDA" value={editMode
            ? <>₹<input className="edit-input edit-input-num" type="number" value={m.transformer.ebitda} onChange={e => update(['manufacturing','transformer','ebitda'], Number(e.target.value))} /> Cr</>
            : `₹${m.transformer.ebitda} Cr`} sub={`${m.transformer.ebitdaMargin}% of ₹${m.transformer.revenue} Cr revenue`} />
        </div>
      </div>

      {/* Battery */}
      <div className="chart-card">
        <div className="chart-card-title">Battery (BESS) — RPE Technologies Pvt Ltd</div>
        <div className="kpi-row">
          <KPICard label="Phase 1 CapEx" value={editMode
            ? <>₹<input className="edit-input edit-input-num" type="number" value={m.battery.capex} onChange={e => update(['manufacturing','battery','capex'], Number(e.target.value))} /> Cr</>
            : `₹${m.battery.capex} Cr`} sub="BESS manufacturing line" />
          <KPICard label="Annual Capacity" value={editMode
            ? <input className="edit-input edit-input-text" value={m.battery.capacity} onChange={e => update(['manufacturing','battery','capacity'], e.target.value)} />
            : m.battery.capacity} sub="261 kWh · 481 kWh · 5 MWh" />
          <KPICard label="Expected Annual Revenue" value={editMode
            ? <>₹<input className="edit-input edit-input-num" type="number" value={m.battery.revenue} onChange={e => update(['manufacturing','battery','revenue'], Number(e.target.value))} /> Cr</>
            : `₹${m.battery.revenue} Cr`} sub="From Year 1 onwards" />
          <KPICard label="Expected EBITDA" value={editMode
            ? <>₹<input className="edit-input edit-input-num" type="number" value={m.battery.ebitdaLow} onChange={e => update(['manufacturing','battery','ebitdaLow'], Number(e.target.value))} />–<input className="edit-input edit-input-num" type="number" value={m.battery.ebitdaHigh} onChange={e => update(['manufacturing','battery','ebitdaHigh'], Number(e.target.value))} /> Cr</>
            : `₹${m.battery.ebitdaLow}–${m.battery.ebitdaHigh} Cr`} sub={`${m.battery.marginLow}–${m.battery.marginHigh}% EBITDA margin`} />
        </div>
        <p className="investor-key-line">
          {editMode
            ? <textarea className="edit-input edit-input-wide" rows={2} value={m.combinedNote}
                onChange={e => update(['manufacturing','combinedNote'], e.target.value)} />
            : m.combinedNote}
        </p>
      </div>

      {/* BESS Product Matrix */}
      <div className="chart-card">
        <div className="chart-card-title">Battery (BESS) — Product / Market Fit</div>
        <table className="investor-cmp-table">
          <thead><tr><th>Product</th><th>Target Segment</th><th>India Market Size</th><th>Price/kWh (₹)</th><th>Gross Margin</th></tr></thead>
          <tbody>
            {m.bessProducts.map((row, i) => (
              <tr key={i}>
                {editMode ? (
                  <>
                    <td><input className="edit-input edit-input-text" value={row.product} onChange={e => setInv(prev=>{const n=structuredClone(prev);n.manufacturing.bessProducts[i].product=e.target.value;return n;})} /></td>
                    <td><input className="edit-input edit-input-text" value={row.segment} onChange={e => setInv(prev=>{const n=structuredClone(prev);n.manufacturing.bessProducts[i].segment=e.target.value;return n;})} /></td>
                    <td><input className="edit-input edit-input-text" value={row.marketSize} onChange={e => setInv(prev=>{const n=structuredClone(prev);n.manufacturing.bessProducts[i].marketSize=e.target.value;return n;})} /></td>
                    <td><input className="edit-input edit-input-text" value={row.priceRange} onChange={e => setInv(prev=>{const n=structuredClone(prev);n.manufacturing.bessProducts[i].priceRange=e.target.value;return n;})} /></td>
                    <td><input className="edit-input edit-input-text" value={row.margin} onChange={e => setInv(prev=>{const n=structuredClone(prev);n.manufacturing.bessProducts[i].margin=e.target.value;return n;})} /></td>
                  </>
                ) : (
                  <><td>{row.product}</td><td>{row.segment}</td><td>{row.marketSize}</td><td>{row.priceRange}</td><td>{row.margin}</td></>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="tag-row">
          {m.bessWhyWins.map((w, i) => (
            <div key={i} className="tag-chip">
              <span className="tag-chip-icon">{w.icon}</span>
              {editMode
                ? <input className="edit-input edit-input-text" value={w.text}
                    onChange={e => setInv(prev => { const n = structuredClone(prev); n.manufacturing.bessWhyWins[i].text = e.target.value; return n; })} />
                : <span className="tag-chip-text">{w.text}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* BESS Revenue & Capacity Projection */}
      <GenericDualChart
        title="Battery (BESS) — Revenue &amp; Capacity Deployed, FY27–FY31"
        categories={m.bessProjection.years}
        series1={m.bessProjection.revenue} series1Label="Revenue (₹ Cr)"
        series2={m.bessProjection.capacityMWh} series2Label="Capacity (MWh)"
        asLine2={true}
      />
      <div className="kpi-row">
        <KPICard label="Phase 1 CAPEX" value={`₹${m.bessPhase1.capex} Cr`} />
        <KPICard label="Target IRR" value={`${m.bessPhase1.irr}%`} />
        <KPICard label="Payback Period" value={`${m.bessPhase1.payback} yrs`} />
        <KPICard label="Year 5 Revenue (FY31)" value={`₹${m.bessPhase1.year5Revenue} Cr`} />
      </div>
    </div>
  );
}
