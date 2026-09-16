// Shared logic for the Order Book "Invoiced Amount" feature — the LE-code
// → Zoho project_id mapping (built together with Jatin via a live debug
// investigation, not guessed) and the per-project invoice/credit-note
// aggregation. investorData.js's epcRevenueRecognition rows each carry
// their own projectId directly (added after a client-rename broke the
// name-based lookup this used to rely on) — OB_PROJECT_MAP below now
// exists mainly for the cron/refresh endpoints (api/obInvoiced.js) to
// iterate over every project, and for readable client names in their
// diagnostic output. The CACHE itself is keyed by project_id, not by
// client name, so renaming a client in investorData.js never invalidates
// already-fetched Zoho data.

import { fetchZohoJson, processBatched, sleep } from './_npdShared.js';

export const OB_PROJECT_MAP = [
  { client: 'Saville Hospital and Research Centre', projectId: '2346113000014392237' },
  { client: 'Soni International Jewelry Pvt. Ltd.', projectId: '2346113000024545249' },
  { client: 'JECRC', projectId: '2346113000024545225' },
  { client: 'Alliance Poly sacks', projectId: '2346113000024545243' },
  { client: 'Siddharth Polysacks', projectId: '2346113000024545237' },
  { client: 'BKT Industries (Balkrishna Industries Ltd.)', projectId: '2346113000024617685' },
  { client: 'Shree Ananta Dream Homes Pvt. Ltd.', projectId: '2346113000025225320' },
  { client: 'Metallic Rolls', projectId: '2346113000025225326' },
  { client: 'Ravi Surya Spa', projectId: '2346113000025824143' },
  { client: 'JSW Green Energy Thirteen Ltd.', projectId: '2346113000026152074' },
  { client: 'JSW Green Energy Fifteen Ltd.', projectId: '2346113000026152068' },
  { client: 'Wonder Cement Ltd. — Phase 3', projectId: '2346113000033276071' },
  { client: 'RVUNL', projectId: '2346113000016091059' },
  { client: 'NTPC', projectId: '2346113000031888593' },
  { client: 'Miracle Coro Plast Pvt. Ltd.', projectId: '2346113000024830083' },
  { client: 'Powerforge Engineering Pvt. Ltd.', projectId: '2346113000033152023' },
  { client: 'GD Foods Manufacturing (India) Pvt. Ltd.', projectId: '2346113000033152035' },
  { client: 'Rahul Induction Pvt. Ltd.', projectId: '2346113000007926817' },
  { client: 'Udyog Mandir', projectId: '2346113000014589802' },
  { client: 'Ganpati Leasing Infrastructure Pvt. Ltd.', projectId: '2346113000034408935' },
  { client: 'Aram Textiles Pvt. Ltd.', projectId: '2346113000034408947' },
  { client: 'Ratan Engineering Company Pvt. Ltd.', projectId: '2346113000034408962' },
  { client: 'Rockwood Hotels & Resorts Ltd.', projectId: '2346113000000415152' },
  { client: 'Devbir Power Project Private Limited', projectId: '2346113000035981093' },
  { client: 'Premier Bars Ltd.', projectId: '2346113000035981136' },
  { client: 'Wonder Cement Ltd. — Phase 4', projectId: '2346113000035981197' },
  { client: 'Zetwerk Manufacturing Businesses Ltd.', projectId: '2346113000035981078' },
  { client: 'Uttam Strips', projectId: '2346113000008468113' },
  { client: 'ASK', projectId: '2346113000012388249' },
  { client: 'Mangalam', projectId: '2346113000014392229' },
  { client: 'MEC Bearings', projectId: '2346113000014425669' },
  { client: 'Kothari Welfare Institute', projectId: '2346113000015083223' },
  { client: 'Inox Air', projectId: '2346113000014589808' },
  { client: 'Kamdhenu Limited', projectId: '2346113000014787646' },
  { client: 'Lords Chloro Phase 2', projectId: '2346113000015083217' },
  { client: 'Wonder Cement Phase 2', projectId: '2346113000015444806' },
  { client: 'Raksha Bars', projectId: '2346113000024486636' },
  { client: 'Jagdamba', projectId: '2346113000024545231' },
];

// These two were matched by project/customer naming rather than the direct
// LE-code convention every other row used — NTPC via its NVVN counterparty
// on the Surpura BESPA, Rockwood via "New" in the project name vs. the
// separate "Extension" project for its older, unrelated engagement. Flagged
// here so the refresh endpoints' output makes the uncertainty visible
// instead of silently trusting a same-confidence match.
export const TENTATIVE_MATCHES = new Set(['NTPC', 'Rockwood Hotels & Resorts Ltd.']);

// Indian FY: April 1 – March 31. Matches structure.js's FY_CONFIG
// convention (FY26 = Apr 2025–Mar 2026, FY27 = Apr 2026–Mar 2027).
export function fyLabelForDate(dateStr) {
  if (!dateStr) return null;
  const [y, m] = dateStr.split('-').map(Number);
  if (!y || !m) return null;
  const fyEndYear = m >= 4 ? y + 1 : y;
  return `FY${String(fyEndYear).slice(2)}`;
}

// Returns 'YYYY-MM-DD' for exactly 6 calendar months before today.
export function sixMonthsAgoISO() {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().slice(0, 10);
}

