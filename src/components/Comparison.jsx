import React from 'react';
import { fmt, rowSum } from '../utils.js';
import { REV_STRUCTURE, EXP_STRUCTURE, FY_CONFIG, MONTHS } from '../data/structure.js';
import { getRevData, getExpData } from '../data/dataService.js';

function PLRowsInner({ fyDatasets, moIdx }) {
  const N = FY_CONFIG.length;
  const getVal = (arr, visMo) => moIdx === null ? rowSum(arr, visMo) : (arr[moIdx] || 0);

  const totalRevVals = fyDatasets.map(fd =>
    Object.keys(fd.rev.data).reduce((s, sub) => s + getVal(fd.rev.data[sub] || [], fd.rev.visMo), 0));
  const totalExpVals = fyDatasets.map(fd =>
    Object.keys(fd.exp.data).reduce((s, sub) => s + getVal(fd.exp.data[sub] || [], fd.exp.visMo), 0));
  const finCostVals = fyDatasets.map(fd => getVal(fd.exp.data['Finance Costs'] || [], fd.exp.visMo));
  const depnVals    = fyDatasets.map(fd => getVal(fd.exp.data['Depreciation']   || [], fd.exp.visMo));
  const profitVals  = totalRevVals.map((r, i) => r - totalExpVals[i] + finCostVals[i] + depnVals[i]);

  const plRows = [
    { label: 'Total Revenue',              vals: totalRevVals, cls: 'pl-rev' },
    { label: 'Total Expenses (Excl. Tax)', vals: totalExpVals, cls: 'pl-exp' },
    { label: 'Finance Cost (Interest)',    vals: finCostVals,  cls: 'pl-sub' },
    { label: 'Depreciation',              vals: depnVals,     cls: 'pl-sub' },
    { label: 'Profit Before Dep & Tax',   vals: profitVals,   cls: 'pl-profit', isProfit: true },
  ];

  return (
    <>
      <tr className="cmp-section-hd"><td colSpan={N + 3}>MONTHLY P&amp;L SUMMARY</td></tr>
      {plRows.map(r => {
        const tot = r.vals.reduce((a, b) => a + b, 0);
        return (
          <tr key={r.label} className={r.cls}>
            <td className="col-head"></td>
            <td className="col-sub" colSpan={2}>{r.label}</td>
            {r.vals.map((v, i) => (
              <td key={i} className={`col-num${r.isProfit ? (v >= 0 ? ' profit-pos' : ' profit-neg') : (v < 0 ? ' neg' : '')}`}>{fmt(v)}</td>
            ))}
            <td className={`col-num col-total-val${r.isProfit ? (tot >= 0 ? ' profit-pos' : ' profit-neg') : (tot < 0 ? ' neg' : '')}`}>{fmt(tot)}</td>
          </tr>
        );
      })}
    </>
  );
}

function CmpSection({ label, structure, fyDatasets, moIdx, isRev }) {
  const N = FY_CONFIG.length;
  const getVal = (arr, visMo) => moIdx === null ? rowSum(arr, visMo) : (arr[moIdx] || 0);
  const colTotals = Array(N).fill(0);
  const vals = {};
  structure.flatMap(g => g.subs).forEach(sub => {
    vals[sub] = fyDatasets.map(fd => {
      const d = isRev ? fd.rev : fd.exp;
      return getVal(d.data[sub] || [], d.visMo);
    });
    vals[sub].forEach((v, fi) => { colTotals[fi] += v; });
  });
  const grandTotal = colTotals.reduce((a, b) => a + b, 0);

  return (
    <>
      <tr className="cmp-section-hd"><td colSpan={N + 3}>{label.toUpperCase()}</td></tr>
      {structure.map((grp, gi) =>
        grp.subs.map((sub, si) => {
          const v = vals[sub];
          const rowTot = v.reduce((a, b) => a + b, 0);
          const isLastInGroup = si === grp.subs.length - 1;
          const isLastGroup   = gi === structure.length - 1;
          const sepClass = isLastInGroup && !isLastGroup ? 'head-group-end' : '';
          return (
            <tr key={sub} className={sepClass}>
              {si === 0 && <td className="col-head" rowSpan={grp.subs.length}>{grp.head}</td>}
              <td className="col-sub" colSpan={2}>{sub}</td>
              {v.map((val, fi) => (
                <td key={fi} className={`col-num${val < 0 ? ' neg' : ''}`}>{fmt(val)}</td>
              ))}
              <td className={`col-num col-total-val${rowTot < 0 ? ' neg' : ''}`}>{fmt(rowTot)}</td>
            </tr>
          );
        })
      )}
      {/* Section total row */}
      <tr className="row-section-total head-group-end">
        <td className="col-head">Total</td>
        <td className="col-sub" colSpan={2}></td>
        {colTotals.map((v, i) => (
          <td key={i} className={`col-num${v < 0 ? ' neg' : ''}`}>{fmt(v)}</td>
        ))}
        <td className={`col-num col-total-val${grandTotal < 0 ? ' neg' : ''}`}>{fmt(grandTotal)}</td>
      </tr>
    </>
  );
}

export default function Comparison({ selOption, setSelOption }) {
  const fyDatasets = FY_CONFIG.map(f => ({
    rev: getRevData(f.id),
    exp: getExpData(f.id),
  }));
  const moIdx = selOption === 0 ? null : selOption - 1;

  return (
    <div className="tab-content">
      <div className="cmp-header-bar">
        <span className="cmp-main-title">Comparison — All Fiscal Years</span>
        <div className="cmp-selector-wrap">
          <label className="cmp-selector-label">Period:</label>
          <select className="mo-select" value={selOption}
            onChange={e => setSelOption(Number(e.target.value))}>
            <option value={0}>Annual (Full Year)</option>
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
      </div>

      {/* Single table, scrolls inside itself */}
      <div className="tbl-wrap no-scroll">
        <table>
          <thead>
            <tr>
              <th className="col-head">Head</th>
              <th className="col-sub" colSpan={2}>Sub-Head / Particulars</th>
              {FY_CONFIG.map(f => <th key={f.id} className="col-num">{f.label}</th>)}
              <th className="col-num col-total-hd">Total</th>
            </tr>
          </thead>
          <tbody>
            <PLRowsInner fyDatasets={fyDatasets} moIdx={moIdx} />
            <CmpSection label="Revenue"  structure={REV_STRUCTURE} fyDatasets={fyDatasets} moIdx={moIdx} isRev={true}  />
            <CmpSection label="Expenses" structure={EXP_STRUCTURE} fyDatasets={fyDatasets} moIdx={moIdx} isRev={false} />
          </tbody>
          {/* NO tfoot grand total — removed as requested */}
        </table>
      </div>
    </div>
  );
}
