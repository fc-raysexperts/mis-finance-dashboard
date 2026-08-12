import * as XLSX from 'xlsx';
import { fmt } from './utils.js';

const PARK_LIST = [
  'Jaisalmer', 'Kolayat', 'Dechu', 'Lunkaransar', 'Napasar', 'Panchu', 'Pugal',
  'Bhamatsar', 'Sanchore', 'Tosham', 'SS Nagar', 'Thukariyasar',
  'Baithwasiya', 'Jasarasar', 'Sheruna',
];
const CATEGORIES = [
  'Registration Fees', 'Commission', 'Land Lease Registration', 'Land Lease Expenses',
  'Legal & Professional Charges', 'Connectivity Charges', 'Purchase', 'Technical Service',
  'Land Levelling & Survey', 'Rent & Other', 'Retention & Deposits',
];

// Every summary-table park column is equal-width on screen — same here.
const SUMMARY_LABEL_WIDTH = 30; // fits the longest category name
const SUMMARY_PARK_WIDTH = 12;  // fits values like "22.38 Cr"

function buildHeadGroupingSheet(parks, sum) {
  const rows = [
    ['Head Grouping', ...PARK_LIST, 'Sum'],
    ['CWIP', ...PARK_LIST.map(p => fmt(parks[p]?.cwip_total || 0)), fmt(sum?.cwip_total || 0)],
    ['IAUD', ...PARK_LIST.map(p => fmt(parks[p]?.iaud_total || 0)), fmt(sum?.iaud_total || 0)],
    ['Total', ...PARK_LIST.map(p => fmt(parks[p]?.total || 0)), fmt(sum?.total || 0)],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: SUMMARY_LABEL_WIDTH }, ...PARK_LIST.map(() => ({ wch: SUMMARY_PARK_WIDTH })), { wch: SUMMARY_PARK_WIDTH }];
  return ws;
}

function buildCategorySheet(parks, sum) {
  const rows = [['Category', ...PARK_LIST, 'Sum']];
  for (const cat of CATEGORIES) {
    rows.push([cat, ...PARK_LIST.map(p => fmt(parks[p]?.category_totals?.[cat] || 0)), fmt(sum?.category_totals?.[cat] || 0)]);
  }
  if (sum?.category_totals?.['Unclassified'] > 0) {
    rows.push(['Unclassified', ...PARK_LIST.map(p => fmt(parks[p]?.category_totals?.['Unclassified'] || 0)), fmt(sum.category_totals['Unclassified'])]);
  }
  rows.push(['Total', ...PARK_LIST.map(p => fmt(parks[p]?.total || 0)), fmt(sum?.total || 0)]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: SUMMARY_LABEL_WIDTH }, ...PARK_LIST.map(() => ({ wch: SUMMARY_PARK_WIDTH })), { wch: SUMMARY_PARK_WIDTH }];
  return ws;
}

// Matches the on-screen Park Detail table's column proportions exactly
// (7/27/7/8/23/13/6/9 %), scaled to a 140-character-wide sheet for
// comfortable absolute widths rather than tiny percentage-scaled ones.
function buildParkDetailSheet(parkData) {
  const rows = [
    ['Date', 'Vendor', 'Type', 'Bill #', 'Account', 'Category', 'Head', 'Amount'],
    ...(parkData?.transactions || []).map(t => [
      t.date, t.vendor, t.transaction_type, t.bill_number,
      t.account_name || t.project_name || '—', t.category, t.head_grouping, t.amount,
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 10 }, // Date
    { wch: 38 }, // Vendor
    { wch: 10 }, // Type
    { wch: 11 }, // Bill #
    { wch: 32 }, // Account
    { wch: 18 }, // Category
    { wch: 8 },  // Head
    { wch: 13 }, // Amount
  ];
  return ws;
}

// NOTE on bold headers: the installed xlsx library (SheetJS Community
// Edition, the free version) does not support cell styling — bold, colors,
// borders, etc. — at all. This is a real limitation of the library itself,
// not something skipped here; true cell styling requires SheetJS Pro (a
// paid product). Headers are NOT bold in the output for this reason.
export async function downloadNPDExcel({ summary, periodQuery, periodLabel, onProgress }) {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, buildHeadGroupingSheet(summary.parks, summary.sum), 'Head Grouping');
  XLSX.utils.book_append_sheet(wb, buildCategorySheet(summary.parks, summary.sum), 'Category');

  for (let i = 0; i < PARK_LIST.length; i++) {
    const park = PARK_LIST[i];
    if (onProgress) onProgress(i + 1, PARK_LIST.length, park);
    const res = await fetch(`/api/npdParkTransactions?park=${encodeURIComponent(park)}&${periodQuery}`);
    const data = await res.json();
    // Excel sheet names can't exceed 31 chars or contain certain symbols —
    // all current park names are short enough, but guard anyway.
    const sheetName = park.slice(0, 31).replace(/[\\/*?:[\]]/g, '');
    XLSX.utils.book_append_sheet(wb, buildParkDetailSheet(data.error ? { transactions: [] } : data), sheetName);
  }

  const filename = `NPD_${periodLabel.replace(/[^a-zA-Z0-9]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}
