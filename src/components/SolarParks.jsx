import React, { useState, useEffect } from 'react';
import { loadInvestorData, saveInvestorData, DEFAULTS } from '../data/investorData.js';
import { RevenuePotentialChart } from './Charts.jsx';

function KPICard({ label, value, sub }) {
  return (
    <div className="kpi-card">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export default function SolarParks() {
  const [editMode, setEditMode] = useState(false);
  const [inv, setInv] = useState(DEFAULTS);
  useEffect(() => { loadInvestorData().then(setInv); }, []);
  const { active, upcoming } = inv.solarParks;

  const activeTotals = active.reduce((a, p) => ({
    land: a.land + p.land, projects: a.projects + p.projects, orderValue: a.orderValue + p.orderValue,
  }), { land: 0, projects: 0, orderValue: 0 });
  const activeDcTotal = active.reduce((s, p) => s + parseFloat(p.dc), 0);
  // Revenue Potential = DC Capacity (MWp) × 3 (₹ Cr) — NOT the same as Order Value
  const activeRevenuePotential = active.reduce((s, p) => s + parseFloat(p.dc) * 3, 0);

  const upcomingTotals = upcoming.reduce((a, p) => ({
    land: a.land + p.land, potential: a.potential + p.potential,
  }), { land: 0, potential: 0 });
  const upcomingDcTotal = upcoming.reduce((s, p) => s + parseFloat(p.dc), 0);

  // Combined revenue-potential chart data — active + upcoming parks together
  const allParksPotential = [
    ...active.map(p => ({ name: p.park, potential: parseFloat(p.dc) * 3 })),
    ...upcoming.map(p => ({ name: p.park, potential: p.potential })),
  ];

  const updateActive = (i, key, val) => setInv(prev => {
    const next = structuredClone(prev); next.solarParks.active[i][key] = val; return next;
  });
  const updateUpcoming = (i, key, val) => setInv(prev => {
    const next = structuredClone(prev); next.solarParks.upcoming[i][key] = val; return next;
  });
  const handleSave = async () => { await saveInvestorData(inv); setEditMode(false); };

  return (
    <div className="tab-content">
      <div className="investor-header-bar">
        <span className="cmp-main-title">Solar Park Portfolio</span>
        <div className="cmp-selector-wrap">
          {!editMode
            ? <button className="edit-btn" onClick={() => setEditMode(true)}>✎ Edit Park Data</button>
            : <button className="edit-btn edit-btn-save" onClick={handleSave}>💾 Save</button>}
        </div>
      </div>

      {/* Active Parks */}
      <div className="chart-card">
        <div className="chart-card-title">Active Parks — 7 parks already generating order value</div>
        <div className="kpi-row">
          <KPICard label="Total Revenue Potential" value={`₹${activeRevenuePotential.toFixed(0)} Cr`} sub="Across the 7 active parks" />
          <KPICard label="Total DC Capacity" value={`${activeDcTotal.toFixed(1)} MWp`} sub="Across the 7 active parks" />
          <KPICard label="Land Owned" value={`${activeTotals.land.toFixed(1)} Ac`} sub="Fully acquired, no leasing risk" />
          <KPICard label="Total Order Value" value={`₹${activeTotals.orderValue.toFixed(2)} Cr`} sub={`${activeTotals.projects} projects under execution`} />
        </div>
        <table className="investor-cmp-table" style={{ marginTop: 14 }}>
          <thead><tr><th>Solar Park</th><th>Land (Ac)</th><th>DC Capacity</th><th>No. of Projects</th><th>Order Value (₹ Cr)</th><th>Revenue Potential (₹ Cr)</th></tr></thead>
          <tbody>
            {active.map((p, i) => (
              <tr key={i}>
                {editMode ? (
                  <>
                    <td><input className="edit-input edit-input-text" value={p.park} onChange={e => updateActive(i, 'park', e.target.value)} /></td>
                    <td><input className="edit-input edit-input-num" type="number" step="0.1" value={p.land} onChange={e => updateActive(i, 'land', Number(e.target.value))} /></td>
                    <td><input className="edit-input edit-input-text" value={p.dc} onChange={e => updateActive(i, 'dc', e.target.value)} /></td>
                    <td><input className="edit-input edit-input-num" type="number" value={p.projects} onChange={e => updateActive(i, 'projects', Number(e.target.value))} /></td>
                    <td><input className="edit-input edit-input-num" type="number" step="0.01" value={p.orderValue} onChange={e => updateActive(i, 'orderValue', Number(e.target.value))} /></td>
                    <td>{(parseFloat(p.dc) * 3).toFixed(0)}</td>
                  </>
                ) : (
                  <><td>{p.park}</td><td>{p.land.toFixed(1)}</td><td>{p.dc}</td><td>{p.projects}</td><td>{p.orderValue.toFixed(2)}</td><td>{(parseFloat(p.dc) * 3).toFixed(0)}</td></>
                )}
              </tr>
            ))}
            <tr className="investor-row-strong">
              <td>Total</td><td>{activeTotals.land.toFixed(1)}</td><td>{activeDcTotal.toFixed(1)} MWp</td>
              <td>{activeTotals.projects}</td><td>{activeTotals.orderValue.toFixed(2)}</td><td>{activeRevenuePotential.toFixed(0)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Upcoming Parks */}
      <div className="chart-card">
        <div className="chart-card-title">Upcoming Parks — 9 parks under development</div>
        <div className="kpi-row">
          <KPICard label="Under Development" value={`${upcoming.length} Parks`} sub="Land secured, awaiting orders" />
          <KPICard label="Total DC Capacity" value={`${upcomingDcTotal.toFixed(1)} MWp`} sub="Capacity allocation finalized" />
          <KPICard label="Land Owned" value={`${upcomingTotals.land.toFixed(1)} Ac`} sub="Finalizing total acquisition process" />
          <KPICard label="Total Revenue Potential" value={`₹${upcomingTotals.potential.toFixed(1)} Cr`} sub="Across all upcoming parks" />
        </div>
        <table className="investor-cmp-table" style={{ marginTop: 14 }}>
          <thead><tr><th>Solar Park</th><th>Location</th><th>Land (Ac)</th><th>DC Capacity</th><th>Revenue Potential (₹ Cr)</th></tr></thead>
          <tbody>
            {upcoming.map((p, i) => (
              <tr key={i}>
                {editMode ? (
                  <>
                    <td><input className="edit-input edit-input-text" value={p.park} onChange={e => updateUpcoming(i, 'park', e.target.value)} /></td>
                    <td><input className="edit-input edit-input-text" value={p.location} onChange={e => updateUpcoming(i, 'location', e.target.value)} /></td>
                    <td><input className="edit-input edit-input-num" type="number" step="0.1" value={p.land} onChange={e => updateUpcoming(i, 'land', Number(e.target.value))} /></td>
                    <td><input className="edit-input edit-input-text" value={p.dc} onChange={e => updateUpcoming(i, 'dc', e.target.value)} /></td>
                    <td><input className="edit-input edit-input-num" type="number" step="0.1" value={p.potential} onChange={e => updateUpcoming(i, 'potential', Number(e.target.value))} /></td>
                  </>
                ) : (
                  <><td>{p.park}</td><td>{p.location}</td><td>{p.land.toFixed(1)}</td><td>{p.dc}</td><td>{p.potential.toFixed(1)}</td></>
                )}
              </tr>
            ))}
            <tr className="investor-row-strong">
              <td colSpan={2}>Total</td><td>{upcomingTotals.land.toFixed(1)}</td><td>{upcomingDcTotal.toFixed(1)} MWp</td>
              <td>{upcomingTotals.potential.toFixed(1)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <RevenuePotentialChart parks={allParksPotential} />

      <div className="chart-card">
        <div className="chart-card-title">Combined Portfolio — Active + Upcoming Parks</div>
        <div className="kpi-row">
          <div className="kpi-card kpi-card-white">
            <div className="kpi-value">{active.length + upcoming.length}</div>
            <div className="kpi-label">No. of Parks</div>
          </div>
          <div className="kpi-card kpi-card-white">
            <div className="kpi-value">{(activeDcTotal + upcomingDcTotal).toFixed(1)} MWp</div>
            <div className="kpi-label">Total DC Capacity</div>
          </div>
          <div className="kpi-card kpi-card-white">
            <div className="kpi-value">{(activeTotals.land + upcomingTotals.land).toFixed(1)} Ac</div>
            <div className="kpi-label">Total Land</div>
          </div>
          <div className="kpi-card kpi-card-white">
            <div className="kpi-value">₹{(activeRevenuePotential + upcomingTotals.potential).toFixed(0)} Cr</div>
            <div className="kpi-label">Total Revenue Potential</div>
          </div>
        </div>
      </div>
    </div>
  );
}
