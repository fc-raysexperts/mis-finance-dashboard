// Shared logic for the Order Book "Invoiced Amount" feature — the LE-code
// → Zoho project_id mapping (built together with Jatin via a live debug
// investigation, not guessed) and the per-project invoice/credit-note
// aggregation. `client` strings here MUST match investorData.js's
// epcRevenueRecognition `client` field exactly — that's the join key used
// at render time in Outlook.jsx.

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
  { client: 'Kothari', projectId: '2346113000015083223' },
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
// here so obInvoicedRefreshBatch.js's output makes the uncertainty visible
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

// For one project: Sum(Invoice sub_total) − Sum(Credit Note sub_total),
// bucketed by FY (from each transaction's own date), plus a true grand
// total across everything found — not just the FY columns added together,
// so it stays correct even if a project has billing outside FY26/FY27.
// Draft and void transactions are excluded — a draft invoice hasn't
// actually been issued to the client, so counting it would overstate real
// billing; void is obviously never real. Everything else (sent, overdue,
// paid, partially_paid, closed) counts.
const EXCLUDED_STATUSES = new Set(['draft', 'void', 'rejected']);

export async function computeInvoicedForProject(H, ORG, projectId) {
  const [invoicesRaw, creditnotesRaw] = await Promise.all([
    fetchAllPages(`https://www.zohoapis.in/books/v3/invoices?${ORG}&project_id=${projectId}`, H, 'invoices'),
    fetchAllPages(`https://www.zohoapis.in/books/v3/creditnotes?${ORG}&project_id=${projectId}`, H, 'creditnotes'),
  ]);
  const invoices = invoicesRaw.filter(i => !EXCLUDED_STATUSES.has(i.status));
  const creditnotes = creditnotesRaw.filter(c => !EXCLUDED_STATUSES.has(c.status));

  // Zoho returns sub_total in raw rupees. Total Project Cost — and every
  // other ₹ Cr figure already in this table — is stored in Crores, so
  // convert here, once, at the source, rather than leaving every consumer
  // of this cached data (Outlook.jsx now, anything else later) to
  // remember to do it themselves. 1 Crore = 1,00,00,000.
  const CR = 10000000;

  const byFY = {};
  let total = 0;

  const invDetails = await processBatched(invoices, 3, 1600, async (inv) => {
    const d = await fetchZohoJson(`https://www.zohoapis.in/books/v3/invoices/${inv.invoice_id}?${ORG}`, H);
    return { date: inv.date, sub_total: (d.invoice?.sub_total || 0) / CR };
  });
  for (const { date, sub_total } of invDetails) {
    const fy = fyLabelForDate(date) || 'other';
    byFY[fy] = (byFY[fy] || 0) + sub_total;
    total += sub_total;
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

  return {
    byFY, total,
    invoice_count: invoices.length, creditnote_count: creditnotes.length,
    excluded_draft_or_void: (invoicesRaw.length - invoices.length) + (creditnotesRaw.length - creditnotes.length),
    refreshed_at: new Date().toISOString(),
  };
}
