// Challenges (micro = inside RPEL, macro = industry-wide) and the Mitigants that answer them.
//
// How this data is organised:
//   * The DEFAULTS below are the starting content (written 2 Nov 2026). Macro items carry
//     dated, linked public sources. Micro items carry LIVE indicators that are worked out
//     from the dashboard's own data (see buildIndicators) - they are never typed in.
//   * People can edit any text, add rows or hide rows from the tabs. Only those CHANGES are
//     saved (key 'challenges_v1' in the shared store), never a full copy. So when the defaults
//     are refreshed later, every untouched row picks up the new text automatically, and
//     edited fields stay as edited.
//   * Mitigants point at challenges by id (challengeIds), so both tabs stay linked.

import { getRemote } from './remoteStore.js';

const REMOTE_KEY = 'challenges_v1';

export const AS_OF = '2 Nov 2026';
export const SEVERITIES = ['High', 'Medium', 'Low'];
export const STATUSES = ['In place', 'In progress', 'Planned'];
export const BASES = ['Company data', 'Proposed - to confirm'];

// ── Macro challenges: industry-specific, tied to current industry trends ──────────
const MACRO = [
  {
    id: 'MA1', title: 'Module overcapacity and margin squeeze', theme: 'Pricing & capacity', severity: 'High',
    what: 'Module capacity is about 109 GW and heading past 165 GW by March 2027, against 45-50 GW of yearly additions. ICRA expects margin pressure and consolidation among smaller makers. Waaree\'s EBITDA margin fell to 18.15% in Q1 FY27 from 22.53% a year earlier.',
    impact: 'Supplier consolidation can raise delivery and warranty risk on module purchases, and listed-peer valuations have reset.',
    sources: [
      { label: 'ICRA via Business Standard', url: 'https://www.business-standard.com/industry/news/solar-manufacturing-overcapacity-impact-icra-profitability-125110601394_1.html', date: '6 Nov 2025' },
      { label: 'Upstox', url: 'https://upstox.com/news/market-news/stocks/waaree-energies-share-price-drops-over-6-despite-q1-earnings-growth-here-s-what-investors-should-know/article-197814/', date: '30 Jul 2026' },
    ],
  },
  {
    id: 'MA2', title: 'Domestic-cell rule (ALMM List-II) from June 2026', theme: 'Policy', severity: 'High',
    what: 'Cell output is projected at 29 GW in 2027 against about 50 GW of yearly module demand. Wood Mackenzie expects utility system prices to rise 20% by Q4 2026. Waivers for net-metering and open-access projects run only to 31 Dec 2026.',
    impact: 'Projects commissioned after the waiver ends must use domestic-cell modules, which cost more and are harder to source.',
    sources: [
      { label: 'Wood Mackenzie', url: 'https://www.woodmac.com/es/press-releases/india-on-track-for-record-50-gw-solar-year-as-almm-ii-mandate-reshapes-domestic-supply-chain/', date: '13 Aug 2026' },
    ],
  },
  {
    id: 'MA3', title: 'US duties and export modules turning to the home market', theme: 'Pricing & capacity', severity: 'Medium',
    what: 'The US announced preliminary duties of nearly 126% on Indian solar on 24 Feb 2026. India\'s solar exports to the US were $792.6 million in 2024. ICRA notes that US tariffs push modules into the domestic market.',
    impact: 'More supply at home adds to price pressure and weakens some suppliers. Our direct exposure is low because our EPC work is in India.',
    sources: [
      { label: 'Business Today', url: 'https://www.businesstoday.in/markets/stocks/story/no-impact-emmvee-photovoltaic-clarifies-on-us-import-duty-move-stock-slips-517913-2026-02-25', date: '25 Feb 2026' },
      { label: 'ICRA via Business Standard', url: 'https://www.business-standard.com/industry/news/solar-manufacturing-overcapacity-impact-icra-profitability-125110601394_1.html', date: '6 Nov 2025' },
    ],
  },
  {
    id: 'MA4', title: 'Unsigned PPAs and stranded capacity', theme: 'Grid & payers', severity: 'High',
    what: 'About 45 GW of grid connectivity (31.8 GW granted, 13.5 GW applied) is unused because PPAs or PSAs are unsigned; Rajasthan has the most at 18.75 GW. Separately, about 43 GW of auctioned capacity lacks signed power sale agreements.',
    impact: 'Utility-scale and developer demand slows, and developer clients may delay payments. Work that rests on signed contracts holds up better.',
    sources: [
      { label: 'Down To Earth (CERC staff paper)', url: 'https://www.downtoearth.org.in/amp/story/energy/indias-renewable-energy-sector-grapples-with-massive-ppa-signing-delays', date: '25 Dec 2025' },
      { label: 'PV Tech', url: 'https://www.pv-tech.org/why-discom-health-holds-the-key-to-indias-solar-future/', date: '13 Apr 2026' },
    ],
  },
  {
    id: 'MA5', title: 'Grid congestion and curtailment in Rajasthan', theme: 'Grid & payers', severity: 'High',
    what: 'About 11.5 GW of solar and wind output was curtailed in Rajasthan from January to April 2026, with 8.3 GW in March alone. Developers have asked the state government to step in.',
    impact: 'Our parks and clients are in Rajasthan, so evacuation delays and curtailment can slow commissioning and reduce client generation.',
    sources: [
      { label: 'Mercom India', url: 'https://www.mercomindia.com/rajasthan-sees-nearly-12-gw-of-solar-wind-curtailment-since-january', date: '23 Apr 2026' },
    ],
  },
  {
    id: 'MA6', title: 'Discom finances and payment delays', theme: 'Grid & payers', severity: 'Medium',
    what: 'Discoms carry accumulated losses of INR 7.08 trillion and often pay six months or more late. Counterparty risk adds an estimated 100-107 bps to solar debt costs. Several states, including Rajasthan, have moved to renegotiate older PPAs.',
    impact: 'Receivable and renegotiation risk on state and government-linked counterparties, which matters for our public-sector BESS orders.',
    sources: [
      { label: 'PV Tech', url: 'https://www.pv-tech.org/why-discom-health-holds-the-key-to-indias-solar-future/', date: '13 Apr 2026' },
    ],
  },
  {
    id: 'MA7', title: 'Battery storage (BESS) tariffs and execution risk', theme: 'Storage', severity: 'Medium',
    what: 'The lowest 2-hour standalone BESS tariff of INR 1.48 lakh/MW/month compares with a benchmark of INR 2.3 lakh. IEEFA puts nearly 75% of allocated 2-hour capacity in a risky category and expects delays of up to 18 months. Only about 1.8 GWh of grid-scale storage was installed by March 2026, against 90.7 GW tendered.',
    impact: 'Our BESS manufacturing and government BESS execution depend on viable pricing and on-time financial closure by developers.',
    sources: [
      { label: 'IEEFA', url: 'https://ieefa.org/articles/indias-energy-storage-push-gathers-momentum-tariff-viability-and-financing-hurdles-loom', date: '19 May 2026' },
    ],
  },
  {
    id: 'MA8', title: 'Equity-market sentiment and listed-peer valuations', theme: 'Markets', severity: 'Medium',
    what: 'Waaree Energies (INR 2,300) and Emmvee Photovoltaic (INR 241) are each about 35% below their 52-week highs. On 28 Sep 2026 Adani Green, Inox Wind and Sterling & Wilson fell 3.5-4.2% as the Sensex and Nifty dropped 1.52%.',
    impact: 'Peer valuations are the reference point for any capital-raising or valuation discussion, so pricing has to rest on our own margins and cash.',
    sources: [
      { label: 'Anand Rathi - Waaree', url: 'https://anandrathi.com/stocks/waaree-energies-ltd/share-price-today', date: '2 Nov 2026' },
      { label: 'Anand Rathi - Emmvee', url: 'https://anandrathi.com/stocks/emmvee-photovoltaic-power-ltd/share-price-today', date: '27 Oct 2026' },
      { label: 'SolarQuarter', url: 'https://solarquarter.com/2026/09/28/green-energy-stocks-fall-sharply-as-sensex-and-nifty-decline-1-52-on-september-28/', date: '28 Sep 2026' },
    ],
  },
  {
    id: 'MA9', title: 'Dependence on imported wafers and cells', theme: 'Supply chain', severity: 'Medium',
    what: 'India imported 5 GW of wafers and 20 GW of cells in the first five months of 2026, with sourcing shifting to Southeast Asia (Indonesian cell imports nearly tripled). ICRA flags reliance on China for wafers and ingots as a key risk.',
    impact: 'The price and availability of compliant modules can swing with trade rules and geopolitics.',
    sources: [
      { label: 'Wood Mackenzie', url: 'https://www.woodmac.com/es/press-releases/india-on-track-for-record-50-gw-solar-year-as-almm-ii-mandate-reshapes-domestic-supply-chain/', date: '13 Aug 2026' },
      { label: 'ICRA via Business Standard', url: 'https://www.business-standard.com/industry/news/solar-manufacturing-overcapacity-impact-icra-profitability-125110601394_1.html', date: '6 Nov 2025' },
    ],
  },
];

