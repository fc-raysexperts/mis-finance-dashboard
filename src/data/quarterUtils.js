// Quarter helpers — month idx 0-11 maps to Apr..Mar (see structure.js)
export const QUARTERS = [
  { id: 'Q1', label: 'Q1 (Apr-Jun)', idxs: [0, 1, 2] },
  { id: 'Q2', label: 'Q2 (Jul-Sep)', idxs: [3, 4, 5] },
  { id: 'Q3', label: 'Q3 (Oct-Dec)', idxs: [6, 7, 8] },
  { id: 'Q4', label: 'Q4 (Jan-Mar)', idxs: [9, 10, 11] },
];

function sumSubs(data, subs, idxs) {
  return subs.reduce((s, sub) => {
    const arr = data[sub] || [];
    return s + idxs.reduce((ss, i) => ss + (arr[i] || 0), 0);
  }, 0);
}

// Compute Revenue/Expense totals for a given set of month indices (a quarter, or all 12 for full year)
export function computeTotals(revData, expData, allRevSubs, allExpSubs, idxs) {
  const totalRev = sumSubs(revData, allRevSubs, idxs);
  const totalExp = sumSubs(expData, allExpSubs, idxs);
  const finCost  = sumSubs(expData, ['Finance Costs'], idxs);
  const taxExp   = sumSubs(expData, ['Tax Paid Expense'], idxs);
  const depn     = sumSubs(expData, ['Depreciation'], idxs);
  const ebitda   = totalRev - totalExp + finCost + taxExp + depn;
  const pbt      = totalRev - totalExp + taxExp; // = EBITDA - finCost - depn
  const ebitdaMargin = totalRev !== 0 ? (ebitda / totalRev) * 100 : 0;
  return { totalRev, totalExp, finCost, taxExp, depn, ebitda, pbt, ebitdaMargin };
}

// Which month indices out of a quarter/year have actually elapsed (visible) for this FY
export function elapsedIdxs(idxs, visMo) {
  const visSet = new Set(visMo.map(m => m.idx));
  return idxs.filter(i => visSet.has(i));
}
