import React, { useState, useEffect } from 'react';
import { fmt } from '../utils.js';
import { REV_STRUCTURE, FY_CONFIG, MONTHS } from '../data/structure.js';
import { getRevData, getExpData } from '../data/dataService.js';
import { QUARTERS, computeTotals } from '../data/quarterUtils.js';
import { loadInvestorData, saveInvestorData, DEFAULTS } from '../data/investorData.js';
import { InvestorMonthlyChart, HeadBreakdownPie, MoneyBreakdownBars, GenericDualChart } from './Charts.jsx';

function KPICard({ label, value, sub, positive }) {
  return (
    <div className="kpi-card">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      {sub && <div className={`kpi-sub${positive === false ? ' kpi-sub-neg' : ''}`}>{sub}</div>}
    </div>
  );
}

export default function InvestorSummary({ curFY }) {
  const [qId, setQId] = useState('Q1');
  const [editMode, setEditMode] = useState(false);
  const [inv, setInv] = useState(DEFAULTS);
  useEffect(() => { loadInvestorData().then(setInv); }, []);

  const quarter = QUARTERS.find(q => q.id === qId);
  const fyIdx = FY_CONFIG.findIndex(f => f.id === curFY);
  const prevFY = fyIdx > 0 ? FY_CONFIG[fyIdx - 1].id : null;

  const revD = getRevData(curFY);
  const expD = getExpData(curFY);
  const allRevSubs = Object.keys(revD.data);
  const allExpSubs = Object.keys(expD.data);

  const cur = computeTotals(revD.data, expD.data, allRevSubs, allExpSubs, quarter.idxs);

  let prior = null;
  if (prevFY) {
    const prevRevD = getRevData(prevFY);
    const prevExpD = getExpData(prevFY);
    prior = computeTotals(prevRevD.data, prevExpD.data, Object.keys(prevRevD.data), Object.keys(prevExpD.data), quarter.idxs);
  }

  const yoy = (curVal, priorVal) => {
    if (!prior || !priorVal) return '—';
    return (curVal / priorVal).toFixed(1) + 'x';
  };

  // Monthly breakdown within the quarter (only elapsed months)
  const qMonths = quarter.idxs
    .map(idx => ({ idx, label: MONTHS[idx] }))
    .filter(m => revD.visMo.some(v => v.idx === m.idx));
  const monthlyRev = qMonths.map(m => allRevSubs.reduce((s, sub) => s + ((revD.data[sub] || [])[m.idx] || 0), 0));
  const monthlyExp = qMonths.map(m => allExpSubs.reduce((s, sub) => s + ((expD.data[sub] || [])[m.idx] || 0), 0));
  const monthlyFin = qMonths.map(m => (expD.data['Finance Costs']    || [])[m.idx] || 0);
  const monthlyTax = qMonths.map(m => (expD.data['Tax Paid Expense'] || [])[m.idx] || 0);
  const monthlyDep = qMonths.map(m => (expD.data['Depreciation']     || [])[m.idx] || 0);
  const monthlyEbitda = monthlyRev.map((r, i) => r - monthlyExp[i] + monthlyFin[i] + monthlyTax[i] + monthlyDep[i]);
  const monthlyMargins = monthlyRev.map((r, i) => r !== 0 ? (monthlyEbitda[i] / r) * 100 : 0);

  // Revenue mix by head for the quarter
  const revHeadTotals = REV_STRUCTURE.map(grp => ({
    name: grp.head,
    value: grp.subs.reduce((s, sub) => {
      const arr = revD.data[sub] || [];
      return s + quarter.idxs.reduce((ss, i) => ss + (arr[i] || 0), 0);
    }, 0),
  }));

  // "Where the money went" — auto-derived from expense sub-heads as % of revenue
  const materials = ['Purchases','Purchases (Import Goods)','Purchases (Custom Duty)','Purchases (O&M)',
    'Purchases (Rays Rooftop)','Purchases (Others)','Purchases (NPD)','New Park Development',
    'Opening Inventories - Closing Inventories']
    .reduce((s, sub) => s + quarter.idxs.reduce((ss,i) => ss + ((expD.data[sub]||[])[i]||0), 0), 0);
  const directProject = ['Civil and Erection Expenses','Transportation Expense',
    'Project Management & Technical Services','Land Lease Expenses',
    'Module Services Expenses (O&M)','Security Expenses (O&M)']
    .reduce((s, sub) => s + quarter.idxs.reduce((ss,i) => ss + ((expD.data[sub]||[])[i]||0), 0), 0);
  const employeeCost = quarter.idxs.reduce((s,i) => s + ((expD.data['Salaries/Labour Charges and Staff Welfare']||[])[i]||0), 0);
  const financeOverheads = cur.totalExp - materials - directProject - employeeCost;

  const moneyItems = cur.totalRev > 0 ? [
    { label: 'Materials (incl. inventory)',  pct: (materials / cur.totalRev) * 100 },
    { label: 'Direct project costs',         pct: (directProject / cur.totalRev) * 100 },
    { label: 'Employee cost',                pct: (employeeCost / cur.totalRev) * 100 },
    { label: 'Finance, O&M & overheads',     pct: (financeOverheads / cur.totalRev) * 100 },
    { label: 'EBITDA',                       pct: cur.ebitdaMargin, isEbitda: true },
  ] : [];

  const update = (path, val) => {
    setInv(prev => {
      const next = structuredClone(prev);
      let obj = next;
      for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
      obj[path[path.length - 1]] = val;
      return next;
    });
  };

  const handleSave = async () => { await saveInvestorData(inv); setEditMode(false); };

  return (
    <div className="tab-content">
      <div className="investor-header-bar">
        <span className="cmp-main-title">Financial Metrics — {FY_CONFIG.find(f=>f.id===curFY)?.label}</span>
        <div className="cmp-selector-wrap">
          <label className="cmp-selector-label">Quarter:</label>
          <select className="mo-select" value={qId} onChange={e => setQId(e.target.value)}>
            {QUARTERS.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}
          </select>
          {!editMode
            ? <button className="edit-btn" onClick={() => setEditMode(true)}>✎ Edit Collections</button>
            : <button className="edit-btn edit-btn-save" onClick={handleSave}>💾 Save</button>}
        </div>
      </div>

      {/* KPI cards */}
      <div className="kpi-row">
        <KPICard label="Total Revenue" value={fmt(cur.totalRev)}
          sub={prior ? `${yoy(cur.totalRev, prior.totalRev)} vs ${quarter.id} ${FY_CONFIG[fyIdx-1]?.label} (${fmt(prior.totalRev)})` : null} />
        <KPICard label="EBITDA" value={fmt(cur.ebitda)}
          sub={prior ? `${yoy(cur.ebitda, prior.ebitda)} vs ${quarter.id} ${FY_CONFIG[fyIdx-1]?.label} (${fmt(prior.ebitda)})` : null} />
        <KPICard label="EBITDA Margin" value={cur.ebitdaMargin.toFixed(1) + '%'}
          sub={prior ? `vs ${prior.ebitdaMargin.toFixed(1)}% same period` : null} />
        <KPICard label="Profit Before Tax" value={fmt(cur.pbt)}
          sub={prior ? `vs ${fmt(prior.pbt)} same period` : null} />
      </div>

      <InvestorMonthlyChart
        months={qMonths.map(m => m.label)}
        revenue={monthlyRev}
        ebitda={monthlyEbitda}
        ebitdaMargins={monthlyMargins}
      />

      {/* Quarter comparison table */}
      <div className="chart-card">
        <div className="chart-card-title">{quarter.id} {FY_CONFIG.find(f=>f.id===curFY)?.label} vs {quarter.id} {prevFY ? FY_CONFIG[fyIdx-1].label : '—'}</div>
        <table className="investor-cmp-table">
          <thead>
            <tr><th>Particulars</th><th>{quarter.id} {FY_CONFIG.find(f=>f.id===curFY)?.label}</th><th>{quarter.id} {prevFY ? FY_CONFIG[fyIdx-1].label : '—'}</th><th>YoY</th></tr>
          </thead>
          <tbody>
            <tr><td>Total Revenue</td><td>{fmt(cur.totalRev)}</td><td>{prior ? fmt(prior.totalRev) : '—'}</td><td>{yoy(cur.totalRev, prior?.totalRev)}</td></tr>
            <tr><td>Total Expenses</td><td>{fmt(cur.totalExp)}</td><td>{prior ? fmt(prior.totalExp) : '—'}</td><td>{yoy(cur.totalExp, prior?.totalExp)}</td></tr>
            <tr className="investor-row-strong"><td>EBITDA</td><td>{fmt(cur.ebitda)}</td><td>{prior ? fmt(prior.ebitda) : '—'}</td><td>{yoy(cur.ebitda, prior?.ebitda)}</td></tr>
            <tr><td>EBITDA Margin</td><td>{cur.ebitdaMargin.toFixed(1)}%</td><td>{prior ? prior.ebitdaMargin.toFixed(1)+'%' : '—'}</td><td>—</td></tr>
            <tr className="investor-row-strong"><td>Profit Before Tax</td><td>{fmt(cur.pbt)}</td><td>{prior ? fmt(prior.pbt) : '—'}</td><td>{yoy(cur.pbt, prior?.pbt)}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="chart-row">
        <HeadBreakdownPie title={`Revenue Mix — ${fmt(cur.totalRev)}`} headTotals={revHeadTotals} />
        <MoneyBreakdownBars items={moneyItems} />
      </div>

      {/* Collections — manually editable, not available via ZB API */}
      <div className="chart-card">
        <div className="chart-card-title">Collections — {quarter.id} Billing Cycle</div>
        <div className="kpi-row">
          <div className="kpi-card">
            {editMode
              ? <input className="edit-input edit-input-num" type="number" value={inv.collections.invoicesRaised}
                  onChange={e => update(['collections','invoicesRaised'], Number(e.target.value))} />
              : <div className="kpi-value">{inv.collections.invoicesRaised}</div>}
            <div className="kpi-label">Invoices Raised</div>
            <div className="kpi-sub">
              {editMode
                ? <>₹<input className="edit-input edit-input-num" type="number" step="0.01" value={inv.collections.grossBilling}
                    onChange={e => update(['collections','grossBilling'], Number(e.target.value))} /> Cr gross (incl. GST)</>
                : `₹${inv.collections.grossBilling} Cr gross (incl. GST)`}
            </div>
          </div>
          <div className="kpi-card">
            {editMode
              ? <input className="edit-input edit-input-num" type="number" value={inv.collections.collectedPct}
                  onChange={e => update(['collections','collectedPct'], Number(e.target.value))} />
              : <div className="kpi-value kpi-value-green">{inv.collections.collectedPct}%</div>}
            <div className="kpi-label">Collected in Cycle</div>
            <div className="kpi-sub">
              {editMode
                ? <>₹<input className="edit-input edit-input-num" type="number" step="0.01" value={inv.collections.collectedAmt}
                    onChange={e => update(['collections','collectedAmt'], Number(e.target.value))} /> Cr realised</>
                : `₹${inv.collections.collectedAmt} Cr realised`}
            </div>
          </div>
          <div className="kpi-card">
            {editMode
              ? <>₹<input className="edit-input edit-input-num" type="number" step="0.01" value={inv.collections.outstanding}
                  onChange={e => update(['collections','outstanding'], Number(e.target.value))} /> Cr</>
              : <div className="kpi-value">₹{inv.collections.outstanding} Cr</div>}
            <div className="kpi-label">Outstanding</div>
            <div className="kpi-sub">
              {editMode
                ? <><input className="edit-input edit-input-num" type="number" step="0.1" value={inv.collections.outstandingPct}
                    onChange={e => update(['collections','outstandingPct'], Number(e.target.value))} />% of gross billing</>
                : `${inv.collections.outstandingPct}% of gross billing`}
            </div>
          </div>
        </div>

        <div className="kpi-row" style={{ marginTop: 12 }}>
          <div className="kpi-card">
            <div className="kpi-value kpi-value-green">{yoy(cur.totalRev, prior?.totalRev)}</div>
            <div className="kpi-label">Revenue Growth (YoY)</div>
            <div className="kpi-sub">Live from Zoho Books</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value kpi-value-green">{yoy(cur.ebitda, prior?.ebitda)}</div>
            <div className="kpi-label">EBITDA Growth (YoY)</div>
            <div className="kpi-sub">Live from Zoho Books</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value kpi-value-green">{yoy(cur.pbt, prior?.pbt)}</div>
            <div className="kpi-label">PBT Growth (YoY)</div>
            <div className="kpi-sub">Live from Zoho Books</div>
          </div>
        </div>
      </div>

      {/* Company at a Glance — full-year provisional figures (manually editable) */}
      <div className="chart-card">
        <div className="chart-card-title">Company at a Glance — FY26 Full Year (Provisional)</div>
        <div className="kpi-row">
          <KPICard label="Revenue from Operations" value={editMode
            ? <>₹<input className="edit-input edit-input-num" type="number" step="0.01" value={inv.companyGlance.revenue}
                onChange={e => update(['companyGlance','revenue'], Number(e.target.value))} /> Cr</>
            : `₹${inv.companyGlance.revenue} Cr`} sub={`${inv.companyGlance.revenueYoY} vs prior FY (₹${inv.companyGlance.revenuePrior} Cr)`} />
          <KPICard label="Profit Before Tax" value={editMode
            ? <>₹<input className="edit-input edit-input-num" type="number" step="0.01" value={inv.companyGlance.pbt}
                onChange={e => update(['companyGlance','pbt'], Number(e.target.value))} /> Cr</>
            : `₹${inv.companyGlance.pbt} Cr`} sub={`${inv.companyGlance.pbtYoY} vs prior FY (₹${inv.companyGlance.pbtPrior} Cr)`} />
          <KPICard label="PBT Margin" value={`${inv.companyGlance.pbtMargin}%`} sub={`vs ${inv.companyGlance.pbtMarginPrior}% prior FY`} />
          <KPICard label="EBITDA" value={`₹${inv.companyGlance.ebitda} Cr`} sub="Full year" />
        </div>
        <div className="kpi-row" style={{ marginTop: 12 }}>
          <KPICard label="EBITDA Margin" value={`${inv.companyGlance.ebitdaMargin}%`} sub={`vs ${inv.companyGlance.ebitdaMarginPrior}% prior FY`} />
          <KPICard label="Shareholders' Funds" value={`₹${inv.companyGlance.shareholdersFunds} Cr`} sub={`${inv.companyGlance.shareholdersFundsYoY} vs prior FY`} />
          <KPICard label="Cash & Bank Equivalents" value={`₹${inv.companyGlance.cash} Cr`} sub={`${inv.companyGlance.cashYoY} vs prior FY`} />
          <KPICard label="Gearing (D/E)" value={inv.companyGlance.gearing} sub="Essentially debt-free" />
        </div>
      </div>

      {/* 3-Year Revenue & PBT Trajectory */}
      <GenericDualChart
        title="Revenue &amp; Profit Growth — 3-Yr Trajectory (₹ Cr)"
        categories={inv.trajectory.years}
        series1={inv.trajectory.revenue} series1Label="Revenue"
        series2={inv.trajectory.pbt} series2Label="PBT"
        asLine2={true}
      />

      {/* Group Structure */}
      <div className="chart-card">
        <div className="chart-card-title">Group Structure — Built for Diversification</div>
        <div className="group-structure-row">
          {inv.groupStructure.map((g, i) => (
            <div key={i} className="group-entity-card">
              {editMode ? (
                <>
                  <input className="edit-input edit-input-text" value={g.name}
                    onChange={e => setInv(prev => { const n = structuredClone(prev); n.groupStructure[i].name = e.target.value; return n; })} />
                  <input className="edit-input edit-input-text" value={g.role}
                    onChange={e => setInv(prev => { const n = structuredClone(prev); n.groupStructure[i].role = e.target.value; return n; })} />
                </>
              ) : (
                <>
                  <div className="group-entity-name">{g.name}</div>
                  <div className="group-entity-role">{g.role}</div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
