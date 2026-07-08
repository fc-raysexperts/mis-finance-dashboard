import React from 'react';
import { fmt, rowSum } from '../utils.js';
import { HeadBreakdownPie, MonthlyTotalBarChart } from './Charts.jsx';

export default function FinTable({ structure, data, visMo, chartTitle, chartColor }) {
  if (!visMo || visMo.length === 0) {
    return <p className="no-data">No data available for this period yet.</p>;
  }

  const allSubs = structure.flatMap(g => g.subs);
  const colTotals = visMo.map(m =>
    allSubs.reduce((s, sub) => s + ((data[sub] || [])[m.idx] || 0), 0)
  );
  const grandTotal = colTotals.reduce((a, b) => a + b, 0);

  // Head-wise totals for pie chart
  const headTotals = structure.map(grp => ({
    name: grp.head,
    value: grp.subs.reduce((s, sub) => s + rowSum(data[sub] || [], visMo), 0),
  }));

  return (
    <div className="tab-content">
      <div className="chart-row">
        <HeadBreakdownPie title={`${chartTitle} Breakdown by Head`} headTotals={headTotals} />
        <MonthlyTotalBarChart
          title={`Monthly ${chartTitle} Trend`}
          months={visMo.map(m => m.label)}
          values={visMo.map(m => allSubs.reduce((s, sub) => s + ((data[sub] || [])[m.idx] || 0), 0))}
          color={chartColor}
        />
      </div>

      <div className="tbl-wrap no-scroll">
        <table>
          <thead>
            <tr>
              <th className="col-head">Head</th>
              <th className="col-sub">Sub-Head</th>
              {visMo.map(m => <th key={m.idx} className="col-num">{m.label}</th>)}
              <th className="col-num col-total-hd">Total</th>
            </tr>
          </thead>
          <tbody>
            {structure.map((grp, gi) =>
              grp.subs.map((sub, si) => {
                const arr = data[sub] || Array(12).fill(0);
                const tot = rowSum(arr, visMo);
                const isLastInGroup = si === grp.subs.length - 1;
                const isLastGroup   = gi === structure.length - 1;
                const sepClass = isLastInGroup && !isLastGroup ? 'head-group-end' : '';
                return (
                  <tr key={sub} className={sepClass}>
                    {si === 0 && (
                      <td className="col-head" rowSpan={grp.subs.length}>{grp.head}</td>
                    )}
                    <td className="col-sub">{sub}</td>
                    {visMo.map(m => {
                      const v = arr[m.idx] || 0;
                      return <td key={m.idx} className={`col-num${v < 0 ? ' neg' : ''}`}>{fmt(v)}</td>;
                    })}
                    <td className={`col-num col-total-val${tot < 0 ? ' neg' : ''}`}>{fmt(tot)}</td>
                  </tr>
                );
              })
            )}
            {/* Total row — plain tbody, light blue, black numbers, no hover fade */}
            <tr className="row-fin-total">
              <td className="col-head">Total</td>
              <td className="col-sub"></td>
              {colTotals.map((v, i) => (
                <td key={i} className="col-num">{fmt(v)}</td>
              ))}
              <td className="col-num col-total-val">{fmt(grandTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
