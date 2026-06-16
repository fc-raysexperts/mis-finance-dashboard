import React from 'react';
import { fmt, rowSum } from '../utils.js';
import { REV_STRUCTURE, EXP_STRUCTURE, FY_CONFIG } from '../data/structure.js';
import { getRevData, getExpData } from '../data/dataService.js';

function AnnualRowsInner() {
  const fyDatasets = FY_CONFIG.map(f => ({
    rev: getRevData(f.id),
    exp: getExpData(f.id),
  }));

  const revHeadTotals = REV_STRUCTURE.map(grp => ({
    head: grp.head,
    vals: fyDatasets.map(fd =>
      grp.subs.reduce((s, sub) => s + rowSum(fd.rev.data[sub] || [], fd.rev.visMo), 0)
    ),
  }));
  const expHeadTotals = EXP_STRUCTURE.map(grp => ({
    head: grp.head,
    vals: fyDatasets.map(fd =>
      grp.subs.reduce((s, sub) => s + rowSum(fd.exp.data[sub] || [], fd.exp.visMo), 0)
    ),
  }));
  const totalRevVals = fyDatasets.map(fd =>
    Object.keys(fd.rev.data).reduce((s, sub) => s + rowSum(fd.rev.data[sub] || [], fd.rev.visMo), 0)
  );
  const totalExpVals = fyDatasets.map(fd =>
    Object.keys(fd.exp.data).reduce((s, sub) => s + rowSum(fd.exp.data[sub] || [], fd.exp.visMo), 0)
  );
  const finCostVals = fyDatasets.map(fd => rowSum(fd.exp.data['Finance Costs']    || [], fd.exp.visMo));
  const taxExpVals  = fyDatasets.map(fd => rowSum(fd.exp.data['Tax Paid Expense'] || [], fd.exp.visMo));
  const depnVals    = fyDatasets.map(fd => rowSum(fd.exp.data['Depreciation']      || [], fd.exp.visMo));
  const ebitdaVals  = totalRevVals.map((r, i) => r - totalExpVals[i] + finCostVals[i] + taxExpVals[i] + depnVals[i]);

  return (
    <>
      <tr className="annual-section-hd">
        <td colSpan={FY_CONFIG.length + 1}>REVENUE</td>
      </tr>
      {revHeadTotals.map((r, ri) => (
        <tr key={r.head} className={`annual-head-row${ri === revHeadTotals.length - 1 ? ' head-group-end' : ''}`}>
          <td className="col-sub annual-head-label">{r.head}</td>
          {r.vals.map((v, i) => (
            <td key={i} className={`col-num${v < 0 ? ' neg' : ''}`}>{fmt(v)}</td>
          ))}
        </tr>
      ))}
      <tr className="annual-total-row">
        <td className="col-sub">Total Revenue</td>
        {totalRevVals.map((v, i) => (
          <td key={i} className={`col-num${v < 0 ? ' neg' : ''}`}>{fmt(v)}</td>
        ))}
      </tr>
      <tr className="annual-section-hd">
        <td colSpan={FY_CONFIG.length + 1}>EXPENSES</td>
      </tr>
      {expHeadTotals.map((r, ri) => (
        <tr key={r.head} className={`annual-head-row${ri === expHeadTotals.length - 1 ? ' head-group-end' : ''}`}>
          <td className="col-sub annual-head-label">{r.head}</td>
          {r.vals.map((v, i) => (
            <td key={i} className={`col-num${v < 0 ? ' neg' : ''}`}>{fmt(v)}</td>
          ))}
        </tr>
      ))}
      <tr className="annual-total-row">
        <td className="col-sub">Total Expenses</td>
        {totalExpVals.map((v, i) => (
          <td key={i} className={`col-num${v < 0 ? ' neg' : ''}`}>{fmt(v)}</td>
        ))}
      </tr>
      <tr className="annual-section-hd">
        <td colSpan={FY_CONFIG.length + 1}>PROFIT &amp; LOSS</td>
      </tr>
      <tr className="annual-head-row">
        <td className="col-sub annual-head-label">Finance Cost (Interest)</td>
        {finCostVals.map((v, i) => (
          <td key={i} className={`col-num${v < 0 ? ' neg' : ''}`}>{fmt(v)}</td>
        ))}
      </tr>
      <tr className="annual-head-row">
        <td className="col-sub annual-head-label">Tax Expenses</td>
        {taxExpVals.map((v, i) => (
          <td key={i} className={`col-num${v < 0 ? ' neg' : ''}`}>{fmt(v)}</td>
        ))}
      </tr>
      <tr className="annual-head-row head-group-end">
        <td className="col-sub annual-head-label">Depreciation &amp; Amortization</td>
        {depnVals.map((v, i) => (
          <td key={i} className={`col-num${v < 0 ? ' neg' : ''}`}>{fmt(v)}</td>
        ))}
      </tr>
      <tr className="annual-profit-row">
        <td className="col-sub">EBITDA</td>
        {ebitdaVals.map((v, i) => (
          <td key={i} className={`col-num${v >= 0 ? ' profit-pos' : ' profit-neg'}`}>{fmt(v)}</td>
        ))}
      </tr>
    </>
  );
}

