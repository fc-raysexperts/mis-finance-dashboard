// Manually-editable investor/outlook data — NOT available via Zoho Books API.
// Persisted to a shared backend (Vercel KV) so edits are visible on every
// device/browser, not just the one that made them. Seeded with figures from the
// Q1 FY27 Investor MIS PDF (Apr-Jun 2026) as the starting point.
// Use the Edit button in each section to update these over time.

import { getRemote, setRemote } from './remoteStore.js';

const REMOTE_KEY = 'investor_data_v2'; // v2: bumped so stale v1 shapes never leak in

const DEFAULTS = {
  collections: {
    invoicesRaised: 287,
    grossBilling: 240.16,     // Cr, incl. GST
    collectedPct: 92,
    collectedAmt: 220.51,     // Cr
    outstanding: 19.65,       // Cr
    outstandingPct: 8.2,
  },
  // The only 2 manually-set figures in the Live Order Book section — every
  // other cell there is computed live from epcRevenueRecognition. Sourced
  // from the Sept 2026 Order Book file's own "Target Revenue"/"Target
  // Orders" summary rows.
  orderBookTargets: {
    targetOrderBook: 1500,  // Cr
    targetRevenue: 1200,    // Cr
  },
  // top-level orderBook removed — Live Order Book KPIs are now computed live
  // from epcRevenueRecognition (see Outlook.jsx), not stored/edited here.
  // (inv.ukArin.orderBook below is unrelated — UK Arin Power tab, untouched.)
  // EPC Revenue Recognition — Order Book (Sept 2026, final per signed LOAs) is the
  // source of truth for client/park/cost; sort = old Order Book's row order for
  // carried-over clients, then Sept file's own order for newly-added clients.
  // Commissioning dates come from a separate tracker and are blank until a project
  // actually commissions and drops off this list.
  // EPC Revenue Recognition — Order Book (Sept 2026, final per signed LOAs) is the
  // source of truth for client/park/cost; sort = old Order Book's row order for
  // carried-over clients, then Sept file's own order for newly-added clients.
  // null = genuinely no value in the source (not a real 0) — rendered blank, not '0.00'.
  // Commissioning Date is blank for all 27: re-checked the ground-mount tracker (every
  // column, all 3 sheets) and none of these currently-pending clients have one there yet —
  // its dated rows are exactly the clients that already dropped off this Order Book.
  // EPC Revenue Recognition — the FULL FY27 project log, not just the currently-
  // pending Order Book: every client from the Sept 2026 Order Book (final data for
  // anything in it) PLUS every FY27 client from the old Order Book file that has since
  // been commissioned and dropped off Sept's list (old file's own data, since Sept
  // doesn't carry them). Sort = old file's chronological (Date of Agreement) order for
  // every client that appears there, then Sept's own order for Sept-only new signings.
  // null = genuinely no value in the source (not a real 0) — rendered blank, not '0.00'.
  // Commissioning Date is filled from the ground-mount ('LE Projects') tracker for the
  // 11 already-commissioned clients; blank for the 27 still-pending Sept clients, since
  // that tracker genuinely has no date yet for any of them (re-checked exhaustively).
  // EPC Revenue Recognition — full FY27 project log (see composition notes below).
  // RVUNL and NTPC pinned last per request. Rate columns (EPC/Modules/BESS Supply/
  // Install) removed from the table and from this data — Total Project Cost is kept
  // as the single cost figure per project. The Total row itself is NOT stored here;
  // it's computed at render time in Outlook.jsx from whatever rows exist, so it can
  // never go stale after an edit/add/remove.
  // null = genuinely no value in the source (not a real 0) — rendered blank, not '0.00'.
  // Commissioning Date is filled for the 11 already-commissioned clients (from the
  // ground-mount tracker); blank for the 27 still-pending Sept clients.
  epcRevenueRecognition: [
    { client: 'Uttam Strips Ltd.', projectId: '2346113000008468113', park: 'Lunkaransar', dcCapacity: 26.2, bessCapacity: 14.84, totalCost: 89.17, commissioningDate: '07-Jul-2026' },
    { client: 'ASK Automobiles Private Limited', projectId: '2346113000012388249', park: 'Kolayat', dcCapacity: 11.55, bessCapacity: 4.07, totalCost: 35.3, commissioningDate: '21-Aug-2026' },
    { client: 'Mangalam Spa Resorts', projectId: '2346113000014392229', park: 'Panchu', dcCapacity: 1.73, bessCapacity: null, totalCost: 5.17, commissioningDate: '06-Aug-2026' },
    { client: 'Saville Hospital and Research Centre', projectId: '2346113000014392237', park: 'Panchu', dcCapacity: 2.05, bessCapacity: 0.52, totalCost: 6.64, commissioningDate: '' },
    { client: 'MEC Bearings Pvt Ltd', projectId: '2346113000014425669', park: 'Panchu', dcCapacity: 1.0, bessCapacity: null, totalCost: 3.0, commissioningDate: '13-Aug-2026' },
    { client: 'Kothari Welfare Institute', projectId: '2346113000015083223', park: 'Kolayat', dcCapacity: 0.86, bessCapacity: null, totalCost: 2.61, commissioningDate: '13-Aug-2026' },
    { client: 'INOX AP Private Limited', projectId: '2346113000014589808', park: 'Dechu', dcCapacity: 12.0, bessCapacity: 11.29, totalCost: 28.16, commissioningDate: '25-Jul-2026' },
    { client: 'Kamdhenu Ltd.', projectId: '2346113000014787646', park: 'Dechu', dcCapacity: 5.0, bessCapacity: null, totalCost: 14.55, commissioningDate: '02-Jun-2026' },
    { client: 'Lords Chloro Alkali Ltd. - Phase 2', projectId: '2346113000015083217', park: 'Lunkaransar', dcCapacity: 21.0, bessCapacity: 1.45, totalCost: 29.4, commissioningDate: '02-Aug-2026' },
    { client: 'Wonder Cement Ltd. - Phase 2', projectId: '2346113000015444806', park: 'Dechu', dcCapacity: 39.6, bessCapacity: 2.93, totalCost: 113.76, commissioningDate: '29-Jul-2026' },
    { client: 'Soni International Jewelry Pvt. Ltd.', projectId: '2346113000024545249', park: 'Lunkaransar', dcCapacity: 1.37, bessCapacity: 0.64, totalCost: 4.65, commissioningDate: '' },
    { client: 'Raksha Bars Private Limited', projectId: '2346113000024486636', park: 'Dechu', dcCapacity: 7.35, bessCapacity: null, totalCost: 21.39, commissioningDate: '04-Jun-2026' },
    { client: 'JECRC University', projectId: '2346113000024545225', park: 'Dechu', dcCapacity: 7.35, bessCapacity: null, totalCost: 21.98, commissioningDate: '' },
    { client: 'Jagdamba TMT Mills Ltd.', projectId: '2346113000024545231', park: 'Dechu', dcCapacity: 0.81, bessCapacity: null, totalCost: 2.35, commissioningDate: '02-Jul-2026' },
    { client: 'Alliance Polysacks Pvt. Ltd.', projectId: '2346113000024545243', park: 'Dechu', dcCapacity: 3.2, bessCapacity: null, totalCost: 10.2, commissioningDate: '' },
    { client: 'Sidharth Polysacks Pvt. Ltd.', projectId: '2346113000024545237', park: 'Dechu', dcCapacity: 1.25, bessCapacity: null, totalCost: 3.99, commissioningDate: '' },
    { client: 'BKT Industries (Balkrishna Industries Ltd.)', projectId: '2346113000024617685', park: 'Dechu', dcCapacity: 16.0, bessCapacity: 3.34, totalCost: 49.9, commissioningDate: '' },
    { client: 'Shree Ananta Dream Homes Pvt. Ltd.', projectId: '2346113000025225320', park: 'Panchu', dcCapacity: 0.3, bessCapacity: null, totalCost: 0.9, commissioningDate: '' },
    { client: 'Metallic Rolls', projectId: '2346113000025225326', park: 'Bhamatsar', dcCapacity: 0.52, bessCapacity: null, totalCost: 1.53, commissioningDate: '' },
    { client: 'Ravi Surya Developers Pvt. Ltd.', projectId: '2346113000025824143', park: 'Lunkaransar', dcCapacity: 2.08, bessCapacity: null, totalCost: 6.14, commissioningDate: '' },
    { client: 'JSW Green Energy Thirteen Ltd.', projectId: '2346113000026152074', park: 'Pugal', dcCapacity: 29.0, bessCapacity: null, totalCost: 41.72, commissioningDate: '' },
    { client: 'JSW Green Energy Fifteen Ltd.', projectId: '2346113000026152068', park: 'Pugal', dcCapacity: 43.5, bessCapacity: null, totalCost: 62.57, commissioningDate: '' },
    { client: 'Wonder Cement Ltd. — Phase 3', projectId: '2346113000033276071', park: 'SS Nagar Park', dcCapacity: 75.0, bessCapacity: 5.0, totalCost: 257.88, commissioningDate: '' },
    { client: 'Miracle Coro Plast Pvt. Ltd.', projectId: '2346113000024830083', park: 'Dechu', dcCapacity: 6.0, bessCapacity: 1.67, totalCost: 18.01, commissioningDate: '' },
    { client: 'Powerforge Engineering Pvt. Ltd.', projectId: '2346113000033152023', park: 'Dechu', dcCapacity: 2.5, bessCapacity: null, totalCost: 7.5, commissioningDate: '' },
    { client: 'GD Foods Manufacturing (India) Pvt. Ltd.', projectId: '2346113000033152035', park: 'Dechu', dcCapacity: 1.52, bessCapacity: null, totalCost: 4.56, commissioningDate: '' },
    { client: 'Rahul Induction Pvt. Ltd.', projectId: '2346113000007926817', park: 'Panchu', dcCapacity: 0.7, bessCapacity: null, totalCost: 2.18, commissioningDate: '' },
    { client: 'Udyog Mandir', projectId: '2346113000014589802', park: 'Panchu', dcCapacity: 1.0, bessCapacity: null, totalCost: 3.06, commissioningDate: '' },
    { client: 'Ganpati Leasing Infrastructure Pvt. Ltd.', projectId: '2346113000034408935', park: 'Bhamatsar', dcCapacity: 1.11, bessCapacity: null, totalCost: 3.44, commissioningDate: '' },
    { client: 'Aram Textiles Pvt. Ltd.', projectId: '2346113000034408947', park: 'Bhamatsar', dcCapacity: 4.67, bessCapacity: 2.39, totalCost: 17.35, commissioningDate: '' },
    { client: 'Ratan Engineering Company Pvt. Ltd.', projectId: '2346113000034408962', park: 'Bhamatsar', dcCapacity: 0.8, bessCapacity: null, totalCost: 2.48, commissioningDate: '' },
    { client: 'Rockwood Hotels & Resorts Ltd.', projectId: '2346113000000415152', park: 'Gajner', dcCapacity: 0.75, bessCapacity: null, totalCost: 2.29, commissioningDate: '' },
    { client: 'Devbir Power Project Private Limited', projectId: '2346113000035981093', park: 'Kolayat', dcCapacity: 6.18, bessCapacity: null, totalCost: 16.81, commissioningDate: '' },
    { client: 'Premier Bars Ltd.', projectId: '2346113000035981136', park: 'Bhamatsar', dcCapacity: 4.5, bessCapacity: null, totalCost: 15.75, commissioningDate: '' },
    { client: 'Wonder Cement Ltd. — Phase 4', projectId: '2346113000035981197', park: 'Jasrasar', dcCapacity: 30.0, bessCapacity: 2.09, totalCost: 81.41, commissioningDate: '' },
    { client: 'Zetwerk Manufacturing Businesses Ltd.', projectId: '2346113000035981078', park: 'Kolayat', dcCapacity: 26.0, bessCapacity: 2.0, totalCost: 37.3, commissioningDate: '' },
    { client: 'RVUNL', projectId: '2346113000016091059', park: 'Heerapura', dcCapacity: null, bessCapacity: 150.0, totalCost: 58.0, commissioningDate: '' },
    { client: 'NTPC', projectId: '2346113000031888593', park: 'Surpura', dcCapacity: null, bessCapacity: 100.0, totalCost: 43.0, commissioningDate: '' },
  ],
  guidance: {
    epcTargetLabel: '₹800–1,000 Cr',
    epcTargetMid: 900,     // Cr, used to compute % progress
    patTarget: 120,        // Cr
  },
  revenueEngines: [
    { title: 'Transformer Mfg.',    value: '~₹27.5 Cr', detail: '500 MW line · RPE Technologies' },
    { title: 'Battery (BESS) Mfg.', value: '~₹65 Cr',   detail: '3 GWh line · from Q3 FY27' },
    { title: 'Arin Power (UK)',     value: '₹69.56 Cr E', detail: '£6.05M · ₹179 Cr order book' },
    { title: 'Govt BESS Execution', value: '₹311 Cr',   detail: 'RVUNL + NTPC orders' },
  ],
  balanceSheet: {
    shareholdersFunds: 200.35,
    cash: 21.97,
    gearing: '0.14x',
    rating: 'BBB / Stable',
  },
  notes: [
    'Compiled from Zoho Books, RPEL standalone; revenue net of GST; unaudited and subject to audit.',
    'D&A is accounted annually; EBITDA and PBT are shown before the annual D&A charge where applicable.',
    'Certain heads may be net of provision reversals.',
    'Figures for the current month are excluded pending month-end close.',
  ],
};