// ── Micro challenges: specific to RPEL; their indicators are computed live ────────
const MICRO = [
  {
    id: 'MI1', title: 'Collections and working capital', theme: 'Cash', severity: 'Medium',
    what: 'Revenue only helps if it is collected. Debtor days improved sharply in FY26, and the aim is to hold that as billing grows.',
    impact: 'A slow-paying client on a large project ties up cash that is needed for the next project.',
  },
  {
    id: 'MI2', title: 'Margin as revenue scales', theme: 'Profitability', severity: 'High',
    what: 'Revenue tripled in FY26 but margins eased from the FY25 level. The market has punished margin loss in listed peers more than it has rewarded growth.',
    impact: 'Growth that dilutes margin lowers profit per rupee of revenue and weakens any valuation case.',
  },
  {
    id: 'MI3', title: 'Client and order concentration', theme: 'Order book', severity: 'High',
    what: 'A large share of the order book sits with one client group across several phases, and public-sector BESS orders form a separate block.',
    impact: 'A delay or dispute with one anchor client moves revenue and cash for the whole year.',
  },
  {
    id: 'MI4', title: 'Execution backlog to commission', theme: 'Execution', severity: 'High',
    what: 'Most projects in the order book are signed but not yet commissioned. Revenue and final collections follow commissioning.',
    impact: 'Slippage in commissioning pushes revenue into later quarters and holds back milestone payments.',
  },
  {
    id: 'MI5', title: 'Delivery against FY27 targets', theme: 'Execution', severity: 'Medium',
    what: 'The FY27 guidance is a revenue mid-point and a PBT target. Progress is tracked from the live P&L figures (reported up to the previous month).',
    impact: 'A shortfall late in the year is hard to recover, so the run-rate needs watching every month.',
  },
  {
    id: 'MI6', title: 'Park and geographic concentration', theme: 'Order book', severity: 'Medium',
    what: 'Order value is concentrated in a few solar parks, and most planned parks are in Rajasthan.',
    impact: 'Grid, curtailment or land issues in one area affect a large part of the business at once.',
  },
  {
    id: 'MI7', title: 'Ramp-up of new manufacturing lines', theme: 'New business', severity: 'Medium',
    what: 'Transformer and BESS manufacturing are new businesses that need capital and time before they earn. BESS revenue is planned to start from Q3 FY27.',
    impact: 'A late ramp-up leaves capital idle and delays the profit contribution planned from FY28.',
  },
  {
    id: 'MI8', title: 'Capital tied up in park development', theme: 'Cash', severity: 'Medium',
    what: 'Land and infrastructure for solar parks are paid for before the revenue from selling projects in them arrives. Park-wise spend is tracked in the New Park Development tab.',
    impact: 'Spending ahead of sales strains cash if project sales or approvals slip.',
  },
];

