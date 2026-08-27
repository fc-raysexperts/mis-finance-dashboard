import {
  PARK_KEYWORDS, NON_NPD_ACCOUNT_TYPES,
  classify, classifyFlatAccount, matchParkProjects,
  getRedis, getSecondsUntilNext6AMIST, fetchZohoJson, ZohoRateLimitError,
  fetchAllAccounts, fetchAllGlAccounts, fetchAllProjects, fetchAccountTransactions, fetchProjectBills,
  processBatched, getZohoAuth,
} from './_npdShared.js';

async function fetchBillDetailCached(H, ORG, billId) {
  const redis = await getRedis();
  const cacheKey = `npd:cache:bill_detail:${billId}`;
  if (redis) { try { const c = await redis.get(cacheKey); if (c) return c; } catch { /* fall through */ } }
  const dd = await fetchZohoJson(`https://www.zohoapis.in/books/v3/bills/${billId}?${ORG}`, H);
  const lineItems = dd.bill?.line_items || [];
  if (redis) { try { await redis.set(cacheKey, lineItems, { ex: getSecondsUntilNext6AMIST() * 7 }); } catch { /* non-fatal — bill contents are stable, a week's cache is safe */ } }
  return lineItems;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { park } = req.query;

  // Vercel automatically sends "Authorization: Bearer <CRON_SECRET>" on
  // every real cron invocation, once CRON_SECRET is set in your Vercel env
  // vars (Project Settings → Environment Variables). This is Vercel's own
  // mechanism, not something we invented — verified against current docs.
  // Manual/local testing (no CRON_SECRET set) runs unprotected.
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized — this endpoint is meant to be triggered by Vercel Cron only' });
  }
  if (!park || !PARK_KEYWORDS[park]) {
    return res.status(400).json({ error: 'park is required and must be a known park name', valid_parks: Object.keys(PARK_KEYWORDS) });
  }

  const startTime = Date.now();
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
      return txns.map(t => ({
        date: t.date, vendor: t.transaction_details, transaction_type: t.transaction_type,
        bill_number: t.entity_number, branch: t.branch?.location_name || null,
        project_name: null, account_name: acct.account_name,
        category: cls.category, head_grouping: cls.head_grouping,
        source: 'chart_of_accounts', amount: parseFloat(t.debit) || 0,
      }));
    });
    allTxns = accountResults.flat();
    const coaBillNumbers = new Set(allTxns.map(t => t.bill_number).filter(Boolean));

    const matchedProjects = matchParkProjects(projects, keywords);
    const parkProjectIds = new Set(matchedProjects.map(p => p.project_id));
    let allNewBills = [];
    for (const proj of matchedProjects) {
      const bills = await fetchProjectBills(H, ORG, proj.project_id);
      const newOnes = bills.filter(b => !coaBillNumbers.has(b.bill_number) && (b.date || '') >= fromDate && (b.date || '') <= toDate);
      allNewBills = allNewBills.concat(newOnes.map(b => ({ bill: b, projectName: proj.project_name })));
    }
    const uniqueBillsById = new Map();
    for (const entry of allNewBills) uniqueBillsById.set(entry.bill.bill_id, entry);
    allNewBills = [...uniqueBillsById.values()];

    const billResults = await processBatched(allNewBills, 3, 1600, async ({ bill: b, projectName }) => {
      const lineItems = await fetchBillDetailCached(H, ORG, b.bill_id);
      if (lineItems.length === 0) {
        return [{ date: b.date, vendor: b.vendor_name || '', transaction_type: 'bill', bill_number: b.bill_number, branch: null, project_name: projectName, account_name: null, category: 'Unclassified', head_grouping: 'Unclassified', source: 'project_tagged_bill_supplemental', amount: parseFloat(b.total) || 0 }];
      }
      // Only an item whose OWN project_id genuinely matches one of THIS
      // park's discovered NPD projects — see npdParkTransactions.js for
      // the full explanation of why the whole bill was never correct.
      const ownItems = lineItems.filter(li => parkProjectIds.has(li.project_id));
      return ownItems.map(li => {
        const cls = classifyFlatAccount(li.account_name, customClassifications);
        return { date: b.date, vendor: b.vendor_name || '', transaction_type: 'bill', bill_number: b.bill_number, branch: null, project_name: projectName, account_name: li.account_name || null, category: cls.category, head_grouping: cls.head_grouping, source: 'project_tagged_bill_supplemental', amount: parseFloat(li.item_total) || 0 };
      });
    });
    allTxns = allTxns.concat(billResults.flat());
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

    if (redis) {
      try { await redis.set(`npd:cache:park_full:${park}:Total Till Date`, result, { ex: getSecondsUntilNext6AMIST() + 3600 }); } // small buffer past next 6am in case cron runs a bit late
      catch { /* non-fatal — endpoint still returns the fresh result even if caching fails */ }
    }

    return res.status(200).json({ ...result, cron_response_time_ms: Date.now() - startTime, cached: !!redis });
  } catch (err) {
    if (err instanceof ZohoRateLimitError) {
      return res.status(429).json({ error: 'RATE_LIMITED', message: err.message, park });
    }
    return res.status(500).json({ error: err.message, stack: err.stack, park });
  }
}