// Deep-merge saved data onto DEFAULTS so newly-added fields are never
// silently lost/blank when older saved data is loaded (this was the bug
// that made new default fields disappear — a shallow merge let a stale
// saved sub-object fully replace a freshly-updated default sub-object).
function deepMerge(base, override) {
  if (Array.isArray(base)) return Array.isArray(override) ? override : base;
  if (base && typeof base === 'object' && override && typeof override === 'object') {
    const out = { ...base };
    for (const k of Object.keys(override)) {
      out[k] = k in base ? deepMerge(base[k], override[k]) : override[k];
    }
    return out;
  }
  return override !== undefined ? override : base;
}

export async function loadInvestorData() {
  const saved = await getRemote(REMOTE_KEY, null);
  if (!saved) return structuredClone(DEFAULTS);
  const merged = deepMerge(structuredClone(DEFAULTS), saved);
  // keyRatios has no edit UI anywhere in the app — it must always reflect
  // the latest code, never a stale value some other tab's Save happened
  // to carry along in its shared blob.
  merged.keyRatios = structuredClone(DEFAULTS.keyRatios);
  return merged;
}

export async function saveInvestorData(data) {
  return setRemote(REMOTE_KEY, data);
}

export { DEFAULTS };

// ── Additional sections from FY27 Strategic Outlook PPT ──────────────────────
const STRATEGIC_DEFAULTS = {
  companyGlance: {
    revenue: 404.02, revenueYoY: '3.0x', revenuePrior: 133.51,
    pbt: 79.33, pbtYoY: '2.19x', pbtPrior: 36.17,
    pbtMargin: 19.6, pbtMarginPrior: 27.1,
    ebitda: 82.55, ebitdaMargin: 20.4, ebitdaMarginPrior: 29.1,
    shareholdersFunds: 200.35, shareholdersFundsYoY: '2.2x', shareholdersFundsPrior: 75.05,
    cash: 21.97, cashYoY: '27x', cashPrior: 0.81,
    gearing: '0.14x',
  },
  trajectory: {
    years: ['FY24', 'FY25', 'FY26', 'FY27E'],
    revenue: [44.3, 133.5, 404, 800],
    pbt: [2.8, 36.2, 79.3, 156.8],
  },
  epcQuarterly: {
    quarters: ['Q1 FY27', 'Q2 FY27', 'Q3 FY27', 'Q4 FY27E'],
    revenue: [191, 242, 278, 311],
  },
  groupStructure: [
    { name: 'Rays Power Experts Ltd.', role: 'Core EPC Business' },
    { name: 'Rays O&M Experts & RPE Energy Reserve', role: 'O&M + Energy Storage (BESS)' },
    { name: 'RPE Technologies Pvt Ltd', role: 'Transformer + Battery Mfg.' },
    { name: 'Rays Experts Foundation', role: 'CSR / Non-profit' },
  ],
  solarParks: {
    active: [
      { park: 'Dechu',       land: 315.0, dc: '105.0 MWp', projects: 8, orderValue: 238.13 },
      { park: 'Pugal',       land: 225.0, dc: '75.0 MWp',  projects: 1, orderValue: 203.73 },
      { park: 'SS Nagar',    land: 118.9, dc: '75.0 MWp',  projects: 1, orderValue: 210.75 },
      { park: 'Lunkaransar', land: 156.3, dc: '75.0 MWp',  projects: 3, orderValue: 40.20 },
      { park: 'Kolayat',     land: 260.0, dc: '150.0 MWp', projects: 1, orderValue: 1.36 },
      { park: 'Panchu',      land: 73.6,  dc: '105.0 MWp', projects: 3, orderValue: 14.82 },
      { park: 'Bhamatsar',   land: 75.0,  dc: '45.0 MWp',  projects: 2, orderValue: 2.43 },
    ],
    upcoming: [
      { park: 'Baithwasia',   location: 'Jodhpur, Raj.', land: 169.0, dc: '225.0 MWp', potential: 675.0 },
      { park: 'Sheruna',      location: 'Bikaner, Raj.', land: 51.0,  dc: '150.0 MWp', potential: 450.0 },
      { park: 'Jaisalmer-2',  location: 'Jaisalmer, Raj.', land: 140.0, dc: '133.5 MWp', potential: 400.5 },
      { park: 'Sanchore',     location: 'Jalore, Raj.',  land: 119.1, dc: '105.0 MWp', potential: 315.0 },
      { park: 'Sayla',        location: 'Jalore, Raj.',  land: 106.7, dc: '105.0 MWp', potential: 315.0 },
      { park: 'Tosham',       location: 'Haryana',       land: 179.8, dc: '75.0 MWp',  potential: 225.0 },
      { park: 'Jasrasar',     location: 'Bikaner, Raj.', land: 106.0, dc: '75.0 MWp',  potential: 225.0 },
      { park: 'Thukriyasar',  location: 'Bikaner, Raj.', land: 45.0,  dc: '45.0 MWp',  potential: 135.0 },
      { park: 'Napasar',      location: 'Bikaner, Raj.', land: 193.3, dc: '37.5 MWp',  potential: 112.5 },
    ],
  },
  manufacturing: {
    transformer: { capex: 15, capacity: '500 MW', revenue: 50, ebitdaMargin: 25, ebitda: 12 },
    battery: { capex: 82, capacity: '3 GWh', revenue: 800, ebitdaLow: 70, ebitdaHigh: 80, marginLow: 5, marginHigh: 7 },
    combinedNote: 'From FY28 onwards, both Transformer and BESS manufacturing will contribute around ₹100 Cr of profitability to the business.',
    bessProducts: [
      { product: '261 kWh', segment: 'C&I / Microgrid', marketSize: '~3–5 GWh by 2028',  priceRange: '11,000–13,500', margin: '22–27%' },
      { product: '481 kWh', segment: 'C&I / Utility Edge', marketSize: '~8–12 GWh by 2028', priceRange: '10,800–12,900', margin: '24–28%' },
      { product: '5 MWh',   segment: 'Utility / IPP', marketSize: '~35 GWh by 2030', priceRange: '8,400–10,400', margin: '23–27%' },
    ],
    bessWhyWins: [
      { icon: '🛡️', text: 'ALMM Policy Tailwind' },
      { icon: '💸', text: 'PLI Scheme Eligibility' },
      { icon: '📊', text: 'CEA: 51 GWh Demand by 2027' },
      { icon: '🔒', text: '₹395 Cr Captive Orders Locked' },
    ],
    bessProjection: {
      years: ['FY27*', 'FY28', 'FY29', 'FY30', 'FY31'],
      revenue: [65, 145, 250, 360, 490],
      capacityMWh: [100, 220, 370, 570, 770],
    },
    bessPhase1: { capex: 82, irr: 22, payback: 4, year5Revenue: 450 },
  },
  ukArin: {
    financials: {
      years: ['FY23', 'FY24', 'FY25', 'FY26', 'FY27', 'FY28'],
      turnoverCr: [4.93, 15.44, 27.26, 34.31, 69.56, 83.48],
      grossProfitCr: [2.17, 6.82, 9.72, 10.72, 24.35, 29.22],
    },
    orderBook: {
      totalCr: 179.02, totalOrders: 54, totalGBP: 15.57,
      tiers: [
        { tier: 'P75',  cr: 92.78, orders: 25, gbp: 8.07 },
        { tier: 'P90',  cr: 61.34, orders: 22, gbp: 5.33 },
        { tier: 'P100', cr: 24.89, orders: 7,  gbp: 2.16 },
      ],
    },
  },
};