export default function MonthlyPL({ revData, expData, visMo }) {
  if (!visMo || visMo.length === 0) {
    return <p className="no-data">No data available for this period yet.</p>;
  }

  const allRevSubs = Object.keys(revData);
  const allExpSubs = Object.keys(expData);
  const totalRev = visMo.map(m => allRevSubs.reduce((s, sub) => s + ((revData[sub] || [])[m.idx] || 0), 0));
  const totalExp = visMo.map(m => allExpSubs.reduce((s, sub) => s + ((expData[sub] || [])[m.idx] || 0), 0));
  const finCost  = visMo.map(m => (expData['Finance Costs']    || [])[m.idx] || 0);
  const taxExp   = visMo.map(m => (expData['Tax Paid Expense'] || [])[m.idx] || 0);
  const depn     = visMo.map(m => (expData['Depreciation']     || [])[m.idx] || 0);
  // EBITDA = Total Revenue − Total Expenses + Interest + Tax + D&A
  const ebitda   = visMo.map((_, i) => totalRev[i] - totalExp[i] + finCost[i] + taxExp[i] + depn[i]);

  const rows = [
    { label: 'Total Revenue',                arr: totalRev, cls: 'pl-rev' },
    { label: 'Total Expenses',               arr: totalExp, cls: 'pl-exp' },
    { label: 'Finance Cost (Interest)',       arr: finCost,  cls: 'pl-sub' },
    { label: 'Tax Expenses',                 arr: taxExp,   cls: 'pl-sub' },
    { label: 'Depreciation & Amortization',  arr: depn,     cls: 'pl-sub' },
    { label: 'EBITDA',                       arr: ebitda,   cls: 'pl-profit', isProfit: true },
  ];

  return (
    <div className="tab-content">
      {/* Monthly P&L table — no internal scroll, page scrolls */}
      <div className="tbl-wrap no-scroll">
        <table>
          <thead>
            <tr>
              <th className="col-sub" colSpan={2}>Particulars</th>
              {visMo.map(m => <th key={m.idx} className="col-num">{m.label}</th>)}
              <th className="col-num col-total-hd">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const tot = r.arr.reduce((a, b) => a + b, 0);
              return (
                <tr key={r.label} className={r.cls}>
                  <td colSpan={2}>{r.label}</td>
                  {r.arr.map((v, i) => (
                    <td key={i} className={`col-num${r.isProfit ? (v >= 0 ? ' profit-pos' : ' profit-neg') : (v < 0 ? ' neg' : '')}`}>
                      {fmt(v)}
                    </td>
                  ))}
                  <td className={`col-num${r.isProfit ? (tot >= 0 ? ' profit-pos' : ' profit-neg') : (tot < 0 ? ' neg' : '')}`}>
                    {fmt(tot)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Annual summary — no internal scroll, page scrolls */}
      <div className="annual-wrap">
        <div className="annual-title">Annual P&amp;L Comparison — All Fiscal Years</div>
        <div className="tbl-wrap no-scroll">
          <table>
            <thead>
              <tr>
                <th className="col-sub" style={{ width: '30%' }}>Particulars</th>
                {FY_CONFIG.map(f => <th key={f.id} className="col-num">{f.label}</th>)}
              </tr>
            </thead>
            <tbody>
              <AnnualRowsInner />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
