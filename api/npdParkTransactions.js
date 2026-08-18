import { getAccessToken } from './_tokenCache.js';
import {
  PARK_KEYWORDS, NON_NPD_ACCOUNT_TYPES, sleep,
  classify, classifyFlatAccount, matchParkProjects,
  getRedis, getSecondsUntilNext6AMIST, fetchZohoJson, ZohoRateLimitError,
  fetchAllAccounts, fetchAllGlAccounts, fetchAllProjects, fetchAccountTransactions, fetchProjectBills,
  processBatched, resolvePeriod, derivePeriodFromFullData,
} from './_npdShared.js';

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

async function checkCoaTransition(park, currentAccountCount) {
  if (!WATCHED_FALLBACK_ONLY_PARKS.has(park)) return null;
  const redis = await getRedis();
  if (!redis) return { warning: 'REDIS_UNAVAILABLE — cannot check for CoA transition, verify manually' };

  const key = `npd:coa_transition_flagged:${park}`;
  const alreadyFlagged = await redis.get(key);

  if (currentAccountCount > 0 && !alreadyFlagged) {
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
  return null;
}

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

  const cacheRedis = await getRedis();
  if (cacheRedis) {
    try {
      const cached = await cacheRedis.get(`npd:cache:park_full:${park}:${periodLabel}`);
      if (cached) {
        return res.status(200).json({ ...cached, served_from_summary_cache: true, response_time_ms: Date.now() - startTime });
      }
      // FIXED — same fix as npdAllParksSummary.js: if this exact period
      // isn't cached, derive it from the already-cached Total Till Date
      // data (every transaction, with real dates, already sitting there)
      // instead of going live. Selecting a different period should never
      // have required a fresh fetch when we already had everything.
      if (periodLabel !== 'Total Till Date') {
        const cachedTotal = await cacheRedis.get(`npd:cache:park_full:${park}:Total Till Date`);
        if (cachedTotal) {
          const derived = derivePeriodFromFullData(cachedTotal, fromDate, toDate);
          // OB/CB — reuses the SAME already-fetched Total data, just a
          // different date slice (everything before this period started).
          // No extra Redis read needed since cachedTotal is already here.
          const dayBefore = new Date(fromDate + 'T00:00:00Z');
          dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
          const dayBeforeStr = dayBefore.toISOString().slice(0, 10);
          const ob = derivePeriodFromFullData(cachedTotal, '2020-04-01', dayBeforeStr);
          const cbCategoryTotals = { ...ob.category_totals };
          for (const [cat, amt] of Object.entries(derived.category_totals || {})) {
            cbCategoryTotals[cat] = Math.round(((cbCategoryTotals[cat] || 0) + amt) * 100) / 100;
          }
          return res.status(200).json({
            park, period_label: periodLabel, from_date: fromDate, to_date: toDate,
            account_count: derived.account_count, transaction_count: derived.transaction_count,
            total: derived.total, cwip_total: derived.cwip_total, iaud_total: derived.iaud_total,
            category_totals: derived.category_totals, unclassified_count: derived.unclassified_count,
            transactions: derived.transactions,
            ob_cwip_total: ob.cwip_total, ob_iaud_total: ob.iaud_total, ob_total: ob.total, ob_category_totals: ob.category_totals,
            cb_cwip_total: Math.round((ob.cwip_total + derived.cwip_total) * 100) / 100,
            cb_iaud_total: Math.round((ob.iaud_total + derived.iaud_total) * 100) / 100,
            cb_total: Math.round((ob.total + derived.total) * 100) / 100,
            cb_category_totals: cbCategoryTotals,
            derived_from_total_cache: true, response_time_ms: Date.now() - startTime,
          });
        }
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
    const accountsResult = await fetchAllAccounts(H, ORG);
    const glResult = await fetchAllGlAccounts(H, ORG);
    const accounts = accountsResult.data;
    const glAccounts = glResult.data;
    const keywords = PARK_KEYWORDS[park];

    if (accounts.length < 1000 || glAccounts.length < 1000) {
      return res.status(502).json({
        error: 'Upstream data looks broken — refusing to compute on top of it',
        detail: { coa_accounts_fetched: accounts.length, gl_accounts_fetched: glAccounts.length },
        note: 'Expected roughly 3300+ CoA accounts, 3700+ GL accounts. If genuinely low, check Zoho auth/token status directly.',
      });
    }

    let customClassifications = {};
    if (cacheRedis) {
      try { customClassifications = (await cacheRedis.hgetall('npd:custom_classifications')) || {}; } catch { /* non-fatal */ }
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

    const accountResults = await processBatched(parkAccounts, 3, 1500, async (acct) => {
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

    const projectsResult = await fetchAllProjects(H, ORG);
    const projects = projectsResult.data;
    const matchedProjects = matchParkProjects(projects, keywords);
    let newFromProjectBills = 0;
    let billDetailCallsMade = 0;
    let allNewBills = [];
    for (const proj of matchedProjects) {
      const bills = await fetchProjectBills(H, ORG, proj.project_id);
      const newOnes = bills.filter(b => !coaBillNumbers.has(b.bill_number) && (b.date || '') >= fromDate && (b.date || '') <= toDate);
      newFromProjectBills += newOnes.length;
      allNewBills = allNewBills.concat(newOnes.map(b => ({ bill: b, projectName: proj.project_name })));
    }

    const billResults = await processBatched(allNewBills, 3, 1500, async ({ bill: b, projectName }) => {
      const dd = await fetchZohoJson(`https://www.zohoapis.in/books/v3/bills/${b.bill_id}?${ORG}`, H);
      billDetailCallsMade++;
      const lineItems = dd.bill?.line_items || [];
      if (lineItems.length === 0) {
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

    // Write back to the shared cache — previously this endpoint only ever
    // READ from it, meaning a park visited directly (before Summary ever
    // cached it) did all this live work and then discarded the opportunity
    // to reuse it, for itself or for Summary later. Now all three paths
    // (cron, Summary, direct Park Detail) mutually benefit from each other.
    if (cacheRedis) {
      try {
        await cacheRedis.set(`npd:cache:park_full:${park}:${periodLabel}`, {
          park, from_date: fromDate, to_date: toDate, period_label: periodLabel,
          account_count: parkAccounts.length, transaction_count: allTxns.length,
          total, cwip_total: cwipTotal, iaud_total: iaudTotal,
          category_totals: categoryTotals, unclassified_count: unclassifiedEntries.length,
          transactions: allTxns, cached_at: new Date().toISOString(),
        }, { ex: getSecondsUntilNext6AMIST() });
      } catch { /* non-fatal — response still returns correctly even if this write fails */ }
    }

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
      supplemental_bill_detail_calls_made: billDetailCallsMade,
      transaction_count: allTxns.length,
      total,
      cwip_total: cwipTotal,
      iaud_total: iaudTotal,
      category_totals: categoryTotals,
      unclassified_count: unclassifiedEntries.length,
      unclassified_entries: unclassifiedEntries.length > 0 ? unclassifiedEntries : undefined,
      coa_transition_warning: coaTransitionWarning,
      pending_new_park_review: pendingNewParkReview,
      // OB/CB genuinely unavailable here — reaching live computation for a
      // non-Total period specifically means we already confirmed no Total
      // cache exists to derive an "everything before this period" figure
      // from, and this live fetch only pulled the requested narrow range,
      // not full history. Total Till Date itself has no OB/CB concept.
      ob_cwip_total: periodLabel !== 'Total Till Date' ? null : undefined,
      ob_iaud_total: periodLabel !== 'Total Till Date' ? null : undefined,
      ob_total: periodLabel !== 'Total Till Date' ? null : undefined,
      ob_category_totals: periodLabel !== 'Total Till Date' ? null : undefined,
      cb_cwip_total: periodLabel !== 'Total Till Date' ? null : undefined,
      cb_iaud_total: periodLabel !== 'Total Till Date' ? null : undefined,
      cb_total: periodLabel !== 'Total Till Date' ? null : undefined,
      cb_category_totals: periodLabel !== 'Total Till Date' ? null : undefined,
      transactions: allTxns,
    });
  } catch (err) {
    if (err instanceof ZohoRateLimitError) {
      return res.status(429).json({ error: 'RATE_LIMITED', message: err.message });
    }
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}