Object.assign(DEFAULTS, STRATEGIC_DEFAULTS);

// ── Key Financial Ratios — only the positive/strong-assessment ratios ───────
// Source: KEY_FINANCIAL_RATIOS.xlsx. Rows with a below-benchmark or merely
// "adequate/normal/elevated" assessment are intentionally excluded — this
// table is for the investor-facing strengths only.
DEFAULTS.keyRatios = [
  { ratio: 'Revenue (₹ Cr)',              fy24: '44.3',  fy25: '133.5',  fy26: '404',   benchmark: '—',              assessment: 'Strong Growth' },
  { ratio: 'EBITDA (₹ Cr)',               fy24: '5.40',  fy25: '38.86',  fy26: '82.55', benchmark: '—',              assessment: 'Strong' },
  { ratio: 'ROCE (%)',                    fy24: '—',     fy25: '65.2%*', fy26: '~56%',  benchmark: '>20%',           assessment: 'Strong' },
  { ratio: 'ROE (% avg NW)',              fy24: '—',     fy25: '49.3%',  fy26: '61.5%', benchmark: '>15%',           assessment: 'Strong' },
  { ratio: 'Net Cash Accruals (₹ Cr)',    fy24: '4',     fy25: '27.9',   fy26: '80.4',  benchmark: '>37 Cr (upgrade)', assessment: 'Healthy' },
  { ratio: 'Interest Coverage (x)',       fy24: '19.7',  fy25: '57.9',   fy26: '40.7',  benchmark: '>5.0x',          assessment: 'Very Strong' },
  { ratio: 'DSCR, approx. (x)',           fy24: '—',     fy25: '53.9*',  fy26: '~38',   benchmark: '>1.2x',          assessment: 'Very Strong' },
  { ratio: 'Total Debt / EBITDA (x)',     fy24: '<0.1',  fy25: '0.17',   fy26: '0.31',  benchmark: '<3.0x',          assessment: 'Excellent' },
  { ratio: 'Gearing, Debt/NW (x)',        fy24: '<0.1',  fy25: '0.09',   fy26: '0.14',  benchmark: '<1.0x',          assessment: 'Very Healthy' },
  { ratio: 'Debtor Days',                 fy24: '112',   fy25: '112',    fy26: '67',    benchmark: '<90 days',       assessment: 'Improved' },
  { ratio: 'Inventory Days',              fy24: '10',    fy25: '12',     fy26: '16',    benchmark: '<30 days',       assessment: 'Good' },
  { ratio: 'Net Working Capital Days',    fy24: '—',     fy25: '~360',   fy26: '~76',   benchmark: '<90 days',       assessment: 'Improved' },
];
