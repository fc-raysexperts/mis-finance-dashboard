import { getAccessToken } from './_tokenCache.js';

// Keyword map — one entry per real, currently-active NPD park (confirmed
// against ZB's own Projects list). Excludes dormant/non-park Excel entries
// (Ramgarh, Sarera, Siwani, Bikaner, Kuchaman — see investigation notes).
// Includes known spelling variants found in the live Chart of Accounts.
const PARK_KEYWORDS = {
  'Jaisalmer':    ['jaisalmer'],
  'Kolayat':      ['kolayat', 'koyalat', 'kolyat'],
  'Dechu':        ['dechu'],
  'Lunkaransar':  ['lunkaransar'],
  'Napasar':      ['napasar'],
  'Panchu':       ['panchu'],
  'Pugal':        ['pugal'],
  'Bhamatsar':    ['bhamatsar'],
  'Sanchore':     ['sanchore', 'sachore'],
  'Tosham':       ['tosham', 'tohsam'],
  'SS Nagar':     ['ss nagar', 's s nagar'],
  'Thukariyasar': ['thukariyasar', 'thukriyasar'],
  'Baithwasiya':  ['baithwasiya'],
  'Jasarasar':    ['jasarasar', 'jasrasar'],
  'Sheruna':      ['sheruna'],
};
const NON_NPD_ACCOUNT_TYPES = new Set(['bank', 'cash']);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Conservative bounded concurrency: process items in small batches (not full
// unlimited parallelism) with a pause between batches. This is a genuine
// unknown — we don't know Zoho's exact tolerance for bursts of simultaneous
// requests vs. the steady one-at-a-time trickle used everywhere else in this
// codebase. Batch size 3 chosen deliberately conservative; test on small
// parks before trusting this on Dechu-sized ones.
async function processBatched(items, batchSize, pauseMs, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + batchSize < items.length) await sleep(pauseMs);
  }
  return results;
}

