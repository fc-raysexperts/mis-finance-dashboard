import {
  PARK_KEYWORDS, NON_NPD_ACCOUNT_TYPES, MANUALLY_EXCLUDED_ACCOUNTS, MANUALLY_EXCLUDED_BILLS, MANUALLY_EXCLUDED_FROM_PARK,
  classify, classifyFlatAccount, matchParkProjects, computeTransactionAmount,
  getRedis, ZohoRateLimitError,
  fetchAllAccounts, fetchAllGlAccounts, fetchAllProjects, fetchAccountTransactions, fetchProjectBills,
  fetchBillDetailCached, RECENT_BILL_DAYS, daysAgoISO,
  processBatched, getZohoAuth,
} from './_npdShared.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate'); // browsers can silently serve a stale cached GET here otherwise (confirmed via DevTools on obInvoiced.js)
  const { park } = req.query;

  // The scheduled refresh (GitHub Actions → scripts/scheduledRefresh.mjs)
  // sends "Authorization: Bearer <CRON_SECRET>" on every call; the same
  // CRON_SECRET value must be set in the Vercel project's environment
  // variables and in the GitHub repo's secrets.
  // Manual/local testing (no CRON_SECRET set) runs unprotected.
//
// ?full=1 (FULL run, 4th Saturday or by hand): every project bill is opened again.
// Without it (NIGHTLY): a project bill is opened only if it has no saved line
// items yet or is dated within the last RECENT_BILL_DAYS days. Account
// transactions and project bill lists are read in full every night either way.
// A full run stops re-opening OLD bills after FULL_REFRESH_BUDGET_MS so a very
// large park can never run into Vercel's 300-second limit (the rest reuse their
// saved line items; the response says so in bill_refresh_budget_hit).
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized — this endpoint is meant to be triggered by the scheduled refresh job only' });
  }
  if (!park || !PARK_KEYWORDS[park]) {
    return res.status(400).json({ error: 'park is required and must be a known park name', valid_parks: Object.keys(PARK_KEYWORDS) });
  }

  const startTime = Date.now();
  const full = req.query.full === '1';
  const recentFrom = daysAgoISO(RECENT_BILL_DAYS);
  const billStats = { opened: 0, reused: 0 };
  const fullRefreshBudgetMs = Number(process.env.NPD_FULL_REFRESH_BUDGET_MS ?? 230_000);
  let budgetHit = false;
  const auth = await getZohoAuth();
  if (auth.error) return res.status(500).json({ error: 'Token failed', detail: auth.error });
  const { H, ORG } = auth;
  const keywords = PARK_KEYWORDS[park];
  const fromDate = '2020-04-01';
  const toDate = new Date().toISOString().slice(0, 10);

  try {
    // Sequential, not parallel — same reasoning as npdAllParksSummary.js.
    const accountsResult = await fetchAllAccounts(H, ORG);
    const glResult = await fetchAllGlAccounts(H, ORG);
    const projectsResult = await fetchAllProjects(H, ORG);
    const accounts = accountsResult.data;
    const glAccounts = glResult.data;
    const projects = projectsResult.data;

    let customClassifications = {};
    const redis = await getRedis();
    if (redis) { try { customClassifications = (await redis.hgetall('npd:custom_classifications')) || {}; } catch { /* non-fatal */ } }

    const parkAccounts = accounts.filter(a => {
      if (NON_NPD_ACCOUNT_TYPES.has(a.account_type)) return false;
      if (MANUALLY_EXCLUDED_ACCOUNTS.has((a.account_name || '').toLowerCase().trim())) return false;
      const cn = (a.account_name || '').toLowerCase();
      const pn = (a.parent_account_name || '').toLowerCase();
      return keywords.some(kw => cn.includes(kw) || pn.includes(kw));
    }).filter(a => {
      const g = glAccounts.find(g => g.name === a.account_name);
      return g && (parseFloat(g.debit_total) || 0) !== 0;
    });

    // REVERTED from bulk fetch — see npdParkTransactions.js for why.
    let allTxns = [];
    const accountResults = await processBatched(parkAccounts, 3, 1600, async (acct) => {
      const txns = await fetchAccountTransactions(H, ORG, acct.account_id, fromDate, toDate);
      const cls = classify(acct.account_name, park, customClassifications);
      return txns
        .map(t => {
          const amount = computeTransactionAmount(t.debit, t.credit, t.transaction_type, t.entity_number);
          if (amount === null) return null; // credit-only journal — skip entirely
          if (MANUALLY_EXCLUDED_FROM_PARK[t.entity_number] === park) return null; // account mistagged to this park — belongs elsewhere via NPD Project
          return {
            date: t.date, vendor: t.transaction_details, transaction_type: t.transaction_type,
            bill_number: t.entity_number, bill_id: t.transaction_id || null, branch: t.branch?.location_name || null,
            project_name: null, account_name: acct.account_name,
            category: cls.category, head_grouping: cls.head_grouping,
            source: 'chart_of_accounts', amount,
          };
        })
        .filter(t => t !== null);
    });
    allTxns = accountResults.flat();
    // FIXED — see npdParkTransactions.js for the full explanation. Two
    // genuinely different bills can share the same bill_number; bill_id
    // is Zoho's own unique identifier and cannot collide this way.
    const coaBillIds = new Set(allTxns.map(t => t.bill_id).filter(Boolean));

    const matchedProjects = matchParkProjects(projects, keywords);
    const parkProjectIds = new Set(matchedProjects.map(p => p.project_id));
    let allNewBills = [];
    for (const proj of matchedProjects) {
      const bills = await fetchProjectBills(H, ORG, proj.project_id);
      // FIXED — filter by Transaction Posting Date, not plain bill date.
      // See npdParkTransactions.js for the full explanation and confirmed
      // real example.
      // Rejected bills never appear in the accounttransaction report — see
      // npdParkTransactions.js for the full explanation and verification.
      const newOnes = bills.filter(b => b.status !== 'rejected' && b.status !== 'void' && !coaBillIds.has(b.bill_id) && !MANUALLY_EXCLUDED_BILLS.has((b.bill_number || '').trim()) && ((b.txn_value_date || b.date) || '') >= fromDate && ((b.txn_value_date || b.date) || '') <= toDate);
      allNewBills = allNewBills.concat(newOnes.map(b => ({ bill: b, projectName: proj.project_name })));
    }
    const uniqueBillsById = new Map();
    for (const entry of allNewBills) uniqueBillsById.set(entry.bill.bill_id, entry);
    allNewBills = [...uniqueBillsById.values()];

    let openedBefore = 0;
    const billResults = await processBatched(allNewBills, 3, 1600, async ({ bill: b, projectName }) => {
      let refresh = ((b.txn_value_date || b.date) || '') >= recentFrom; // recent bills are always opened again
      if (full && !refresh) { if (Date.now() - startTime < fullRefreshBudgetMs) refresh = true; else budgetHit = true; }
      const lineItems = await fetchBillDetailCached(H, ORG, b.bill_id, { refresh, stats: billStats });
      if (lineItems.length === 0) {
        return [{ date: b.txn_value_date || b.date, vendor: b.vendor_name || '', transaction_type: 'bill', bill_number: b.bill_number, branch: null, project_name: projectName, account_name: null, category: 'Unclassified', head_grouping: 'Unclassified', source: 'project_tagged_bill_supplemental', amount: parseFloat(b.total) || 0 }];
      }
      // Only an item whose OWN project_id genuinely matches one of THIS
      // park's discovered NPD projects — see npdParkTransactions.js for
      // the full explanation of why the whole bill was never correct.
      const ownItems = lineItems.filter(li => parkProjectIds.has(li.project_id));
      return ownItems.map(li => {
        const cls = classifyFlatAccount(li.account_name, customClassifications);
        return { date: b.txn_value_date || b.date, vendor: b.vendor_name || '', transaction_type: 'bill', bill_number: b.bill_number, branch: null, project_name: li.project_name || projectName, account_name: li.account_name || null, category: cls.category, head_grouping: cls.head_grouping, source: 'project_tagged_bill_supplemental', amount: parseFloat(li.item_total) || 0 };
      });
    }, () => { const calledZoho = billStats.opened !== openedBefore; openedBefore = billStats.opened; return calledZoho; });
    allTxns = allTxns.concat(billResults.flat());

    // Channel 3 — read-only here, same reasoning as npdParkTransactions.js.
    // Computing it is the dedicated job of npdGenericAccountsRefresh.js,
    // called once per account (CWIP, IAUD, then land lease registration
    // NEW NPD), scheduled to run before the first park's own cron each day.
    let genericAccountResults = [];
    if (redis) {
      try {
        const cwip = await redis.get('npd:cache:generic_accounts_txns:CWIP');
        const iaud = await redis.get('npd:cache:generic_accounts_txns:IAUD');
        const llr = await redis.get('npd:cache:generic_accounts_txns:LLR');
        genericAccountResults = [...(cwip || []), ...(iaud || []), ...(llr || [])];
      } catch { /* proceed without it */ }
    }
    const thisParkGenericTxns = genericAccountResults
      .filter(t => !t.skipped_duplicate && t.park === park);
    allTxns = allTxns.concat(thisParkGenericTxns);

    allTxns.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    const total = Math.round(allTxns.reduce((s, t) => s + t.amount, 0) * 100) / 100;
    const cwipTotal = Math.round(allTxns.filter(t => t.head_grouping === 'CWIP').reduce((s, t) => s + t.amount, 0) * 100) / 100;
    const iaudTotal = Math.round(allTxns.filter(t => t.head_grouping === 'IAUD').reduce((s, t) => s + t.amount, 0) * 100) / 100;
    const categoryTotals = {};
    for (const t of allTxns) categoryTotals[t.category] = Math.round(((categoryTotals[t.category] || 0) + t.amount) * 100) / 100;
    const unclassifiedCount = allTxns.filter(t => t.category === 'Unclassified').length;

    const result = {
      park, from_date: fromDate, to_date: toDate, period_label: 'Total Till Date',
      account_count: parkAccounts.length, transaction_count: allTxns.length,
      total, cwip_total: cwipTotal, iaud_total: iaudTotal,
      category_totals: categoryTotals, unclassified_count: unclassifiedCount,
      transactions: allTxns,
      refreshed_at: new Date().toISOString(),
    };

    let saved = false;
    if (redis) {
      // No expiry: this complete, fresh copy replaces the old one in a single
      // write, and stays until tomorrow's scheduled run replaces it in turn.
      try { await redis.set(`npd:cache:park_full:${park}:Total Till Date`, result); saved = true; }
      catch { /* non-fatal — endpoint still returns the fresh result even if caching fails */ }
      // Period views (FY, quarter, month) are derived on request from the Total
      // copy, so they can never lag behind it. Remove any older period copies
      // left over from before this change.
      if (saved) {
        try {
          let cursor = 0, rounds = 0;
          do {
            const [next, keys] = await redis.scan(cursor, { match: `npd:cache:park_full:${park}:*`, count: 500 });
            const stale = keys.filter(k => !k.endsWith(':Total Till Date'));
            if (stale.length) await redis.del(...stale);
            cursor = Number(next); rounds++;
          } while (cursor !== 0 && rounds < 40);
        } catch { /* non-fatal */ }
      }
    }

    return res.status(200).json({
      ...result, cron_response_time_ms: Date.now() - startTime, cached: saved,
      mode: full ? 'full' : 'nightly', bill_details_opened: billStats.opened, bill_details_reused: billStats.reused, bill_refresh_budget_hit: budgetHit,
    });
  } catch (err) {
    if (err instanceof ZohoRateLimitError) {
      return res.status(429).json({ error: 'RATE_LIMITED', message: err.message, park });
    }
    return res.status(500).json({ error: err.message, stack: err.stack, park });
  }
}