// ── Mitigants: what answers each challenge and how it is being carried out ───────
// basis 'Company data' = backed by figures in this dashboard. 'Proposed - to confirm' =
// a sensible action drafted for management to confirm, change or replace.
const MITIGANTS = [
  {
    id: 'MT1', challengeIds: ['MI1', 'MA6'], basis: 'Company data',
    mitigant: 'Tight collections discipline with invoices tracked against receipts project by project',
    how: 'The Order Book & Outlook tab shows invoiced and received amounts for every project, so outstanding balances can be reviewed project by project each month.',
    evidence: 'Debtor days fell from 112 (FY25) to 67 (FY26); working-capital days from about 360 to about 76; 92% of Q1 FY27 billing collected.',
    owner: 'Finance Control', timeline: 'Monthly', status: 'In place',
  },
  {
    id: 'MT2', challengeIds: ['MI2', 'MA1'], basis: 'Proposed - to confirm',
    mitigant: 'Margin check at order acceptance and a monthly margin review by project',
    how: 'Set a minimum margin for new orders, track margin per project against the order price, and escalate any project that falls below it.',
    evidence: 'EBITDA margin was 20.4% in FY26 against 29.1% in FY25; the live FY27 margin is shown on the Challenges tab.',
    owner: 'Management / Finance Control', timeline: 'From next order cycle', status: 'Planned',
  },
  {
    id: 'MT3', challengeIds: ['MI3'], basis: 'Company data',
    mitigant: 'Widen the client base so no single group dominates the order book',
    how: 'Keep winning orders from industrial and institutional clients; review the top-client share every quarter and agree a ceiling.',
    evidence: 'The order book already spans many clients (for example JSW Green Energy, BKT, Zetwerk, Uttam Strips); the live top-client share is on the Challenges tab.',
    owner: 'Business Development', timeline: 'Quarterly review', status: 'In progress',
  },
  {
    id: 'MT4', challengeIds: ['MI4', 'MA5'], basis: 'Company data',
    mitigant: 'Dated commissioning plan for every pending project, reviewed weekly',
    how: 'Add a target commissioning date for each pending project in the Order Book table, then review slippage and blockers (material, approvals, evacuation) every week.',
    evidence: '11 projects were commissioned between 2 Jun and 21 Aug 2026; target dates are still blank for the pending ones.',
    owner: 'Projects / Execution', timeline: 'Weekly', status: 'In progress',
  },
  {
    id: 'MT5', challengeIds: ['MI5'], basis: 'Company data',
    mitigant: 'Live tracking of revenue and PBT against the FY27 targets',
    how: 'The Order Book & Outlook tab compares year-to-date revenue and PBT with the guidance every time the dashboard refreshes.',
    evidence: 'Targets in the dashboard: EPC revenue mid-point of INR 900 Cr and PBT of INR 120 Cr.',
    owner: 'Finance Control', timeline: 'Monthly', status: 'In place',
  },
  {
    id: 'MT6', challengeIds: ['MA2', 'MA9'], basis: 'Proposed - to confirm',
    mitigant: 'Lock in cell-compliant modules early for projects that will commission after 31 Dec 2026',
    how: 'Identify every project likely to commission after the waiver ends, place module orders with domestic-cell suppliers ahead of time, and add price-variation and ALMM clauses to client contracts.',
    evidence: 'Wood Mackenzie: waivers end 31 Dec 2026 and cell supply is short of module demand.',
    owner: 'Procurement / Projects', timeline: 'Before 31 Dec 2026', status: 'Planned',
  },
  {
    id: 'MT7', challengeIds: ['MA1', 'MA3', 'MA9'], basis: 'Proposed - to confirm',
    mitigant: 'Several qualified module and cell suppliers, with financial checks and back-to-back protection',
    how: 'Keep at least two approved suppliers per project, check each supplier\'s balance sheet and warranty backing, and use bank guarantees or staged payments for large orders.',
    evidence: 'ICRA expects consolidation among smaller module makers.',
    owner: 'Procurement', timeline: 'Ongoing', status: 'Planned',
  },
  {
    id: 'MT8', challengeIds: ['MA4', 'MA6'], basis: 'Company data',
    mitigant: 'Build the order book on signed LOAs from commercial and industrial clients, not on unsigned PPAs',
    how: 'Count only orders backed by signed letters of award, and keep public-sector exposure to defined, contracted orders.',
    evidence: 'The Sept 2026 order book is final per signed LOAs.',
    owner: 'Business Development / Finance Control', timeline: 'Ongoing', status: 'In place',
  },
  {
    id: 'MT9', challengeIds: ['MA5', 'MI6'], basis: 'Company data',
    mitigant: 'Add battery storage to projects to soak up curtailment, and plan evacuation early',
    how: 'Offer BESS with solar to clients, and confirm grid evacuation capacity before work starts on a new park.',
    evidence: '15 of the 38 projects in the order book already include BESS capacity.',
    owner: 'Projects / Business Development', timeline: 'Per project', status: 'In progress',
  },
  {
    id: 'MT10', challengeIds: ['MI7', 'MA7'], basis: 'Company data',
    mitigant: 'Phase the manufacturing ramp-up and anchor it on captive demand',
    how: 'Start BESS manufacturing against locked captive orders, follow the phased plan in the Manufacturing section, and review output and cash every month.',
    evidence: 'Plan in the dashboard: INR 395 Cr of captive orders locked; BESS line capex INR 82 Cr with first revenue from Q3 FY27.',
    owner: 'Management / RPE Technologies', timeline: 'FY27 - FY28', status: 'In progress',
  },
  {
    id: 'MT11', challengeIds: ['MA8', 'MI2'], basis: 'Company data',
    mitigant: 'Keep the balance sheet light and price any capital raise on fundamentals',
    how: 'Keep gearing low and judge valuation on our own margin and cash, not on listed-peer prices at their peak.',
    evidence: 'Gearing 0.14x, interest coverage 40.7x and debt/EBITDA 0.31x in FY26.',
    owner: 'Management / Finance Control', timeline: 'Ongoing', status: 'In place',
  },
  {
    id: 'MT12', challengeIds: ['MI6'], basis: 'Company data',
    mitigant: 'Spread the park pipeline across more locations',
    how: 'Move planned parks forward outside the busiest Rajasthan clusters where the approvals and grid access allow.',
    evidence: 'The park pipeline includes Tosham in Haryana alongside Rajasthan sites; the live park shares are on the Challenges tab.',
    owner: 'Business Development / Land', timeline: 'FY27 - FY28', status: 'Planned',
  },
  {
    id: 'MT13', challengeIds: ['MI8'], basis: 'Proposed - to confirm',
    mitigant: 'Stage-gate spending on parks so capital follows signed demand',
    how: 'Release land and infrastructure spend in stages, tied to approvals and signed client commitments, and review park-wise spend in the New Park Development tab.',
    evidence: 'Park-wise spend is already tracked in the New Park Development tab.',
    owner: 'Management / Finance Control', timeline: 'From next park', status: 'Planned',
  },
];

