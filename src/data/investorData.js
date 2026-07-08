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
  orderBook: {
    total: 1022,              // Cr, EPC + Govt BESS combined
    activeEPC: 711,
    activeEPCDetail: '19 projects · 259 MWp · 7 parks',
    govtBESS: 311,
    govtBESSDetail: 'RVUNL ₹183 Cr + NTPC ₹128 Cr',
    orderToFY26Rev: '2.5x',
    orderToFY26RevDetail: 'Order Book / FY26 Revenue',
  },
  scheduledRevenue: [
    { client: 'Wonder Cement Ph.2', park: 'Dechu',       capacity: '39.6 MWp', cr: 113.76, quarter: 'Q2 FY27' },
    { client: 'BKT Industries',     park: 'Dechu',       capacity: '16.0 MWp', cr: 49.90,  quarter: 'Q2 FY27' },
    { client: 'Lords Chloro Ph.2',  park: 'Lunkaransar', capacity: '21.0 MWp', cr: 29.40,  quarter: 'Q2 FY27' },
    { client: 'JECRC',              park: 'Dechu',       capacity: '7.35 MWp', cr: 21.98,  quarter: 'Q2 FY27' },
    { client: 'Raksha Bars',        park: 'Dechu',       capacity: '7.35 MWp', cr: 21.39,  quarter: 'Q2 FY27' },
    { client: 'Wonder Cement Ph.3', park: 'SS Nagar',    capacity: '75.0 MWp', cr: 210.75, quarter: 'Q3 FY27' },
    { client: 'JSW Energy',         park: 'Pugal',       capacity: '72.5 MWp', cr: 203.73, quarter: 'Q3 FY27' },
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
