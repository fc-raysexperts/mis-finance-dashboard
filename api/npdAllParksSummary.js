import {
  PARK_KEYWORDS, NON_NPD_ACCOUNT_TYPES, sleep,
  classify, classifyFlatAccount, matchParkProjects,
  getRedis, getSecondsUntilNext6AMIST, fetchZohoJson, ZohoRateLimitError,
  fetchAllAccounts, fetchAllGlAccounts, fetchAllProjects, fetchAccountTransactions, fetchProjectBills,
  processBatched, resolvePeriod, getZohoAuth,
} from './_npdShared.js';

async function fetchBillDetailCached(H, ORG, billId) {
  const redis = await getRedis();
  const cacheKey = `npd:cache:bill_detail:${billId}`;
  if (redis) {
    try { const c = await redis.get(cacheKey); if (c) return c; } catch { /* fall through */ }
  }
  const dd = await fetchZohoJson(`https://www.zohoapis.in/books/v3/bills/${billId}?${ORG}`, H);
  const lineItems = dd.bill?.line_items || [];
  if (redis) { try { await redis.set(cacheKey, lineItems, { ex: getSecondsUntilNext6AMIST() * 7 }); } catch { /* non-fatal */ } }
  return lineItems;
}

export default async function handler(req, res) {
  const startTime = Date.now();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const resolved = resolvePeriod(req.query);
  if (resolved.error) return res.status(400).json({ error: resolved.error });
  const { fromDate, toDate, periodLabel } = resolved;

  const auth = await getZohoAuth();
  if (auth.error) return res.status(500).json({ error: 'Token failed', detail: auth.error });
  const { H, ORG } = auth;

  try {
    const [accountsResult, glResult, projectsResult] = await Promise.all([
      fetchAllAccounts(H, ORG), fetchAllGlAccounts(H, ORG), fetchAllProjects(H, ORG),
    ]);
    const accounts = accountsResult.data;
    const glAccounts = glResult.data;
    const projects = projectsResult.data;

    // GUARD: if the foundational shared data looks broken (far below known
    // real sizes), stop immediately rather than compute — and potentially
    // cache — 15 parks' worth of garbage built on top of a failed fetch.
    // This is what would have caught the incident where a transient Zoho
    // failure silently cached empty results for days.
    if (accounts.length < 1000 || glAccounts.length < 1000 || projects.length < 30) {
      return res.status(502).json({
        error: 'Upstream data looks broken — refusing to compute or cache park summaries on top of it',
        detail: { coa_accounts_fetched: accounts.length, gl_accounts_fetched: glAccounts.length, projects_fetched: projects.length },
        note: 'Expected roughly 3300+ CoA accounts, 3700+ GL accounts, 57+ projects. If these are genuinely low, check Zoho auth/token status directly.',
      });
    }

    let customClassifications = {};
    const redis = await getRedis();
    if (redis) { try { customClassifications = (await redis.hgetall('npd:custom_classifications')) || {}; } catch { /* non-fatal */ } }

    const parkSummaries = {};

    // Accept an optional ?parks=Jaisalmer,Kolayat,... param to process only a
    // subset — this is what lets the frontend split 15 parks' worth of work
    // across several smaller, parallel calls instead of one giant sequential
    // loop that risks exceeding Vercel's 300s function timeout. Defaults to
    // all 15 if not provided (used by the cron and any full-refresh case).
    const requestedParks = req.query.parks
      ? req.query.parks.split(',').map(p => p.trim()).filter(p => PARK_KEYWORDS[p])
      : Object.keys(PARK_KEYWORDS);

    for (const park of requestedParks) {
      // FIXED: check the exact same cache Park Detail already uses, before
      // doing any live work. Previously this loop always recomputed live
      // for every park on every summary request, even when Park Detail was
      // successfully serving that same park+period instantly from cache —
      // meaning Summary was hitting Zoho far more than necessary, which is
      // exactly what made it disproportionately likely to hit rate limits
      // while Park Detail kept working fine.
      const cachedParkFull = redis ? await (async () => {
        try { return await redis.get(`npd:cache:park_full:${park}:${periodLabel}`); } catch { return null; }
      })() : null;

      if (cachedParkFull) {
        parkSummaries[park] = {
          account_count: cachedParkFull.account_count,
          cwip_total: cachedParkFull.cwip_total,
          iaud_total: cachedParkFull.iaud_total,
          total: cachedParkFull.total,
          unclassified_count: cachedParkFull.unclassified_count,
          category_totals: cachedParkFull.category_totals,
        };
        continue; // skip all live computation for this park entirely
      }

      const keywords = PARK_KEYWORDS[park];
      const parkAccounts = accounts.filter(a => {
        if (NON_NPD_ACCOUNT_TYPES.has(a.account_type)) return false;
        const cn = (a.account_name || '').toLowerCase();
        const pn = (a.parent_account_name || '').toLowerCase();
        return keywords.some(kw => cn.includes(kw) || pn.includes(kw));
      }).filter(a => {
        const g = glAccounts.find(g => g.name === a.account_name);
        return g && (parseFloat(g.debit_total) || 0) !== 0;
      });

      // Now collecting the FULL transaction list, not just running sums —
      // this is what lets Park Detail read instantly from cache instead of
      // recomputing. Negligible extra cost: we already fetch this data, this
      // just retains it instead of discarding everything but the total.
      let allTxns = [];

      // CoA channel
      const coaResults = await processBatched(parkAccounts, 3, 1500, async (acct) => {
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
      allTxns = coaResults.flat();
      const coaBillNumbers = new Set(allTxns.map(t => t.bill_number).filter(Boolean));

      // Bills-fallback channel
      const matchedProjects = matchParkProjects(projects, keywords);
      let allNewBills = [];
      for (const proj of matchedProjects) {
        const bills = await fetchProjectBills(H, ORG, proj.project_id);
        const newOnes = bills.filter(b => !coaBillNumbers.has(b.bill_number) && (b.date || '') >= fromDate && (b.date || '') <= toDate);
        allNewBills = allNewBills.concat(newOnes.map(b => ({ bill: b, projectName: proj.project_name })));
      }
      const billResults = await processBatched(allNewBills, 3, 1500, async ({ bill: b, projectName }) => {
        const lineItems = await fetchBillDetailCached(H, ORG, b.bill_id);
        if (lineItems.length === 0) {
          return [{ date: b.date, vendor: b.vendor_name || '', transaction_type: 'bill', bill_number: b.bill_number, branch: null, project_name: projectName, account_name: null, category: 'Unclassified', head_grouping: 'Unclassified', source: 'project_tagged_bill_supplemental', amount: parseFloat(b.total) || 0 }];
        }
        return lineItems.map(li => {
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

      parkSummaries[park] = {
        account_count: parkAccounts.length,
        cwip_total: cwipTotal,
        iaud_total: iaudTotal,
        total,
        unclassified_count: unclassifiedCount,
        category_totals: categoryTotals,
      };

      // Cache the FULL result (including transactions) so Park Detail can
      // read it instantly instead of recomputing. Period-aware key, since
      // results differ by period.
      if (redis) {
        try {
          await redis.set(`npd:cache:park_full:${park}:${periodLabel}`, {
            park, from_date: fromDate, to_date: toDate, period_label: periodLabel,
            account_count: parkAccounts.length, transaction_count: allTxns.length,
            total, cwip_total: cwipTotal, iaud_total: iaudTotal,
            category_totals: categoryTotals, unclassified_count: unclassifiedCount,
            transactions: allTxns, cached_at: new Date().toISOString(),
          }, { ex: getSecondsUntilNext6AMIST() });
        } catch { /* non-fatal — summary still returns correctly even if this write fails */ }
      }
    }

    // Grand totals (the "Sum" column)
    const allCategories = new Set();
    Object.values(parkSummaries).forEach(p => Object.keys(p.category_totals).forEach(c => allCategories.add(c)));
    const sumRow = { cwip_total: 0, iaud_total: 0, total: 0, category_totals: {} };
    for (const cat of allCategories) sumRow.category_totals[cat] = 0;
    for (const p of Object.values(parkSummaries)) {
      sumRow.cwip_total += p.cwip_total;
      sumRow.iaud_total += p.iaud_total;
      sumRow.total += p.total;
      for (const [cat, amt] of Object.entries(p.category_totals)) sumRow.category_totals[cat] += amt;
    }
    sumRow.cwip_total = Math.round(sumRow.cwip_total * 100) / 100;
    sumRow.iaud_total = Math.round(sumRow.iaud_total * 100) / 100;
    sumRow.total = Math.round(sumRow.total * 100) / 100;
    for (const k in sumRow.category_totals) sumRow.category_totals[k] = Math.round(sumRow.category_totals[k] * 100) / 100;

    return res.status(200).json({
      period_label: periodLabel,
      from_date: fromDate,
      to_date: toDate,
      response_time_ms: Date.now() - startTime,
      parks: parkSummaries,
      sum: sumRow,
    });
  } catch (err) {
    if (err instanceof ZohoRateLimitError) {
      return res.status(429).json({ error: 'RATE_LIMITED', message: err.message });
    }
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}
