// Order Book table export — separate file, same pattern as excelExport.js
// and npdExcelExport.js, since this exports a completely different data
// shape (epcRevenueRecognition + the live-fetched invoiced-amount map)
// rather than the FY-based revenue/expense datasets those two handle.
import * as XLSX from 'xlsx';

function fmtCr(v) {
  return v === null || v === undefined ? '' : Number(v.toFixed(2));
}

// Column width = longest value actually in that column (header included),
// plus a little padding — not a fixed guess, so it always fits whatever
// the real data turns out to be.
function autoColWidths(rows) {
  const numCols = Math.max(...rows.map(r => r.length));
  const widths = [];
  for (let c = 0; c < numCols; c++) {
    let maxLen = 0;
    for (const row of rows) {
      const cell = row[c];
      const len = cell === null || cell === undefined ? 0 : String(cell).length;
      if (len > maxLen) maxLen = len;
    }
    widths.push({ wch: maxLen + 2 });
  }
  return widths;
}

export function downloadOrderBookSheet(epcRevenueRecognition, invoiced) {
  const header = [
    'S No.', 'Client Name', 'Park Location', 'DC Capacity (MWp)', 'BESS Capacity (MWh)',
    'Total Project Cost (Cr)', 'Invoiced FY26 (Cr)', 'Invoiced FY27 (Cr)', 'Invoiced Total (Cr)',
    'Status (%)', 'Commissioning Date',
  ];

  const rows = [header];
  let sumDC = 0, sumBESS = 0, sumTPC = 0, sumFY26 = 0, sumFY27 = 0, sumInvoiced = 0;

  epcRevenueRecognition.forEach((row, i) => {
    const iv = invoiced?.[row.client] || null;
    const fy26 = iv?.byFY?.FY26 ?? null;
    const fy27 = iv?.byFY?.FY27 ?? null;
    const totalInvoiced = iv?.total ?? null;
    const statusPct = (totalInvoiced != null && row.totalCost) ? Number(((totalInvoiced / row.totalCost) * 100).toFixed(1)) : null;

    sumDC += row.dcCapacity || 0;
    sumBESS += row.bessCapacity || 0;
    sumTPC += row.totalCost || 0;
    sumFY26 += fy26 || 0;
    sumFY27 += fy27 || 0;
    sumInvoiced += totalInvoiced || 0;

    rows.push([
      i + 1, row.client, row.park,
      fmtCr(row.dcCapacity), fmtCr(row.bessCapacity), fmtCr(row.totalCost),
      fmtCr(fy26), fmtCr(fy27), fmtCr(totalInvoiced),
      statusPct === null ? '' : statusPct,
      row.commissioningDate || '',
    ]);
  });

  const totalStatus = sumTPC > 0 ? Number(((sumInvoiced / sumTPC) * 100).toFixed(1)) : '';
  rows.push([
    '', 'Total', '', fmtCr(sumDC), fmtCr(sumBESS), fmtCr(sumTPC),
    fmtCr(sumFY26), fmtCr(sumFY27), fmtCr(sumInvoiced), totalStatus, '',
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = autoColWidths(rows);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Order Book');
  XLSX.writeFile(wb, 'Order_Book.xlsx');
}
