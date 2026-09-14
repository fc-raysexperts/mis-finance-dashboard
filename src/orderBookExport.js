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
    'Total Project Price (Cr)', 'Invoiced FY26 (Cr)', 'Invoiced FY27 (Cr)', 'Invoiced Total (Cr)',
    'Invoice Status (%)', 'Receipt FY26 (Cr)', 'Receipt FY27 (Cr)', 'Receipt Total (Cr)',
    'Receipts Status (%)', 'Commissioning Date',
  ];

  const rows = [header];
  let sumDC = 0, sumBESS = 0, sumTPC = 0, sumFY26 = 0, sumFY27 = 0, sumInvoiced = 0, sumRFY26 = 0, sumRFY27 = 0, sumReceipt = 0;

  epcRevenueRecognition.forEach((row, i) => {
    const iv = invoiced?.[row.projectId] || null;
    const fy26 = iv?.byFY?.FY26 ?? null;
    const fy27 = iv?.byFY?.FY27 ?? null;
    const totalInvoiced = iv?.total ?? null;
    const invoiceStatusPct = (totalInvoiced != null && row.totalCost) ? Number(((totalInvoiced / row.totalCost) * 100).toFixed(1)) : null;
    const rFy26 = iv?.paidByFY?.FY26 ?? null;
    const rFy27 = iv?.paidByFY?.FY27 ?? null;
    // Capped at Invoiced Amount — same reasoning as Outlook.jsx: a credit
    // note against an already-paid invoice can push the raw paid total
    // above net Invoiced Amount, which is an overpayment/credit situation,
    // not unreceived revenue, so it shouldn't read as >100% Receipts Status.
    const totalReceiptRaw = iv?.paidTotal ?? null;
    const totalReceipt = (totalReceiptRaw != null && totalInvoiced != null) ? Math.min(totalReceiptRaw, totalInvoiced) : totalReceiptRaw;
    const receiptStatusPct = (totalReceipt != null && totalInvoiced) ? Number(((totalReceipt / totalInvoiced) * 100).toFixed(1)) : null;

    sumDC += row.dcCapacity || 0;
    sumBESS += row.bessCapacity || 0;
    sumTPC += row.totalCost || 0;
    sumFY26 += fy26 || 0;
    sumFY27 += fy27 || 0;
    sumInvoiced += totalInvoiced || 0;
    sumRFY26 += rFy26 || 0;
    sumRFY27 += rFy27 || 0;
    sumReceipt += totalReceipt || 0;

    rows.push([
      i + 1, row.client, row.park,
      fmtCr(row.dcCapacity), fmtCr(row.bessCapacity), fmtCr(row.totalCost),
      fmtCr(fy26), fmtCr(fy27), fmtCr(totalInvoiced),
      invoiceStatusPct === null ? '' : invoiceStatusPct,
      fmtCr(rFy26), fmtCr(rFy27), fmtCr(totalReceipt),
      receiptStatusPct === null ? '' : receiptStatusPct,
      row.commissioningDate || '',
    ]);
  });

  const totalInvoiceStatus = sumTPC > 0 ? Number(((sumInvoiced / sumTPC) * 100).toFixed(1)) : '';
  const totalReceiptStatus = sumInvoiced > 0 ? Number(((sumReceipt / sumInvoiced) * 100).toFixed(1)) : '';
  rows.push([
    '', 'Total', '', fmtCr(sumDC), fmtCr(sumBESS), fmtCr(sumTPC),
    fmtCr(sumFY26), fmtCr(sumFY27), fmtCr(sumInvoiced), totalInvoiceStatus,
    fmtCr(sumRFY26), fmtCr(sumRFY27), fmtCr(sumReceipt), totalReceiptStatus, '',
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = autoColWidths(rows);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Order Book');
  XLSX.writeFile(wb, 'Order_Book.xlsx');
}