export const DEFAULTS = { macro: MACRO, micro: MICRO, mitigants: MITIGANTS };

// ── Saved edits (only the changes) ──────────────────────────────────────────────
export const emptyEdits = () => ({ overrides: {}, extra: { macro: [], micro: [], mitigants: [] }, removed: [] });

export async function loadChallengeEdits() {
  const saved = await getRemote(REMOTE_KEY, null);
  const base = emptyEdits();
  if (!saved || typeof saved !== 'object') return base;
  return {
    overrides: saved.overrides && typeof saved.overrides === 'object' ? saved.overrides : base.overrides,
    extra: {
      macro: Array.isArray(saved.extra?.macro) ? saved.extra.macro : [],
      micro: Array.isArray(saved.extra?.micro) ? saved.extra.micro : [],
      mitigants: Array.isArray(saved.extra?.mitigants) ? saved.extra.mitigants : [],
    },
    removed: Array.isArray(saved.removed) ? saved.removed : [],
  };
}

// Returns { ok, connected }. The shared store answers { ok: true } only when the change was really stored;
// with no database connected it answers { connected: false } and nothing is kept.
export async function saveChallengeEdits(edits) {
  try {
    const r = await fetch('/api/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: REMOTE_KEY, value: { ...edits, updatedAt: new Date().toISOString() } }),
    });
    const d = await r.json().catch(() => null);
    return { ok: r.ok && !!d && d.ok === true, connected: !(d && d.connected === false) };
  } catch {
    return { ok: false, connected: false };
  }
}

