import * as XLSX from 'xlsx';
import { fmt } from './utils.js';
import { REV_STRUCTURE, EXP_STRUCTURE, FY_CONFIG, MONTHS } from './data/structure.js';
import { getRevData, getExpData } from './data/dataService.js';

function rowSum(arr, visMo) {
  return visMo.reduce((s, m) => s + (arr[m.idx] || 0), 0);
}

// Build a worksheet array-of-arrays
function buildMonthlyPLSheet(revData, expData, visMo, fyLabel) {
  const allRevSubs = Object.keys(revData);
  const allExpSubs = Object.keys(expData);
  const moLabels = visMo.map(m => m.label);

  const totalRev = visMo.map(m => allRevSubs.reduce((s, sub) => s + ((revData[sub] || [])[m.idx] || 0), 0));
  const totalExp = visMo.map(m => allExpSubs.reduce((s, sub) => s + ((expData[sub] || [])[m.idx] || 0), 0));
  const finCost  = visMo.map(m => (expData['Finance Costs'] || [])[m.idx] || 0);
  const depn     = visMo.map(m => (expData['Depreciation']  || [])[m.idx] || 0);
  const profit   = visMo.map((_, i) => totalRev[i] - totalExp[i] + finCost[i] + depn[i]);

  const header = ['Particulars', ...moLabels, 'Total'];
  const rows = [
    [`Monthly P&L — ${fyLabel}`],
    header,
    ['Total Revenue',             ...totalRev, totalRev.reduce((a,b)=>a+b,0)],
    ['Total Expenses (Excl. Tax)',...totalExp, totalExp.reduce((a,b)=>a+b,0)],
    ['Finance Cost (Interest)',   ...finCost,  finCost.reduce((a,b)=>a+b,0)],
    ['Depreciation',              ...depn,     depn.reduce((a,b)=>a+b,0)],
    ['Profit Before Dep & Tax',   ...profit,   profit.reduce((a,b)=>a+b,0)],
  ];
  return rows;
}

function buildStructureSheet(structure, data, visMo, title) {
  const allSubs = structure.flatMap(g => g.subs);
  const colTotals = visMo.map(m => allSubs.reduce((s, sub) => s + ((data[sub] || [])[m.idx] || 0), 0));
  const moLabels = visMo.map(m => m.label);

  const rows = [
    [title],
    ['Head', 'Sub-Head', ...moLabels, 'Total'],
  ];
  structure.forEach(grp => {
    grp.subs.forEach((sub, si) => {
      const arr = data[sub] || Array(12).fill(0);
      const tot = rowSum(arr, visMo);
      const vals = visMo.map(m => arr[m.idx] || 0);
      rows.push([si === 0 ? grp.head : '', sub, ...vals, tot]);
    });
  });
  rows.push(['', 'Total', ...colTotals, colTotals.reduce((a,b)=>a+b,0)]);
  return rows;
}

function buildComparisonSheet(structure, fyDatasets, moIdx, title, isRev) {
  const fyLabels = FY_CONFIG.map(f => f.label);
  const getVal = (arr, visMo) => moIdx === null ? rowSum(arr, visMo) : (arr[moIdx] || 0);
  const allSubs = structure.flatMap(g => g.subs);

  const colTotals = Array(FY_CONFIG.length).fill(0);
  const rows = [
    [title],
    ['Head', 'Sub-Head', ...fyLabels, 'Total'],
  ];
  structure.forEach(grp => {
    grp.subs.forEach((sub, si) => {
      const vals = fyDatasets.map(fd => {
        const d = isRev ? fd.rev : fd.exp;
        return getVal(d.data[sub] || [], d.visMo);
      });
      vals.forEach((v, i) => { colTotals[i] += v; });
      rows.push([si === 0 ? grp.head : '', sub, ...vals, vals.reduce((a,b)=>a+b,0)]);
    });
  });
  rows.push(['', 'Total', ...colTotals, colTotals.reduce((a,b)=>a+b,0)]);
  return rows;
}

function buildPLComparisonSheet(fyDatasets, moIdx) {
  const fyLabels = FY_CONFIG.map(f => f.label);
  const getVal = (arr, visMo) => moIdx === null ? rowSum(arr, visMo) : (arr[moIdx] || 0);

  const totalRevVals = fyDatasets.map(fd =>
    Object.keys(fd.rev.data).reduce((s, sub) => s + getVal(fd.rev.data[sub] || [], fd.rev.visMo), 0));
  const totalExpVals = fyDatasets.map(fd =>
    Object.keys(fd.exp.data).reduce((s, sub) => s + getVal(fd.exp.data[sub] || [], fd.exp.visMo), 0));
  const finCostVals = fyDatasets.map(fd => getVal(fd.exp.data['Finance Costs'] || [], fd.exp.visMo));
  const depnVals    = fyDatasets.map(fd => getVal(fd.exp.data['Depreciation']   || [], fd.exp.visMo));
  const profitVals  = totalRevVals.map((r, i) => r - totalExpVals[i] + finCostVals[i] + depnVals[i]);

  return [
    ['P&L Comparison'],
    ['Particulars', ...fyLabels, 'Total'],
    ['Total Revenue',             ...totalRevVals, totalRevVals.reduce((a,b)=>a+b,0)],
    ['Total Expenses (Excl. Tax)',...totalExpVals, totalExpVals.reduce((a,b)=>a+b,0)],
    ['Finance Cost (Interest)',   ...finCostVals,  finCostVals.reduce((a,b)=>a+b,0)],
    ['Depreciation',              ...depnVals,     depnVals.reduce((a,b)=>a+b,0)],
    ['Profit Before Dep & Tax',   ...profitVals,   profitVals.reduce((a,b)=>a+b,0)],
  ];
}

function sheetFromRows(rows) {
  return XLSX.utils.aoa_to_sheet(rows);
}

function download(wb, filename) {
  XLSX.writeFile(wb, filename);
}

export function downloadFYSheet(fyId, fyLabel, revData, expData, visMo) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromRows(buildMonthlyPLSheet(revData, expData, visMo, fyLabel)), 'Monthly P&L');
  XLSX.utils.book_append_sheet(wb, sheetFromRows(buildStructureSheet(REV_STRUCTURE, revData, visMo, `Revenue — ${fyLabel}`)), 'Revenue');
  XLSX.utils.book_append_sheet(wb, sheetFromRows(buildStructureSheet(EXP_STRUCTURE, expData, visMo, `Expenses — ${fyLabel}`)), 'Expenses');
  download(wb, `MIS_${fyLabel.replace(' ','')}.xlsx`);
}

export function downloadComparisonSheet(selOption) {
  const moIdx = selOption === 0 ? null : selOption - 1;
  const period = selOption === 0 ? 'Annual' : MONTHS[selOption - 1];
  const fyDatasets = FY_CONFIG.map(f => ({ rev: getRevData(f.id), exp: getExpData(f.id) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromRows(buildPLComparisonSheet(fyDatasets, moIdx)), 'Monthly P&L');
  XLSX.utils.book_append_sheet(wb, sheetFromRows(buildComparisonSheet(REV_STRUCTURE, fyDatasets, moIdx, `Revenue — ${period}`, true)),  'Revenue');
  XLSX.utils.book_append_sheet(wb, sheetFromRows(buildComparisonSheet(EXP_STRUCTURE, fyDatasets, moIdx, `Expenses — ${period}`, false)), 'Expenses');
  download(wb, `MIS_Comparison_${period}.xlsx`);
}
