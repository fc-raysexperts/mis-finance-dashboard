// Shared logic for all NPD backend endpoints. Previously duplicated across
// npdParkTransactions.js, npdUnclassifiedScan.js, and npdDiscoverNewParks.js
// — which already caused one real bug (a rule fixed in one file but not
// the others). Consolidated here so there's exactly one place to update.

export const PARK_KEYWORDS = {
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
export const NON_NPD_ACCOUNT_TYPES = new Set(['bank', 'cash']);

// Manually excluded accounts — confirmed, verified false positives where a
// park keyword coincidentally appears inside a person's name (an Imprest
// account is a personal cash advance, unrelated to any park). This is
// deliberately a simple, explicit, hand-maintained list for these two
// specific accounts — not a general word-boundary or pattern-based fix.
export const MANUALLY_EXCLUDED_ACCOUNTS = new Set([
  'amar singh kolayat - imprest',
  'k r pugalia imprest',
  'land at lunkaransar',
  'panchu intangible assets (npd)',
]);

// Specific bills manually excluded from the Projects (NPD) channel —
// confirmed, via Zoho's own Account Transactions report, to have already
// been reclassified via Inventory Adjustment into an account we separately
// capture (Lunkaransar Purchase) — counting both would be a genuine
// duplicate. Deliberately bill-number-scoped, not account-level, since
// "Inventory Asset" itself still legitimately holds other, not-yet-
// reclassified items for other bills that should still count normally.
export const MANUALLY_EXCLUDED_BILLS = new Set([
  'EPPL/1563/25-26',   // Expel Prosys — reclassified into Lunkaransar Purchase, 28/03/2026
  'HTCPL/25-26/013',   // Hindustan Traffo Control — same reclassification
  'TI/2025-26/520',    // Aumni Transmission Industry — same reclassification (7 line items)
  'RTPC/001/25-26',    // RK Tech Power Corporation (Panchu) — reclassified via Inventory Adjustment (ref 6448), now counted through Channel 3 instead
]);

export const WATCHED_FALLBACK_ONLY_PARKS = new Set(['Thukariyasar', 'Baithwasiya', 'Jasarasar', 'Sheruna']);
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const CLASSIFICATION_RULES = [
  { test: n => n.includes('registration fee'), category: 'Registration Fees', head: 'IAUD' },
  { test: n => n.includes('commission') || n.includes('brokerage'), category: 'Commission', head: 'IAUD' },
  { test: n => n.includes('land registration charges'), category: 'Land Lease Registration', head: 'IAUD' },
  { test: n => n.includes('lease registration'), category: 'Land Lease Registration', head: 'IAUD' },
  { test: n => n.includes('land at'), category: 'Land Lease Expenses', head: 'CWIP' },
  { test: n => n.includes('land lease'), category: 'Land Lease Expenses', head: 'IAUD' },
  { test: n => n.includes('legal') || n.includes('professional') || n.includes('consultancy'), category: 'Legal & Professional Charges', head: 'IAUD' },
  { test: n => n.includes('connectivity'), category: 'Connectivity Charges', head: 'IAUD' },
  { test: n => n.includes('technical service'), category: 'Technical Service', head: 'IAUD', parkException: { 'Panchu': 'CWIP' } },
  { test: n => n.includes('levelling') || n.includes('leveling'), category: 'Land Levelling & Survey', head: 'CWIP' },
  { test: n => n.includes('purchase') || n.includes('civil work') || n.includes('transmission line') || n.includes('cwip') || n.includes('erection') || n.includes('installation') || n.includes('mms') || n.includes('module') || n.includes('inventory asset') || n.includes('other project expenses'), category: 'Purchase', head: 'CWIP' },
  { test: n => n.includes('freight') || n.includes('cartage'), category: 'Rent & Other', head: 'CWIP' },
  { test: n => n.includes('loading') || n.includes('unloading'), category: 'Rent & Other', head: 'CWIP' },
  { test: n => n.includes('imprest'), category: 'Rent & Other', head: 'CWIP' },
  { test: n => n.includes('transportation'), category: 'Rent & Other', head: 'CWIP' },
  { test: n => n.includes('taxi') || n.includes('conveyance'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('boarding'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('rent'), category: 'Rent & Other', head: 'CWIP' },
  { test: n => n.includes('other work'), category: 'Rent & Other', head: 'CWIP' },
  { test: n => n.includes('site expenses'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('security service'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('labour charges') || n.includes('labor charges'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('project approval') || n.includes('govt fees') || n.includes('government fees'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('intangible assets') && !n.includes('development rights'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('intangible asset under development'), category: 'Land Lease Expenses', head: 'IAUD' },
  { test: n => n.includes('consumption') || n.includes('cost of goods sold') || n.includes('work in progress'), category: 'Purchase', head: 'CWIP' },
  { test: n => n.includes('testing fee') || n.includes('inspection charge'), category: 'Technical Service', head: 'CWIP' },
  { test: n => n.includes('retention') || n.includes('security deposit'), category: 'Retention & Deposits', head: 'CWIP' },
  { test: n => n.includes('inventories'), category: 'Purchase', head: 'CWIP' },
  { test: n => n.includes('security manpower'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('vehicle running') || n.includes('vehicle maintenance'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('travelling') || n.includes('traveling'), category: 'Rent & Other', head: 'IAUD' },
];

export function classify(accountName, park, customClassifications = {}) {
  const n = (accountName || '').toLowerCase().trim();
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

export function classifyFlatAccount(flatAccountName, customClassifications = {}) {
  const specific = classify(flatAccountName, null, customClassifications);
  if (specific.category !== 'Unclassified') return specific;
  const n = (flatAccountName || '').toLowerCase();
  if (n === 'capital work in progress') return { category: 'Purchase', head_grouping: 'CWIP' };
  if (n === 'intangible assets - development rights') return { category: 'Land Lease Expenses', head_grouping: 'IAUD' };
  if (n === 'intangible asset under development') return { category: 'Land Lease Expenses', head_grouping: 'IAUD' };
  return { category: 'Unclassified', head_grouping: 'Unclassified' };
}

export const VALID_COMPONENT_SUFFIXES = new Set(['bw', 'land', 'mcr', 'pss', 'tl']);

// The universal amount rule for every transaction, everywhere. Returns
// null when a transaction should be skipped entirely (not shown, not
// counted) — callers must filter these out.
//
// For every non-journal type (bill, Transfer Order, Vendor Credit,
// Invoice, Assemblies, Credit Note, Inventory Adjustment, etc.): the real
// value is debit minus credit — a Transfer Order "in" and its matching
// "out" now genuinely cancel out instead of only the debit side ever
// being counted.
//
// Journals are a deliberate, explicit exception to that same formula —
// never net, never using credit at all:
//   - If a journal only has a credit value (no debit), it's skipped
//     entirely — these are typically capitalisation/reclassification
//     entries, not new spend, and mixing in the credit side would
//     silently zero out real park totals.
//   - If a journal has a genuine debit value, that debit is used as-is
//     (not netted against credit) — still shown, still counted, exactly
//     as an ordinary transaction would be.
// This function does not decide whether a journal should be considered
// at all — Channel 3 (CWIP/IAUD direct scan) ignores every journal before
// this is ever called, regardless of what it would return here.
export function computeTransactionAmount(debit, credit, transactionType) {
  const d = parseFloat(debit) || 0;
  const c = parseFloat(credit) || 0;
  if ((transactionType || '').toLowerCase() === 'journal') {
    return d > 0 ? d : null;
  }
  return d - c;
}

export function matchParkProjects(projects, keywords) {
  return projects.filter(p => {
    const customerName = (p.customer_name || '').toLowerCase();
    const projectName = (p.project_name || '').toLowerCase();

    // MANDATORY, checked first, for every path below. Without this gate,
    // a project could match regardless of which park's keywords were
    // actually passed in — exactly the bug just found and fixed here:
    // "npd" + a generic component suffix (BW/Land/MCR/PSS/TL) is true for
    // nearly every real NPD project, so skipping this check meant almost
    // every project matched almost every park, all at once.
    const hasThisParkKeyword = keywords.some(kw => customerName.includes(kw) || projectName.includes(kw));
    if (!hasThisParkKeyword) return false;

    const isRealParkCustomer = customerName.includes('solar park');
    const isNpdDesignated = projectName.includes('npd');
    const tokens = projectName.split(/[^a-z0-9]+/).filter(Boolean);
    const hasValidComponentSuffix = tokens.some(t => VALID_COMPONENT_SUFFIXES.has(t));

    // Standard, expected shape: a genuine park customer OR an explicit NPD
    // tag, combined with a structured component suffix (BW/Land/MCR/PSS/TL).
    // Covers the vast majority of NPD projects, including ones not yet
    // created — any future "NPD - [Park] - [Component]" project matches
    // automatically with zero code changes needed, regardless of spacing
    // or capitalization (all comparisons here are already lowercase, and
    // token-splitting on any non-alphanumeric character makes this
    // naturally insensitive to hyphen/space formatting differences).
    if ((isRealParkCustomer || isNpdDesignated) && hasValidComponentSuffix) return true;

    // Rare legacy exception: an older, standalone project with no
    // component breakdown at all (e.g. "Kolyat Solar Park NPD"), but
    // explicit enough — both "npd" AND "solar park" in its own project
    // name — that it's very unlikely to be a false positive. The mandatory
    // keyword gate above already scopes this to the correct park.
    if (isNpdDesignated && projectName.includes('solar park')) return true;

    return false;
  });
}

// ── Redis ───────────────────────────────────────────────────────────────
let _redisClient = null;
export async function getRedis() {
  if (_redisClient) return _redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const { Redis } = await import('@upstash/redis');
    _redisClient = new Redis({ url, token });
    return _redisClient;
  } catch {
    return null;
  }
}
export const CACHE_TTL_SECONDS = 600; // fallback/legacy — see getSecondsUntilNext6AMIST for the real daily-cycle TTL

// Seconds remaining until the next 6:00 AM IST (00:30 UTC). Used so the
// shared caches naturally expire right when the cron refresh happens, not
// on a fixed rolling window that would drift out of sync with it.
export function getSecondsUntilNext6AMIST() {
  const now = new Date();
  const nowUTC = now.getTime();
  const next6amUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 30, 0));
  if (next6amUTC.getTime() <= nowUTC) next6amUTC.setUTCDate(next6amUTC.getUTCDate() + 1);
  return Math.floor((next6amUTC.getTime() - nowUTC) / 1000);
}

// ── Rate-limit-aware Zoho fetch wrapper. Zoho's OWN official API docs
//    (zoho.com/books/api/v3/introduction/) confirm: 100 requests per minute
//    per organization, ROLLING window — not a long fixed lockout. Confirmed
//    directly: the real error message Zoho returns ("...blocked as it have
//    exceeded the maximum number of requests per minute...") matches Zoho's
//    documented error code 44 exactly. A short pause (a couple of minutes)
//    should be enough for the rolling window to clear — confirmed by an
//    actual 5-minute wait resolving it in practice. (Earlier guidance in
//    this codebase cited a "20-60 minute" cooldown; that figure was never
//    verified against Zoho's own docs and has been corrected here.) ───────
export class ZohoRateLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ZohoRateLimitError';
  }
}

export async function fetchZohoJson(url, H) {
  const r = await fetch(url, { headers: H });
  const d = await r.json();
  const messageText = (d.message || '').toLowerCase();
  if (r.status === 429 || messageText.includes('too many request') || messageText.includes('rate limit') || messageText.includes('requests per minute')) {
    throw new ZohoRateLimitError(
      `Zoho API rate limit hit (HTTP ${r.status}): "${d.message || 'no message provided'}". ` +
      `Zoho's documented limit is 100 requests/minute per organization, on a rolling window — wait a few minutes (not necessarily long) before retrying.`
    );
  }
  return d;
}

// ── Cached fetch helpers ────────────────────────────────────────────────
export async function fetchAllAccounts(H, ORG) {
  const redis = await getRedis();
  if (redis) { try { const c = await redis.get('npd:cache:coa_accounts'); if (c) return { data: c, cache_status: 'hit' }; } catch { /* fall through */ } }
  let all = [], page = 1, lastFirstId = null;
  while (true) {
    const d = await fetchZohoJson(`https://www.zohoapis.in/books/v3/chartofaccounts?${ORG}&page=${page}&per_page=1000&filter_by=AccountType.All`, H);
    const returned = d.chartofaccounts?.length || 0;
    const firstId = d.chartofaccounts?.[0]?.account_id || null;
    if (d.code !== 0 || returned === 0) break;
    if (firstId && firstId === lastFirstId) break;
    all = all.concat(d.chartofaccounts); lastFirstId = firstId;
    page++; if (page > 15) break;
    await sleep(700);
  }
  // GUARD: never cache a suspiciously small result. We know from months of
  // validation the real Chart of Accounts has 3,300+ entries — anything far
  // below that means the fetch failed (bad token, rate limit, etc.), not
  // that the org genuinely has almost no accounts. Caching a failed fetch's
  // empty result is exactly what caused this class of bug once already.
  const looksReal = all.length >= 1000;
  let writeStatus = redis ? 'not_attempted' : 'no_redis';
  if (redis && looksReal) { try { await redis.set('npd:cache:coa_accounts', all, { ex: getSecondsUntilNext6AMIST() }); writeStatus = 'write_ok'; } catch (e) { writeStatus = `write_failed: ${e.message}`; } }
  else if (redis && !looksReal) writeStatus = `skipped_suspiciously_small_result_count_${all.length}`;
  return { data: all, cache_status: redis ? `miss_${writeStatus}` : 'no_redis' };
}

export async function fetchAllGlAccounts(H, ORG) {
  const redis = await getRedis();
  if (redis) { try { const c = await redis.get('npd:cache:gl_accounts'); if (c) return { data: c, cache_status: 'hit' }; } catch { /* fall through */ } }
  let all = [], page = 1;
  while (true) {
    const d = await fetchZohoJson(`https://www.zohoapis.in/books/v3/reports/generalledger?${ORG}&from_date=2020-04-01&to_date=2026-08-04&page=${page}&per_page=200`, H);
    if (d.code !== 0 || !d.generalledger?.length) break;
    all = all.concat(d.generalledger);
    if (!d.page_context?.has_more_page) break;
    page++; if (page > 5) break;
    await sleep(700);
  }
  const looksReal = all.length >= 1000; // known real size ~3,700+
  let writeStatus = redis ? 'not_attempted' : 'no_redis';
  if (redis && looksReal) { try { await redis.set('npd:cache:gl_accounts', all, { ex: getSecondsUntilNext6AMIST() }); writeStatus = 'write_ok'; } catch (e) { writeStatus = `write_failed: ${e.message}`; } }
  else if (redis && !looksReal) writeStatus = `skipped_suspiciously_small_result_count_${all.length}`;
  return { data: all, cache_status: redis ? `miss_${writeStatus}` : 'no_redis' };
}

export async function fetchAllProjects(H, ORG) {
  const redis = await getRedis();
  if (redis) { try { const c = await redis.get('npd:cache:projects'); if (c) return { data: c, cache_status: 'hit' }; } catch { /* fall through */ } }
  let all = [], page = 1;
  while (true) {
    const d = await fetchZohoJson(`https://www.zohoapis.in/books/v3/projects?${ORG}&page=${page}&per_page=200`, H);
    if (d.code !== 0 || !d.projects?.length) break;
    all = all.concat(d.projects);
    if (!d.page_context?.has_more_page) break;
    page++; if (page > 5) break;
    await sleep(700);
  }
  const looksReal = all.length >= 30; // known real size ~57+
  let writeStatus = redis ? 'not_attempted' : 'no_redis';
  if (redis && looksReal) { try { await redis.set('npd:cache:projects', all, { ex: getSecondsUntilNext6AMIST() }); writeStatus = 'write_ok'; } catch (e) { writeStatus = `write_failed: ${e.message}`; } }
  else if (redis && !looksReal) writeStatus = `skipped_suspiciously_small_result_count_${all.length}`;
  return { data: all, cache_status: redis ? `miss_${writeStatus}` : 'no_redis' };
}

export async function fetchAccountTransactions(H, ORG, accountId, fromDate, toDate) {
  const rule = encodeURIComponent(JSON.stringify({
    columns: [{ index: 1, field: 'account_id', group: 'report', comparator: 'in', value: [accountId] }],
    criteria_string: '1',
  }));
  const url = `https://www.zohoapis.in/books/v3/reports/accounttransaction?${ORG}&from_date=${fromDate}&to_date=${toDate}&rule=${rule}`;
  const d = await fetchZohoJson(url, H);
  const entries = d.account_transactions || [];
  let found = [];
  for (const entry of entries) {
    for (const value of Object.values(entry || {})) {
      if (Array.isArray(value)) found = found.concat(value);
    }
  }
  return found;
}

// Bulk version — asks for MULTIPLE accounts' transactions in a single
// request instead of one request per account. Directly verified against
// real production data before ever being used here: identical transaction
// count and identical total (to the paisa) versus the one-at-a-time
// approach, across 14 real accounts at once. Each returned transaction
// self-identifies its own account_name/account_id — Zoho labels this
// correctly per-row, so there's no risk of misattributing a transaction to
// the wrong account when asking for several at once.
// ⚠ DO NOT USE — FAILED REAL-SCALE VALIDATION. Worked correctly for a small
// park (Jaisalmer, 50 transactions across 14 accounts), but tested against
// Dechu (551 real transactions, 25 accounts) it silently returned only 235
// — likely an internal Zoho response row-cap we never paginated past, with
// zero error to indicate anything was dropped. Kept here (unused) as a
// record of what was tried and why it's not safe as-is — a future version
// would need real pagination handling, tested at Dechu-scale again before
// ever touching production code.
export async function fetchAccountTransactionsBulk(H, ORG, accountIds, fromDate, toDate) {
  if (accountIds.length === 0) return [];
  const rule = encodeURIComponent(JSON.stringify({
    columns: [{ index: 1, field: 'account_id', group: 'report', comparator: 'in', value: accountIds }],
    criteria_string: '1',
  }));
  const url = `https://www.zohoapis.in/books/v3/reports/accounttransaction?${ORG}&from_date=${fromDate}&to_date=${toDate}&rule=${rule}`;
  const d = await fetchZohoJson(url, H);
  const entries = d.account_transactions || [];
  let found = [];
  for (const entry of entries) {
    for (const value of Object.values(entry || {})) {
      if (Array.isArray(value)) found = found.concat(value);
    }
  }
  return found;
}

export async function fetchProjectBills(H, ORG, projectId) {
  const d = await fetchZohoJson(`https://www.zohoapis.in/books/v3/bills?${ORG}&project_id=${projectId}&per_page=200`, H);
  return d.bills || [];
}

// ── Bounded concurrency ─────────────────────────────────────────────────
export async function processBatched(items, batchSize, pauseMs, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + batchSize < items.length) await sleep(pauseMs);
  }
  return results;
}

// ── Period resolution — Indian fiscal year (April 1 – March 31) ──────────
function pad2(n) { return String(n).padStart(2, '0'); }
function lastDayOfMonth(year, month) { return new Date(year, month, 0).getDate(); }

export function resolvePeriod(query) {
  const { period, fy, quarter, year, month, from_date, to_date } = query;
  const today = new Date().toISOString().slice(0, 10);

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
    const toDate = computedToDate > today ? today : computedToDate;
    return { fromDate, toDate, periodLabel: `FY${endYear}` };
  }
  if (period === 'quarterly') {
    const fyEndYear = parseInt(fy, 10);
    const q = parseInt(quarter, 10);
    if (!fyEndYear || ![1, 2, 3, 4].includes(q)) return { error: `period=quarterly requires fy (e.g. 27) and quarter (1-4)` };
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

// ── Derive a narrower period's summary from an already-cached Total-Till-
//    Date dataset, by filtering the already-fetched transactions in memory.
//    This is the key insight that avoids re-hitting Zoho for every period
//    selection: once we have the full transaction list (with real dates on
//    every entry) for a park, ANY narrower date range can be computed
//    entirely locally — zero new API calls needed. ─────────────────────────
export function derivePeriodFromFullData(fullData, fromDate, toDate) {
  const filteredTxns = (fullData.transactions || []).filter(t => (t.date || '') >= fromDate && (t.date || '') <= toDate);
  const total = Math.round(filteredTxns.reduce((s, t) => s + t.amount, 0) * 100) / 100;
  const cwipTotal = Math.round(filteredTxns.filter(t => t.head_grouping === 'CWIP').reduce((s, t) => s + t.amount, 0) * 100) / 100;
  const iaudTotal = Math.round(filteredTxns.filter(t => t.head_grouping === 'IAUD').reduce((s, t) => s + t.amount, 0) * 100) / 100;
  const categoryTotals = {};
  for (const t of filteredTxns) categoryTotals[t.category] = Math.round(((categoryTotals[t.category] || 0) + t.amount) * 100) / 100;
  const unclassifiedCount = filteredTxns.filter(t => t.head_grouping === 'Unclassified').length;
  // account_count for a narrow window = distinct accounts actually touched
  // within it, not the park's total account count (which is period-agnostic)
  const distinctAccountsInWindow = new Set(filteredTxns.map(t => t.account_name).filter(Boolean)).size;
  return {
    account_count: distinctAccountsInWindow,
    transaction_count: filteredTxns.length,
    total, cwip_total: cwipTotal, iaud_total: iaudTotal,
    category_totals: categoryTotals, unclassified_count: unclassifiedCount,
    transactions: filteredTxns,
  };
}

export async function getZohoAuth() {
  const { getAccessToken } = await import('./_tokenCache.js');
  const env = {
    VITE_ZB_CLIENT_ID: process.env.VITE_ZB_CLIENT_ID,
    VITE_ZB_CLIENT_SECRET: process.env.VITE_ZB_CLIENT_SECRET,
    VITE_ZB_REFRESH_TOKEN: process.env.VITE_ZB_REFRESH_TOKEN,
  };
  const { access_token, error } = await getAccessToken(env);
  if (!access_token) return { error };
  const ORG_ID = process.env.VITE_ZB_ORG_ID;
  return { H: { Authorization: `Zoho-oauthtoken ${access_token}` }, ORG: `organization_id=${ORG_ID}` };
}

// Channel 3 — generic account transactions (Capital Work in Progress,
// Intangible Asset Under Development). Unlike Channels 1/2, this is
// naturally company-wide, not park-scoped, so it's fetched once and then
// filtered per park by whichever code calls this. Journal-type entries are
// deliberately skipped for now (mostly internal ledger-transfer
// reclassifications, not new spend) — only bill-type transactions are
// considered. Gajner/Bikaner is explicitly excluded — that location has
// been discarded, not just unmatched.
export const GENERIC_ACCOUNTS = ['Capital Work in Progress', 'Intangible Asset Under Development'];
const EXCLUDED_LOCATIONS = ['gajner', 'bikaner'];

// Inventory Adjustment By Quantity entries have no customer_name or
// project_name at all (a completely different shape from a bill) — the
// only structured park signal available is sometimes the branch/location
// field. When that's genuinely a real park name (confirmed: "Pugal" on
// one real entry), it's used automatically. When it's just "Head Office"
// (confirmed: true for another real entry that genuinely does belong to
// Panchu), there's no automatic signal at all — those need explicit,
// manual confirmation, keyed by the adjustment's own reference_number.
const MANUALLY_MAPPED_INVENTORY_ADJUSTMENTS = {
  '6448': 'Panchu', // Rs 2,10,000 — confirmed: reclassified from Bill RTPC/001/25-26
};

function matchParkFromText(text, keywordsMap) {
  const lower = (text || '').toLowerCase();
  if (EXCLUDED_LOCATIONS.some(loc => lower.includes(loc))) return null;
  for (const [park, keywords] of Object.entries(keywordsMap)) {
    if (keywords.some(kw => lower.includes(kw))) return park;
  }
  return null;
}

// Returns every park whose keywords appear in the text, not just the
// first — lets tier 4 tell a genuinely ambiguous mention (two or more
// parks named in the same item) apart from a clean, single match. Only
// ever matches against the 15 real, tracked parks in keywordsMap — a
// defunct location (Gajner, Bikaner) or another subsidiary's park (Sayla,
// Siwani) can never be "found" here in the first place, since neither is
// a key in that map.
function matchAllParksFromText(text, keywordsMap) {
  const lower = (text || '').toLowerCase();
  const matches = [];
  for (const [park, keywords] of Object.entries(keywordsMap)) {
    if (keywords.some(kw => lower.includes(kw))) matches.push(park);
  }
  return matches;
}

export async function fetchGenericAccountTransactions(H, ORG, allAccounts, allProjects, fromDate, toDate, singleAccountName = null) {
  const results = [];
  const accountsToProcess = singleAccountName ? [singleAccountName] : GENERIC_ACCOUNTS;

  for (const accountName of accountsToProcess) {
    const acct = allAccounts.find(a => (a.account_name || '').toLowerCase() === accountName.toLowerCase());
    if (!acct) continue;
    const headGrouping = accountName === 'Capital Work in Progress' ? 'CWIP' : 'IAUD';

    const rule = encodeURIComponent(JSON.stringify({
      columns: [{ index: 1, field: 'account_id', group: 'report', comparator: 'in', value: [acct.account_id] }],
      criteria_string: '1',
    }));
    const url = `https://www.zohoapis.in/books/v3/reports/accounttransaction?${ORG}&from_date=${fromDate}&to_date=${toDate}&rule=${rule}`;
    const r = await fetchZohoJson(url, H);
    const entries = r.account_transactions || [];
    let allTxns = [];
    for (const e of entries) for (const v of Object.values(e || {})) if (Array.isArray(v)) allTxns = allTxns.concat(v);
    const billTxns = allTxns.filter(t => t.transaction_type === 'bill');

    const attributed = await processBatched(billTxns, 3, 1800, async (t) => {
      const dd = await fetchZohoJson(`https://www.zohoapis.in/books/v3/bills/${t.transaction_id}?${ORG}`, H);
      const bill = dd.bill;
      if (!bill) return [];
      const allLineItems = bill.line_items || [];
      // Every item actually posted to the generic account being scanned —
      // a bill can have several, potentially belonging to different
      // parks, so each is resolved on its own rather than picking just one
      // line item to represent the whole bill.
      const relevantItems = allLineItems.filter(li => li.account_name === accountName);
      if (relevantItems.length === 0) return [];

      // Tier 1 & 2 — per item: customer_name, then project_name.
      const resolved = relevantItems.map(li => {
        const park = matchParkFromText(li.customer_name, PARK_KEYWORDS) || matchParkFromText(li.project_name, PARK_KEYWORDS);
        return { li, park: park || null, tier: park ? 'customer_or_project_name' : null };
      });

      // Tier 3 — the WHOLE BILL's own Custom Field "Project Name",
      // applied to every item tiers 1-2 couldn't resolve. Custom fields
      // on full bill detail live in a nested array, searched by api_name
      // — confirmed this differs from the flattened cf_* fields seen on
      // the bill LIST response.
      if (resolved.some(r => !r.park)) {
        const cfProjectField = (bill.custom_fields || []).find(cf => cf.api_name === 'cf_project_name');
        const cfProjectValue = cfProjectField?.value || cfProjectField?.value_formatted || '';
        const billLevelPark = matchParkFromText(cfProjectValue, PARK_KEYWORDS);
        if (billLevelPark) {
          for (const r of resolved) {
            if (!r.park) { r.park = billLevelPark; r.tier = 'bill_custom_field_project_name'; }
          }
        }
      }

      // Tier 4 — per item, name then description, two passes. Pass A
      // resolves any item with EXACTLY ONE park mentioned. Pass B then
      // revisits genuinely ambiguous items (two or more parks mentioned)
      // using the now-known park of this bill's OTHER, already-resolved
      // items as the tie-break — never guessing outright.
      const ambiguous = [];
      for (const r of resolved) {
        if (r.park) continue;
        const nameMatches = matchAllParksFromText(r.li.name, PARK_KEYWORDS);
        const candidates = nameMatches.length > 0 ? nameMatches : matchAllParksFromText(r.li.description, PARK_KEYWORDS);
        if (candidates.length === 1) {
          r.park = candidates[0];
          r.tier = 'item_name_or_description';
        } else if (candidates.length > 1) {
          ambiguous.push({ r, candidates });
        }
      }
      for (const { r, candidates } of ambiguous) {
        const siblingParks = resolved.filter(x => x !== r && x.park).map(x => x.park);
        const tieBreak = candidates.find(c => siblingParks.includes(c));
        if (tieBreak) { r.park = tieBreak; r.tier = 'item_ambiguous_resolved_via_siblings'; }
      }

      // Tier 5 — the bill's own Notes field, last resort, same
      // applies-to-everything-still-unresolved approach as tier 3.
      if (resolved.some(r => !r.park)) {
        const notesPark = matchParkFromText(bill.notes, PARK_KEYWORDS);
        if (notesPark) {
          for (const r of resolved) {
            if (!r.park) { r.park = notesPark; r.tier = 'bill_notes'; }
          }
        }
      }

      const cls = classifyFlatAccount(accountName, {});
      const out = [];
      for (const { li, park } of resolved) {
        if (park) {
          // Same duplication check as before, now per item — a project_id
          // genuinely belonging to the matched park's own NPD projects
          // means Channel 2 already has this specific item.
          const parkProjects = matchParkProjects(allProjects, PARK_KEYWORDS[park]);
          const parkProjectIds = new Set(parkProjects.map(p => p.project_id));
          if (li.project_id && parkProjectIds.has(li.project_id)) {
            out.push({ skipped_duplicate: true, bill_number: bill.bill_number, park });
            continue;
          }
        }
        out.push({
          date: bill.txn_value_date || bill.date,
          vendor: bill.vendor_name || '',
          transaction_type: 'bill',
          bill_number: bill.bill_number,
          branch: null,
          project_name: li.project_name || null,
          account_name: accountName,
          category: cls.category,
          head_grouping: headGrouping,
          source: 'generic_account_supplemental',
          park: park || 'Unclassified',
          amount: parseFloat(li.item_total) || 0,
        });
      }
      return out;
    });

    for (const itemResults of attributed) {
      for (const item of itemResults) {
        if (item) results.push(item);
      }
    }

    // Any transaction type other than bill or journal — Transfer Order,
    // Vendor Credit, Invoice, Assemblies, Credit Note, Inventory
    // Adjustment, and anything else Zoho might post here. None of these
    // carry customer_name/project_name the way a bill's line items do, so
    // branch/location is the only structured signal available, same
    // approach originally built just for inventory adjustments, now
    // applied to this whole category of transaction.
    const otherTxns = allTxns.filter(t => t.transaction_type !== 'bill' && t.transaction_type !== 'journal');
    const genericCls = classifyFlatAccount(accountName, {});
    for (const t of otherTxns) {
      const amount = computeTransactionAmount(t.debit, t.credit, t.transaction_type);
      if (amount === null) continue; // journals are already excluded above, but stay defensive
      const branchLocation = t.branch?.location_name || '';
      const parkFromBranch = matchParkFromText(branchLocation, PARK_KEYWORDS);
      const park = parkFromBranch || MANUALLY_MAPPED_INVENTORY_ADJUSTMENTS[t.reference_number] || null;

      results.push({
        date: t.date,
        vendor: t.transaction_details || t.transaction_type,
        transaction_type: t.transaction_type,
        bill_number: t.reference_number || null,
        branch: branchLocation || null,
        project_name: null,
        account_name: accountName,
        category: genericCls.category,
        head_grouping: headGrouping,
        source: 'generic_account_supplemental',
        park: park || 'Unclassified',
        amount,
      });
    }
  }

  return results;
}