// ── Full classification: every account-name pattern discovered and ruled on
//    throughout the investigation, mapped to (Category, Head Grouping).
//    Order matters — more specific patterns must be checked before broader
//    ones (e.g. "land registration charges" before generic "land lease").
const CLASSIFICATION_RULES = [
  { test: n => n.includes('registration fee'), category: 'Registration Fees', head: 'IAUD' },
  { test: n => n.includes('commission') || n.includes('brokerage'), category: 'Commission', head: 'IAUD' },
  { test: n => n.includes('land registration charges'), category: 'Land Lease Registration', head: 'IAUD' },
  { test: n => n.includes('lease registration'), category: 'Land Lease Registration', head: 'IAUD' },
  { test: n => n.includes('land at'), category: 'Land Lease Expenses', head: 'CWIP' }, // "land at Dechu" etc — direct purchase, ruled CWIP
  { test: n => n.includes('land lease'), category: 'Land Lease Expenses', head: 'IAUD' },
  { test: n => n.includes('legal') || n.includes('professional') || n.includes('consultancy'), category: 'Legal & Professional Charges', head: 'IAUD' },
  { test: n => n.includes('connectivity'), category: 'Connectivity Charges', head: 'IAUD' },
  { test: n => n.includes('technical service'), category: 'Technical Service', head: 'IAUD', parkException: { 'Panchu': 'CWIP' } }, // confirmed against Excel Final Summary
  { test: n => n.includes('levelling') || n.includes('leveling'), category: 'Land Levelling & Survey', head: 'CWIP' },
  { test: n => n.includes('purchase') || n.includes('civil work') || n.includes('transmission line') || n.includes('cwip') || n.includes('erection') || n.includes('installation') || n.includes('mms') || n.includes('module') || n.includes('inventory asset') || n.includes('other project expenses'), category: 'Purchase', head: 'CWIP' },
  { test: n => n.includes('freight') || n.includes('cartage'), category: 'Rent & Other', head: 'CWIP' },
  { test: n => n.includes('loading') || n.includes('unloading'), category: 'Rent & Other', head: 'CWIP' },
  { test: n => n.includes('imprest'), category: 'Rent & Other', head: 'CWIP' },
  { test: n => n.includes('transportation'), category: 'Rent & Other', head: 'CWIP' },
  { test: n => n.includes('taxi') || n.includes('conveyance'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('boarding'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('rent'), category: 'Rent & Other', head: 'CWIP' },
  { test: n => n.includes('other work'), category: 'Rent & Other', head: 'CWIP' }, // matches "Other Works" and "Other Work" (singular typo variant)
  { test: n => n.includes('site expenses'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('security service'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('labour charges') || n.includes('labor charges'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('project approval') || n.includes('govt fees') || n.includes('government fees'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('intangible assets') && !n.includes('development rights'), category: 'Rent & Other', head: 'IAUD' }, // "Panchu Intangible Assets (Npd)"
  { test: n => n.includes('intangible asset under development'), category: 'Land Lease Expenses', head: 'IAUD' }, // singular "asset" — distinct from the plural "Intangible Assets" rule above; covers "...New Solar Park" variant
  { test: n => n.includes('consumption') || n.includes('cost of goods sold') || n.includes('work in progress'), category: 'Purchase', head: 'CWIP' }, // NOTE: "Consumption- Project Material GM" specifically uses FIFO costing, not standard GL entries — flagged as unreliable to read via debit_total since the original dashboard build
  { test: n => n.includes('testing fee') || n.includes('inspection charge'), category: 'Technical Service', head: 'CWIP' }, // explicitly CWIP for all parks, not the default Technical Service IAUD rule
  { test: n => n.includes('retention') || n.includes('security deposit'), category: 'Retention & Deposits', head: 'CWIP' }, // new 11th category — contractor retention money + deposits, genuinely distinct from the original 10 Excel categories
  { test: n => n.includes('inventories'), category: 'Purchase', head: 'CWIP' }, // "Inventories - Project Material GM" — plural, distinct from "inventory asset" (singular) rule above
  { test: n => n.includes('security manpower'), category: 'Rent & Other', head: 'IAUD' }, // distinct from "security service" — catches "Security Manpower Expenses" and "..._1" variant
  { test: n => n.includes('vehicle running') || n.includes('vehicle maintenance'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('travelling') || n.includes('traveling'), category: 'Rent & Other', head: 'IAUD' }, // "Tour & Travelling Expenses" — distinct from taxi/conveyance rule
];

function classify(accountName, park, customClassifications = {}) {
  const n = (accountName || '').toLowerCase().trim();
  // User-saved classifications (from the inline "classify this" UI action)
  // take priority over hardcoded rules — this is the permanent, one-time
  // fix the user applies directly, not a fallback guess.
  if (customClassifications[n]) {
    try {
      const saved = typeof customClassifications[n] === 'string' ? JSON.parse(customClassifications[n]) : customClassifications[n];
      return { category: saved.category, head_grouping: saved.head_grouping };
    } catch { /* malformed saved entry — fall through to rules */ }
  }
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.test(n)) {
      const head = (rule.parkException && rule.parkException[park]) || rule.head;
      return { category: rule.category, head_grouping: head };
    }
  }
  return { category: 'Unclassified', head_grouping: 'Unclassified' };
}

// ── FIXED: this was only ever checking 3 hardcoded flat-account names,
//    never running the same pattern rules classify() uses — which is why
//    Transportation Charges, Purchase-type, Freight/Cartage, and Land Lease
//    accounts were falling through to Unclassified despite rules already
//    existing for all of them. Now checks CLASSIFICATION_RULES first (the
//    account actually has a specific, informative name), falling back to
//    the 3 known company-wide rollup accounts only when nothing specific
//    matches — those are inherent approximations (a single category applied
//    to what's really a mixed bucket), everything else here is a real
//    pattern match, same confidence as the CoA channel.
function classifyFlatAccount(flatAccountName, customClassifications = {}) {
  const specific = classify(flatAccountName, null, customClassifications);
  if (specific.category !== 'Unclassified') return specific;

  const n = (flatAccountName || '').toLowerCase();
  if (n === 'capital work in progress') return { category: 'Purchase', head_grouping: 'CWIP' };
  if (n === 'intangible assets - development rights') return { category: 'Land Lease Expenses', head_grouping: 'IAUD' };
  if (n === 'intangible asset under development') return { category: 'Land Lease Expenses', head_grouping: 'IAUD' };
  return { category: 'Unclassified', head_grouping: 'Unclassified' }; // genuinely new, no rule covers it — needs a real decision, not a guess
}

// Parks that currently rely 100% on Project-tagged Bills (zero CoA presence
// as of this investigation). If any of these ever gains a real CoA account,
// there's a real double-counting risk: if ZB sweeps their historical
// Project-tagged Bills money into the new account via a journal (the same
// "JN-Clean-##" pattern found on Kolayat/Dechu), that journal carries its
// own number, not the original bill numbers — our dedup wouldn't catch it.
// This can't be safely auto-resolved (needs the same manual date/vendor
// tracing used throughout this investigation), so we detect and alert
// rather than silently merge or silently ignore.
const WATCHED_FALLBACK_ONLY_PARKS = new Set(['Thukariyasar', 'Baithwasiya', 'Jasarasar', 'Sheruna']);

let redisClient = null;
async function getRedis() {
  if (redisClient) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const { Redis } = await import('@upstash/redis');
    redisClient = new Redis({ url, token });
    return redisClient;
  } catch {
    return null;
  }
}

async function checkCoaTransition(park, currentAccountCount) {
  if (!WATCHED_FALLBACK_ONLY_PARKS.has(park)) return null;
  const redis = await getRedis();
  if (!redis) return { warning: 'REDIS_UNAVAILABLE — cannot check for CoA transition, verify manually' };

  const key = `npd:coa_transition_flagged:${park}`;
  const alreadyFlagged = await redis.get(key);

  if (currentAccountCount > 0 && !alreadyFlagged) {
    // Fresh transition — this park just gained real CoA accounts for the
    // first time. Flag permanently (until a human clears it after manually
    // verifying no double-count) rather than a one-time notification that
    // could be missed.
    await redis.set(key, { flagged_at: new Date().toISOString(), account_count_at_detection: currentAccountCount });
    return {
      status: 'NEW_TRANSITION_DETECTED',
      message: `${park} just gained ${currentAccountCount} real CoA account(s) for the first time. Before trusting the combined total, manually verify whether ZB swept this park's historical Project-tagged Bills money into the new account(s) — if so, the current dedup logic will double-count it. This flag will persist until manually cleared in Redis (key: ${key}).`
    };
  }
  if (alreadyFlagged) {
    return {
      status: 'PREVIOUSLY_FLAGGED_UNRESOLVED',
      message: `${park} was previously flagged for a CoA transition and this has not been manually cleared. Details: ${JSON.stringify(alreadyFlagged)}`
    };
  }
  return null; // still zero CoA accounts, nothing to flag
}

// Cheap check — reads the set of pending-review park names flagged by
// npdDiscoverNewParks.js (a single Redis read), doesn't re-scan ZB itself.
// The actual scan only runs when that dedicated endpoint is called.
async function checkPendingNewParks() {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    const pending = await redis.smembers('npd:new_parks_pending_review_set');
    if (pending && pending.length > 0) {
      return {
        status: 'UNRECOGNIZED_PARKS_PENDING_REVIEW',
        parks: pending,
        message: `${pending.length} "Solar Park"-named customer(s) exist in ZB that aren't in the known park list. Run npdDiscoverNewParks for details, confirm each is genuinely new (not a spelling variant or unrelated entity), then add to PARK_KEYWORDS.`
      };
    }
  } catch { /* non-fatal */ }
  return null;
}

// ── Period resolution — Indian fiscal year (April 1 to March 31). "FY27"
//    means the fiscal year ENDING March 2027 (Apr 2026 - Mar 2027), matching
//    the convention used throughout this whole project. Quarters: Q1=Apr-Jun,
//    Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar (of the following calendar year).
//    Monthly uses plain calendar year+month, not fiscal-relative numbering,
//    to avoid a second confusing numbering scheme on top of the fiscal one.
function pad2(n) { return String(n).padStart(2, '0'); }
function lastDayOfMonth(year, month) { return new Date(year, month, 0).getDate(); } // month is 1-12

function resolvePeriod(query) {
  const { period, fy, quarter, year, month, from_date, to_date } = query;
  const today = new Date().toISOString().slice(0, 10);

  // Explicit override always wins — kept for debugging/flexibility.
  if (from_date || to_date) {
    return { fromDate: from_date || '2020-04-01', toDate: to_date || today, periodLabel: 'custom_override' };
  }

  if (!period || period === 'total') {
    return { fromDate: '2020-04-01', toDate: today, periodLabel: 'Total Till Date' };
  }

  if (period === 'yearly') {
    const fyEndYear = parseInt(fy, 10);
    if (!fyEndYear) return { error: `period=yearly requires a valid fy parameter, e.g. fy=27 or fy=2027` };
    const endYear = fyEndYear < 100 ? 2000 + fyEndYear : fyEndYear;
    const startYear = endYear - 1;
    const fromDate = `${startYear}-04-01`;
    const computedToDate = `${endYear}-03-31`;
    const toDate = computedToDate > today ? today : computedToDate; // don't request future dates for the still-ongoing FY
    return { fromDate, toDate, periodLabel: `FY${endYear}` };
  }

  if (period === 'quarterly') {
    const fyEndYear = parseInt(fy, 10);
    const q = parseInt(quarter, 10);
    if (!fyEndYear || ![1, 2, 3, 4].includes(q)) {
      return { error: `period=quarterly requires fy (e.g. 27) and quarter (1-4)` };
    }
    const endYear = fyEndYear < 100 ? 2000 + fyEndYear : fyEndYear;
    const startYear = endYear - 1;
    const quarterBounds = {
      1: { fromY: startYear, fromM: 4, toY: startYear, toM: 6 },
      2: { fromY: startYear, fromM: 7, toY: startYear, toM: 9 },
      3: { fromY: startYear, fromM: 10, toY: startYear, toM: 12 },
      4: { fromY: endYear, fromM: 1, toY: endYear, toM: 3 },
    }[q];
    const fromDate = `${quarterBounds.fromY}-${pad2(quarterBounds.fromM)}-01`;
    const computedToDate = `${quarterBounds.toY}-${pad2(quarterBounds.toM)}-${pad2(lastDayOfMonth(quarterBounds.toY, quarterBounds.toM))}`;
    const toDate = computedToDate > today ? today : computedToDate;
    return { fromDate, toDate, periodLabel: `FY${endYear} Q${q}` };
  }

  if (period === 'monthly') {
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    if (!y || !m || m < 1 || m > 12) return { error: `period=monthly requires year (e.g. 2026) and month (1-12)` };
    const fromDate = `${y}-${pad2(m)}-01`;
    const computedToDate = `${y}-${pad2(m)}-${pad2(lastDayOfMonth(y, m))}`;
    const toDate = computedToDate > today ? today : computedToDate;
    return { fromDate, toDate, periodLabel: `${y}-${pad2(m)}` };
  }

  return { error: `period must be one of: total, yearly, quarterly, monthly` };
}

export default async function handler(req, res) {
  const startTime = Date.now();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { park } = req.query;
  if (!park || !PARK_KEYWORDS[park]) {
    return res.status(400).json({
      error: 'park is required and must be one of the known park names',
      valid_parks: Object.keys(PARK_KEYWORDS),
    });
  }

  const resolved = resolvePeriod(req.query);
  if (resolved.error) {
    return res.status(400).json({
      error: resolved.error,
      examples: [
        '?park=Dechu&period=total',
        '?park=Dechu&period=yearly&fy=27',
        '?park=Dechu&period=quarterly&fy=27&quarter=1',
        '?park=Dechu&period=monthly&year=2026&month=7',
        '?park=Dechu&from_date=2026-04-01&to_date=2026-06-30 (raw override)',
      ],
    });
  }
  const { fromDate, toDate, periodLabel } = resolved;

  // Check whether npdAllParksSummary already computed and cached this exact
  // park+period combination as a byproduct of the summary tables loading —
  // if so, return it instantly instead of recomputing everything from
  // scratch. Only applies if the request used period=X (not a raw
  // from_date/to_date override), since the cache key is period-label-based.
  const cacheRedis = await getRedis();
  if (cacheRedis) {
    try {
      const cached = await cacheRedis.get(`npd:cache:park_full:${park}:${periodLabel}`);
      if (cached) {
        return res.status(200).json({ ...cached, served_from_summary_cache: true, response_time_ms: Date.now() - startTime });
      }
    } catch { /* fall through to live computation */ }
  }

  const env = {
    VITE_ZB_CLIENT_ID: process.env.VITE_ZB_CLIENT_ID,
    VITE_ZB_CLIENT_SECRET: process.env.VITE_ZB_CLIENT_SECRET,
    VITE_ZB_REFRESH_TOKEN: process.env.VITE_ZB_REFRESH_TOKEN,
  };
  const ORG_ID = process.env.VITE_ZB_ORG_ID;
  const { access_token, error } = await getAccessToken(env);
  if (!access_token) return res.status(500).json({ error: 'Token failed', detail: error });
  const H = { Authorization: `Zoho-oauthtoken ${access_token}` };
  const ORG = `organization_id=${ORG_ID}`;

  try {
    // 1. Identify this park's real (non-zero) accounts — Chart of Accounts
    //    (paginated properly) + GL bulk report to filter out zero-value
    //    legacy duplicates before we ever touch the transaction endpoint.
    const accountsResult = await fetchAllAccounts(H, ORG);
    const glResult = await fetchAllGlAccounts(H, ORG);
    const accounts = accountsResult.data;
    const glAccounts = glResult.data;
    const keywords = PARK_KEYWORDS[park];

    // Load user-saved classifications ONCE per request (single Redis read),
    // not per-transaction — these take priority over hardcoded rules.
    let customClassifications = {};
    const redisForClassifications = await getRedis();
    if (redisForClassifications) {
      try { customClassifications = (await redisForClassifications.hgetall('npd:custom_classifications')) || {}; } catch { /* non-fatal */ }
    }

    const parkAccounts = accounts
      .filter(a => {
        if (NON_NPD_ACCOUNT_TYPES.has(a.account_type)) return false;
        const childName = (a.account_name || '').toLowerCase();
        const parentName = (a.parent_account_name || '').toLowerCase();
        return keywords.some(kw => childName.includes(kw) || parentName.includes(kw));
      })
      .filter(a => {
        const glMatch = glAccounts.find(g => g.name === a.account_name);
        return glMatch && (parseFloat(glMatch.debit_total) || 0) !== 0;
      });

    // 2. Pull transaction-level detail — ONE account at a time (the only
    //    format proven to reliably return real data; batching multiple
    //    account_ids into a single "in" filter does not work correctly).
    // Field names confirmed against known ground truth (screenshot): the
    // real fields are date/transaction_details/debit — NOT
    // transaction_date/description/debit_amount as an earlier (different
    // query shape) test had suggested.
    const accountResults = await processBatched(parkAccounts, 3, 400, async (acct) => {
      const txns = await fetchAccountTransactions(H, ORG, acct.account_id, fromDate, toDate);
      const cls = classify(acct.account_name, park, customClassifications);
      return txns.map(t => ({
        date: t.date,
        vendor: t.transaction_details,
        transaction_type: t.transaction_type,
        bill_number: t.entity_number,
        branch: t.branch?.location_name || null,
        project_name: null,
        account_name: acct.account_name,
        category: cls.category,
        head_grouping: cls.head_grouping,
        source: 'chart_of_accounts',
        amount: parseFloat(t.debit) || 0,
      }));
    });
    let allTxns = accountResults.flat();
    const coaBillNumbers = new Set(allTxns.map(t => t.bill_number).filter(Boolean));

    // 3. ALWAYS also check project-tagged Bills — not just as a fallback for
    //    zero-CoA parks. CONFIRMED via direct investigation (Lunkaransar:
    //    ₹8.21 Cr, Panchu: ₹1.66 Cr) that active construction-phase spend
    //    frequently posts to FLAT accounts (Capital Work in Progress,
    //    Intangible Asset Under Development, Intangible Assets - Development
    //    Rights) tagged only by project — invisible to CoA name-matching no
    //    matter how it's tuned. Cross-referenced by bill_number against what
    //    the CoA method already found, so only genuinely NEW money gets
    //    added — known simplification: this dedupes at the whole-bill level,
    //    not per line-item, so a bill split across both a matched CoA
    //    account AND a flat account would be slightly undercounted (treated
    //    as fully "already counted" if its bill_number matches).
    const projectsResult = await fetchAllProjects(H, ORG);
    const projects = projectsResult.data;
    // FIXED (3rd iteration): triple-layered check. 2nd iteration correctly
    // added customer_name + component-suffix matching, but dropped the
    // "npd" requirement on project_name out of an unfounded worry it would
    // exclude real PSS money for Dechu/Lunkaransar. That worry was wrong —
    // "NPD - Dechu- PSS" already existed in the very first Projects
    // screenshot from the start of this investigation, running in parallel
    // with a rogue non-NPD duplicate the whole time. Confirmed directly via
    // Thukariyasar: "NPD-Thukriyasar-Land" and "Thukariyasar-Land" share the
    // exact same legitimate customer_name, so customer_name alone can't
    // distinguish the real tracking project from a duplicate — only the
    // explicit "NPD" in project_name can.
    // Component check made position-independent: tokenize on ANY
    // non-alphanumeric character (not just dash) and require an EXACT token
    // match — not a raw substring search, which would risk short codes like
    // "tl" matching inside unrelated words (e.g. "outlet" contains "tl").
    const VALID_COMPONENT_SUFFIXES = new Set(['bw', 'land', 'mcr', 'pss', 'tl']);
    const matchedProjects = projects.filter(p => {
      const customerName = (p.customer_name || '').toLowerCase();
      const projectName = (p.project_name || '').toLowerCase();
      const isRealParkCustomer = keywords.some(kw => customerName.includes(kw)) && customerName.includes('solar park');
      const isNpdDesignated = projectName.includes('npd');
      const tokens = projectName.split(/[^a-z0-9]+/).filter(Boolean);
      const hasValidComponentSuffix = tokens.some(t => VALID_COMPONENT_SUFFIXES.has(t));
      return isRealParkCustomer && isNpdDesignated && hasValidComponentSuffix;
    });
    let newFromProjectBills = 0;
    let billDetailCallsMade = 0;
    let allNewBills = [];
    for (const proj of matchedProjects) {
      const bills = await fetchProjectBills(H, ORG, proj.project_id);
      const newOnes = bills.filter(b => !coaBillNumbers.has(b.bill_number) && (b.date || '') >= fromDate && (b.date || '') <= toDate);
      newFromProjectBills += newOnes.length;
      allNewBills = allNewBills.concat(newOnes.map(b => ({ bill: b, projectName: proj.project_name })));
    }

    const billResults = await processBatched(allNewBills, 3, 400, async ({ bill: b, projectName }) => {
      // Fetch full bill detail to see actual line-item GL accounts —
      // required for real classification (CoA name-matching can't see
      // these bills at all, so there's no shortcut here).
      const dr = await fetch(`https://www.zohoapis.in/books/v3/bills/${b.bill_id}?${ORG}`, { headers: H });
      const dd = await dr.json();
      billDetailCallsMade++;
      const lineItems = dd.bill?.line_items || [];
      if (lineItems.length === 0) {
        // Detail fetch failed or bill has no line items — fall back to
        // whole-bill total, unclassified, rather than silently dropping it
        return [{
          date: b.date, vendor: b.vendor_name || '', transaction_type: 'bill',
          bill_number: b.bill_number, branch: null, project_name: projectName, account_name: null,
          category: 'Unclassified', head_grouping: 'Unclassified',
          source: 'project_tagged_bill_supplemental', amount: parseFloat(b.total) || 0,
        }];
      }
      return lineItems.map(li => {
        const cls = classifyFlatAccount(li.account_name, customClassifications);
        return {
          date: b.date, vendor: b.vendor_name || '', transaction_type: 'bill',
          bill_number: b.bill_number, branch: null, project_name: projectName, account_name: li.account_name || null,
          category: cls.category, head_grouping: cls.head_grouping,
          source: 'project_tagged_bill_supplemental', amount: parseFloat(li.item_total) || 0,
        };
      });
    });
    allTxns = allTxns.concat(billResults.flat());

    allTxns.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const total = Math.round(allTxns.reduce((s, t) => s + t.amount, 0) * 100) / 100;
    const cwipTotal = Math.round(allTxns.filter(t => t.head_grouping === 'CWIP').reduce((s, t) => s + t.amount, 0) * 100) / 100;
    const iaudTotal = Math.round(allTxns.filter(t => t.head_grouping === 'IAUD').reduce((s, t) => s + t.amount, 0) * 100) / 100;
    const unclassifiedEntries = allTxns.filter(t => t.head_grouping === 'Unclassified');
    const categoryTotals = {};
    for (const t of allTxns) {
      categoryTotals[t.category] = Math.round(((categoryTotals[t.category] || 0) + t.amount) * 100) / 100;
    }

    const coaTransitionWarning = await checkCoaTransition(park, parkAccounts.length);
    const pendingNewParkReview = await checkPendingNewParks();

    return res.status(200).json({
      park,
      period_label: periodLabel,
      from_date: fromDate,
      to_date: toDate,
      response_time_ms: Date.now() - startTime,
      cache_status: {
        coa: accountsResult.cache_status,
        gl: glResult.cache_status,
        projects: projectsResult.cache_status,
      },
      account_count: parkAccounts.length,
      supplemental_project_bills_added: newFromProjectBills,
      supplemental_bill_detail_calls_made: billDetailCallsMade, // relevant to issue #4 (Vercel timeout risk)
      transaction_count: allTxns.length,
      total,
      cwip_total: cwipTotal,
      iaud_total: iaudTotal,
      category_totals: categoryTotals,
      unclassified_count: unclassifiedEntries.length,
      unclassified_entries: unclassifiedEntries.length > 0 ? unclassifiedEntries : undefined, // only present if something needs attention
      coa_transition_warning: coaTransitionWarning,
      pending_new_park_review: pendingNewParkReview,
      transactions: allTxns,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}

// ── Chart of Accounts, fully paginated (content-based stop, not the
//    unreliable has_more_page flag — see investigation notes). CACHED —
//    this exact same data (3,371 accounts) gets re-fetched identically on
//    every single park request otherwise, which measured as roughly half
//    of Jaisalmer's 17-second response time despite Jaisalmer itself only
//    needing 5 accounts. 10-minute TTL: long enough to eliminate redundant
//    fetches when browsing multiple parks in one session, short enough that
//    genuinely new accounts (e.g. a CoA-transition park) show up promptly.
const CACHE_TTL_SECONDS = 600;
async function fetchAllAccounts(H, ORG) {
  const redis = await getRedis();
  if (redis) {
    try {
      const cached = await redis.get('npd:cache:coa_accounts');
      if (cached) return { data: cached, cache_status: 'hit' };
    } catch { /* cache miss or error — fall through to live fetch */ }
  }

  let all = [];
  let page = 1;
  let lastFirstId = null;
  while (true) {
    const r = await fetch(`https://www.zohoapis.in/books/v3/chartofaccounts?${ORG}&page=${page}&per_page=1000&filter_by=AccountType.All`, { headers: H });
    const d = await r.json();
    const returned = d.chartofaccounts?.length || 0;
    const firstId = d.chartofaccounts?.[0]?.account_id || null;
    if (d.code !== 0 || returned === 0) break;
    if (firstId && firstId === lastFirstId) break;
    all = all.concat(d.chartofaccounts);
    lastFirstId = firstId;
    page++; if (page > 15) break;
    await sleep(400);
  }

  let writeStatus = redis ? 'not_attempted' : 'no_redis';
  if (redis) {
    try { await redis.set('npd:cache:coa_accounts', all, { ex: CACHE_TTL_SECONDS }); writeStatus = 'write_ok'; }
    catch (e) { writeStatus = `write_failed: ${e.message}`; }
  }
  return { data: all, cache_status: redis ? `miss_${writeStatus}` : 'no_redis' };
}

// ── GL bulk report — ignores per_page and returns everything in one call.
//    CACHED for the same reason as above. ──────────────────────────────────
async function fetchAllGlAccounts(H, ORG) {
  const redis = await getRedis();
  if (redis) {
    try {
      const cached = await redis.get('npd:cache:gl_accounts');
      if (cached) return { data: cached, cache_status: 'hit' };
    } catch { /* fall through */ }
  }

  let all = [];
  let page = 1;
  while (true) {
    const r = await fetch(`https://www.zohoapis.in/books/v3/reports/generalledger?${ORG}&from_date=2020-04-01&to_date=2026-08-04&page=${page}&per_page=200`, { headers: H });
    const d = await r.json();
    if (d.code !== 0 || !d.generalledger?.length) break;
    all = all.concat(d.generalledger);
    if (!d.page_context?.has_more_page) break;
    page++; if (page > 5) break;
    await sleep(400);
  }

  let writeStatus = redis ? 'not_attempted' : 'no_redis';
  if (redis) {
    try { await redis.set('npd:cache:gl_accounts', all, { ex: CACHE_TTL_SECONDS }); writeStatus = 'write_ok'; }
    catch (e) { writeStatus = `write_failed: ${e.message}`; }
  }
  return { data: all, cache_status: redis ? `miss_${writeStatus}` : 'no_redis' };
}

// ── Single-account transaction detail — the only format proven reliable.
//    Response is grouped (array of 1 entry with a nested array field, not a
//    flat list), so we dynamically find the nested array rather than assume
//    a fixed field name. ─────────────────────────────────────────────────
async function fetchAccountTransactions(H, ORG, accountId, fromDate, toDate) {
  const rule = encodeURIComponent(JSON.stringify({
    columns: [{ index: 1, field: 'account_id', group: 'report', comparator: 'in', value: [accountId] }],
    criteria_string: '1',
  }));
  const url = `https://www.zohoapis.in/books/v3/reports/accounttransaction?${ORG}&from_date=${fromDate}&to_date=${toDate}&rule=${rule}`;
  const r = await fetch(url, { headers: H });
  const d = await r.json();
  const entries = d.account_transactions || [];
  let found = [];
  for (const entry of entries) {
    for (const value of Object.values(entry || {})) {
      if (Array.isArray(value)) found = found.concat(value);
    }
  }
  return found;
}

// ── All ZB Projects, paginated. CACHED — same waste pattern as CoA/GL. ────
async function fetchAllProjects(H, ORG) {
  const redis = await getRedis();
  if (redis) {
    try {
      const cached = await redis.get('npd:cache:projects');
      if (cached) return { data: cached, cache_status: 'hit' };
    } catch { /* fall through */ }
  }

  let all = [];
  let page = 1;
  while (true) {
    const r = await fetch(`https://www.zohoapis.in/books/v3/projects?${ORG}&page=${page}&per_page=200`, { headers: H });
    const d = await r.json();
    if (d.code !== 0 || !d.projects?.length) break;
    all = all.concat(d.projects);
    if (!d.page_context?.has_more_page) break;
    page++; if (page > 5) break;
    await sleep(400);
  }

  let writeStatus = redis ? 'not_attempted' : 'no_redis';
  if (redis) {
    try { await redis.set('npd:cache:projects', all, { ex: CACHE_TTL_SECONDS }); writeStatus = 'write_ok'; }
    catch (e) { writeStatus = `write_failed: ${e.message}`; }
  }
  return { data: all, cache_status: redis ? `miss_${writeStatus}` : 'no_redis' };
}

// ── Bills tagged to a specific project_id ─────────────────────────────────
async function fetchProjectBills(H, ORG, projectId) {
  const r = await fetch(`https://www.zohoapis.in/books/v3/bills?${ORG}&project_id=${projectId}&per_page=200`, { headers: H });
  const d = await r.json();
  return d.bills || [];
}