// Defaults + saved changes -> the list that is shown.
export function mergeList(kind, edits) {
  const removed = new Set(edits.removed || []);
  const ov = edits.overrides || {};
  return [...DEFAULTS[kind], ...(edits.extra?.[kind] || [])]
    .filter((d) => !removed.has(d.id))
    .map((d) => ({ ...d, ...(ov[d.id] || {}) }));
}

// ── Live indicators for the micro challenges ────────────────────────────────────
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const pctOf = (a, b) => (b > 0 ? (a / b) * 100 : null);
const p1 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '-' : `${v.toFixed(1)}%`);
const cr = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '-' : `INR ${v.toLocaleString('en-IN', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} Cr`);

// "Wonder Cement Ltd. - Phase 3" and "Wonder Cement Ltd. - Phase 2" are one client group.
export const clientGroup = (name) => String(name || '')
  .replace(/\s*[-—–]\s*Phase\s*\d+\s*$/i, '')
  .replace(/\s*\(.*?\)\s*$/, '')
  .trim();

const WAITING = 'FY27 figures not loaded yet';
const tone = (ok, otherwise) => (ok ? 'good' : otherwise);

// inv  = investor data (editable Outlook data); ytd27 = computeTotals() for FY27; monthsReported = months shown for FY27.
export function buildIndicators(inv, ytd27, monthsReported) {
  const out = {};
  const rows = Array.isArray(inv?.epcRevenueRecognition) ? inv.epcRevenueRecognition : [];
  const orderTotal = rows.reduce((s, r) => s + num(r.totalCost), 0);
  const cg = inv?.companyGlance || {};
  const col = inv?.collections || {};
  const ratio = (name) => (Array.isArray(inv?.keyRatios) ? inv.keyRatios.find((r) => r.ratio === name) : null);

  // MI1 - collections
  const debtor = ratio('Debtor Days');
  out.MI1 = [
    { label: 'Collected in Q1 FY27', value: `${col.collectedPct ?? '-'}% of INR ${col.grossBilling ?? '-'} Cr billed`, tone: tone(num(col.collectedPct) >= 90, 'warn') },
    { label: 'Still outstanding (Q1 FY27)', value: `INR ${col.outstanding ?? '-'} Cr (${col.outstandingPct ?? '-'}%)`, tone: 'info' },
    ...(debtor ? [{ label: 'Debtor days', value: `${debtor.fy26} in FY26 (FY25: ${debtor.fy25}; benchmark ${debtor.benchmark})`, tone: 'good' }] : []),
  ];

  // MI2 - margin
  const liveRev = num(ytd27?.totalRev);
  const liveEbitdaPct = liveRev > 0 ? (num(ytd27.ebitda) / liveRev) * 100 : null;
  const livePbtPct = liveRev > 0 ? (num(ytd27.pbt) / liveRev) * 100 : null;
  out.MI2 = [
    { label: 'EBITDA margin, FY26 vs FY25', value: `${p1(cg.ebitdaMargin)} vs ${p1(cg.ebitdaMarginPrior)}`, tone: num(cg.ebitdaMargin) >= num(cg.ebitdaMarginPrior) ? 'good' : 'warn' },
    { label: 'PBT margin, FY26 vs FY25', value: `${p1(cg.pbtMargin)} vs ${p1(cg.pbtMarginPrior)}`, tone: num(cg.pbtMargin) >= num(cg.pbtMarginPrior) ? 'good' : 'warn' },
    { label: 'EBITDA margin, FY27 so far (live)', value: liveRev > 0 ? p1(liveEbitdaPct) : WAITING, tone: 'info' },
    { label: 'PBT margin, FY27 so far (live)', value: liveRev > 0 ? p1(livePbtPct) : WAITING, tone: 'info' },
  ];

  // MI3 - client concentration
  const groups = {};
  for (const r of rows) { const g = clientGroup(r.client); groups[g] = (groups[g] || 0) + num(r.totalCost); }
  const ranked = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  const top1 = ranked[0];
  const top3 = ranked.slice(0, 3).reduce((s, [, v]) => s + v, 0);
  const govt = rows.filter((r) => ['RVUNL', 'NTPC'].includes(String(r.client).trim())).reduce((s, r) => s + num(r.totalCost), 0);
  out.MI3 = [
    ...(top1 ? [{ label: 'Largest client group', value: `${top1[0]} - ${p1(pctOf(top1[1], orderTotal))} of order value (${cr(top1[1])})`, tone: pctOf(top1[1], orderTotal) > 30 ? 'warn' : 'info' }] : []),
    { label: 'Top 3 client groups', value: `${p1(pctOf(top3, orderTotal))} of order value`, tone: pctOf(top3, orderTotal) > 60 ? 'warn' : 'info' },
    { label: 'Public-sector BESS (RVUNL + NTPC)', value: `${cr(govt)} (${p1(pctOf(govt, orderTotal))})`, tone: 'info' },
    { label: 'Order book size', value: `${cr(orderTotal)} across ${rows.length} projects`, tone: 'info' },
  ];

  // MI4 - backlog
  const commissioned = rows.filter((r) => r.commissioningDate).length;
  const pendingValue = rows.filter((r) => !r.commissioningDate).reduce((s, r) => s + num(r.totalCost), 0);
  out.MI4 = [
    { label: 'Projects commissioned', value: `${commissioned} of ${rows.length}`, tone: 'info' },
    { label: 'Value still to commission', value: `${cr(pendingValue)} (${p1(pctOf(pendingValue, orderTotal))} of order value)`, tone: pctOf(pendingValue, orderTotal) > 50 ? 'warn' : 'info' },
  ];

  // MI5 - delivery vs target
  const tRev = num(inv?.guidance?.epcTargetMid);
  const tPat = num(inv?.guidance?.patTarget);
  const revCr = liveRev / 1e7;
  const pbtCr = num(ytd27?.pbt) / 1e7;
  out.MI5 = [
    { label: 'Months reported in FY27', value: `${monthsReported ?? '-'} of 12`, tone: 'info' },
    { label: 'Revenue so far vs INR ' + tRev + ' Cr target', value: liveRev > 0 ? `${cr(revCr)} (${p1(pctOf(revCr, tRev))})` : WAITING, tone: 'info' },
    { label: 'PBT so far vs INR ' + tPat + ' Cr target', value: liveRev > 0 ? `${cr(pbtCr)} (${p1(pctOf(pbtCr, tPat))})` : WAITING, tone: 'info' },
  ];

  // MI6 - park / geography
  const parks = {};
  for (const r of rows) { const k = String(r.park || '').trim(); if (k) parks[k] = (parks[k] || 0) + num(r.totalCost); }
  const pr = Object.entries(parks).sort((a, b) => b[1] - a[1]);
  const top2 = pr.slice(0, 2);
  const upcoming = Array.isArray(inv?.solarParks?.upcoming) ? inv.solarParks.upcoming : [];
  const inRaj = upcoming.filter((p) => /raj/i.test(p.location || '')).length;
  out.MI6 = [
    ...(top2.length === 2 ? [{ label: 'Two largest parks by order value', value: `${top2[0][0]} ${p1(pctOf(top2[0][1], orderTotal))} + ${top2[1][0]} ${p1(pctOf(top2[1][1], orderTotal))}`, tone: pctOf(top2[0][1] + top2[1][1], orderTotal) > 40 ? 'warn' : 'info' }] : []),
    ...(upcoming.length ? [{ label: 'Planned parks in Rajasthan', value: `${inRaj} of ${upcoming.length}`, tone: inRaj / upcoming.length > 0.7 ? 'warn' : 'info' }] : []),
  ];

  // MI7 - new manufacturing lines
  const capexT = num(inv?.manufacturing?.transformer?.capex);
  const capexB = num(inv?.manufacturing?.battery?.capex);
  const sf = num(inv?.balanceSheet?.shareholdersFunds);
  const bess27 = inv?.manufacturing?.bessProjection?.revenue?.[0];
  out.MI7 = [
    { label: 'Capex in the two lines', value: `${cr(capexT + capexB)} (transformer ${cr(capexT)}, BESS ${cr(capexB)})`, tone: 'info' },
    { label: 'As a share of shareholders\' funds', value: p1(pctOf(capexT + capexB, sf)), tone: pctOf(capexT + capexB, sf) > 40 ? 'warn' : 'info' },
    ...(bess27 ? [{ label: 'BESS manufacturing revenue planned for FY27', value: cr(bess27), tone: 'info' }] : []),
  ];

  // MI8 - park development capital: live figures live in the New Park Development tab
  out.MI8 = [
    { label: 'Park-wise spend and balances', value: 'See the New Park Development tab', tone: 'info' },
  ];

  return out;
}