async function fetchAllPages(baseUrl, H, listKey) {
  let all = [], page = 1;
  while (true) {
    const d = await fetchZohoJson(`${baseUrl}&page=${page}&per_page=200`, H);
    const batch = d[listKey] || [];
    all = all.concat(batch);
    if (!d.page_context?.has_more_page) break;
    page++;
    if (page > 10) break; // safety cap — no single project should realistically need this many pages
    await sleep(700);
  }
  return all;
}

// Draft and void transactions are excluded — a draft invoice hasn't
// actually been issued to the client, so counting it would overstate real
// billing; void is obviously never real; rejected the same. Everything
// else (sent, overdue, paid, partially_paid, closed) counts.
const EXCLUDED_STATUSES = new Set(['draft', 'void', 'rejected']);
const CR = 10000000; // 1 Crore = 1,00,00,000 — Zoho returns raw rupees, this table stores Cr

// The one real cost driver is the per-transaction DETAIL call (needed for
// sub_total, since list responses omit it) — the list fetch itself is
// cheap even for a project with dozens of invoices. So `sinceDate` filters
// AFTER the (cheap) list fetch and BEFORE the (expensive, rate-limited)
// detail calls: pass null for a project's full history (used by the
// monthly finalization run and single-project refresh), or a date string
// to only pay the detail-call cost for transactions on/after it (used by
// the daily batch cron, so old/settled billing is never re-fetched daily).
export async function computeInvoicedForProject(H, ORG, projectId, sinceDate = null) {
  const [invoicesRaw, creditnotesRaw] = await Promise.all([
    fetchAllPages(`https://www.zohoapis.in/books/v3/invoices?${ORG}&project_id=${projectId}`, H, 'invoices'),
    fetchAllPages(`https://www.zohoapis.in/books/v3/creditnotes?${ORG}&project_id=${projectId}`, H, 'creditnotes'),
  ]);
  let invoices = invoicesRaw.filter(i => !EXCLUDED_STATUSES.has(i.status));
  let creditnotes = creditnotesRaw.filter(c => !EXCLUDED_STATUSES.has(c.status));
  if (sinceDate) {
    invoices = invoices.filter(i => (i.date || '') >= sinceDate);
    creditnotes = creditnotes.filter(c => (c.date || '') >= sinceDate);
  }

  const byFY = {};
  let total = 0;
  // Receipt Amount — pre-tax sub_total of invoices Zoho itself has marked
  // "paid", nothing else. No credit-note offset here: that's a deliberate
  // difference from Invoiced Amount, since a credit note reduces what's
  // billed, not what's been physically received against a paid invoice.
  const paidByFY = {};
  let paidTotal = 0;

  const invDetails = await processBatched(invoices, 3, 1600, async (inv) => {
    const d = await fetchZohoJson(`https://www.zohoapis.in/books/v3/invoices/${inv.invoice_id}?${ORG}`, H);
    return { date: inv.date, status: inv.status, sub_total: (d.invoice?.sub_total || 0) / CR };
  });
  for (const { date, status, sub_total } of invDetails) {
    const fy = fyLabelForDate(date) || 'other';
    byFY[fy] = (byFY[fy] || 0) + sub_total;
    total += sub_total;
    if (status === 'paid') {
      paidByFY[fy] = (paidByFY[fy] || 0) + sub_total;
      paidTotal += sub_total;
    }
  }

  const cnDetails = await processBatched(creditnotes, 3, 1600, async (cn) => {
    const d = await fetchZohoJson(`https://www.zohoapis.in/books/v3/creditnotes/${cn.creditnote_id}?${ORG}`, H);
    return { date: cn.date, sub_total: (d.creditnote?.sub_total || 0) / CR };
  });
  for (const { date, sub_total } of cnDetails) {
    const fy = fyLabelForDate(date) || 'other';
    byFY[fy] = (byFY[fy] || 0) - sub_total;
    total -= sub_total;
  }

  for (const k of Object.keys(byFY)) byFY[k] = Math.round(byFY[k] * 100) / 100;
  total = Math.round(total * 100) / 100;
  for (const k of Object.keys(paidByFY)) paidByFY[k] = Math.round(paidByFY[k] * 100) / 100;
  paidTotal = Math.round(paidTotal * 100) / 100;

  return {
    byFY, total, paidByFY, paidTotal,
    invoice_count: invoices.length, creditnote_count: creditnotes.length,
    refreshed_at: new Date().toISOString(),
  };
}

// Merge a project's cached "stable" (everything up to the last monthly
// finalization) and "recent" (everything since then) portions into one
// figure. Both are optional — either may not have run yet.
export function mergeStableAndRecent(stable, recent) {
  if (!stable && !recent) return null;
  const byFY = {}, paidByFY = {};
  for (const src of [stable, recent]) {
    if (!src) continue;
    for (const [fy, v] of Object.entries(src.byFY || {})) byFY[fy] = Math.round(((byFY[fy] || 0) + v) * 100) / 100;
    for (const [fy, v] of Object.entries(src.paidByFY || {})) paidByFY[fy] = Math.round(((paidByFY[fy] || 0) + v) * 100) / 100;
  }
  const total = Math.round((((stable?.total) || 0) + ((recent?.total) || 0)) * 100) / 100;
  const paidTotal = Math.round((((stable?.paidTotal) || 0) + ((recent?.paidTotal) || 0)) * 100) / 100;
  return { byFY, total, paidByFY, paidTotal };
}
