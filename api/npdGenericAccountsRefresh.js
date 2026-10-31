import {
  getZohoAuth, fetchAllAccounts, fetchAllGlAccounts, fetchAllProjects,
  fetchGenericAccountTransactions, getRedis,
  PARK_KEYWORDS, GENERIC_ACCOUNTS, RECENT_BILL_DAYS, daysAgoISO,
} from './_npdShared.js';

// Channel 3, one account at a time — called with ?account=cwip or
// ?account=iaud, giving the frontend genuine, separate progress states
// instead of one opaque "loading generic accounts" spinner.
//
// Each call is self-checking: if this specific account's data is already
// saved (the normal case, once the scheduled nightly run has been through),
// it returns almost immediately. Only genuinely computes when that
// account's saved copy is actually missing (first deployment, a cleared
// cache, etc.) — meaning the frontend can always call this first, every
// time, and it naturally resolves fast or slow depending on whether real
// work is needed.
//
// SCHEDULED RUN (GitHub Actions, scripts/scheduledRefresh.mjs) uses two extras:
//   ?account=shared&force=1        — re-fetch Chart of Accounts + GL + Projects
//                                    once, up front, so everything after uses
//                                    fresh inputs
//   ?account=cwip|iaud|llr&force=1 — recompute even though a saved copy exists,
//                                    then replace it. The old copy stays in place
//                                    until the new one is complete. NIGHTLY: bills
//                                    that were resolved before and are older than
//                                    RECENT_BILL_DAYS days are NOT opened again -
//                                    their earlier result is reused. New bills and
//                                    recent bills are opened.
//   ?account=cwip|iaud|llr&force=1&full=1 — FULL run (4th Saturday, or by hand):
//                                    every bill is opened again and the account is
//                                    rebuilt from scratch.
// The nightly run falls back to a full run by itself when there is nothing
// reliable to reuse (first deployment, cleared store, mismatch between the saved
// items and their bookkeeping).
// force=1 / full=1 need the CRON_SECRET bearer token (when CRON_SECRET is set).
const ACCOUNT_KEY_MAP = { cwip: 'Capital Work in Progress', iaud: 'Intangible Asset Under Development', llr: 'land lease registration NEW NPD' };

function requireCronAuth(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: 'Unauthorized — force=1 is only for the scheduled refresh job' });
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate'); // browsers can silently serve a stale cached GET here otherwise (confirmed via DevTools on obInvoiced.js)
  try {
    const accountParam = (req.query.account || '').toLowerCase();
    const force = req.query.force === '1';
    const full = req.query.full === '1';
    if ((force || full) && !requireCronAuth(req, res)) return;

    // Scheduled run, step 1: refresh the three shared inputs (Chart of Accounts,
    // GL, Projects). Each is replaced only if the new fetch looks complete.
    if (accountParam === 'shared') {
      if (!force) return res.status(400).json({ error: 'account=shared needs force=1' });
      const auth = await getZohoAuth();
      if (auth.error) return res.status(500).json({ error: 'Token failed', detail: auth.error });
      const { H, ORG } = auth;
      const coa = await fetchAllAccounts(H, ORG, { force: true });
      const gl = await fetchAllGlAccounts(H, ORG, { force: true });
      const projects = await fetchAllProjects(H, ORG, { force: true });
      return res.status(200).json({
        shared_refreshed: true,
        coa_accounts: coa.data.length, gl_accounts: gl.data.length, projects: projects.data.length,
        saved: [coa.cache_status, gl.cache_status, projects.cache_status].every(s => String(s).endsWith('write_ok')),
        cached_at: new Date().toISOString(),
      });
    }

    const accountName = ACCOUNT_KEY_MAP[accountParam];
    if (!accountName) {
      return res.status(400).json({ error: 'Missing or invalid ?account= — expected "cwip", "iaud", or "llr"' });
    }
    const cacheSubKey = `npd:cache:generic_accounts_txns:${accountParam.toUpperCase()}`;

    const redis = await getRedis();
    if (redis && !force) {
      try {
        const existing = await redis.get(cacheSubKey);
        if (existing) {
          return res.status(200).json({
            account: accountName,
            already_fresh: true,
            entry_count: existing.length,
            message: `${accountName} is already saved — no recomputation needed.`,
          });
        }
      } catch { /* proceed to genuine fetch if the cache read itself fails */ }
    }

    const auth = await getZohoAuth();
    if (auth.error) return res.status(500).json({ error: 'Token failed', detail: auth.error });
    const { H, ORG } = auth;

    const accountsResult = await fetchAllAccounts(H, ORG);
    const projectsResult = await fetchAllProjects(H, ORG);
    const fromDate = '2020-04-01';
    const toDate = new Date().toISOString().slice(0, 10);

    // Nightly (force without full): reuse what was worked out for older bills, if the
    // saved items and their bookkeeping agree. Anything else: full rebuild.
    const metaKey = `npd:meta:generic_accounts:${accountParam.toUpperCase()}`;
    let prev = null, prevMeta = null, mode = 'full';
    if (redis && force && !full) {
      try {
        prevMeta = await redis.get(metaKey);
        const items = await redis.get(cacheSubKey);
        if (prevMeta && Array.isArray(prevMeta.seen) && Array.isArray(items) && prevMeta.items_count === items.length) {
          prev = { items, seen: prevMeta.seen };
          mode = 'incremental';
        }
      } catch { /* no usable bookkeeping -> full */ }
    }

    const stats = {};
    const results = await fetchGenericAccountTransactions(
      H, ORG, accountsResult.data, projectsResult.data, fromDate, toDate, accountName,
      { prev, recentFromDate: daysAgoISO(RECENT_BILL_DAYS), stats },
    );

    let saved = false;
    if (redis) {
      await redis.set(cacheSubKey, results); // no expiry — replaced only by the next complete run
      // bookkeeping goes in AFTER the items, so it can never claim more than the items hold
      const nowIso = new Date().toISOString();
      try {
        await redis.set(metaKey, {
          seen: stats.seenBillIds, items_count: results.length,
          built_at: nowIso, last_full_at: mode === 'full' ? nowIso : (prevMeta?.last_full_at || nowIso),
        });
        saved = true;
      } catch { /* items are saved; without bookkeeping the next nightly run simply does a full rebuild */ }
      // This account genuinely changed. On a normal (on-demand, cold-cache)
      // call, invalidate every park's own Total Till Date copy so the next
      // request for any park recomputes and picks up this fresh data.
      // On the scheduled run (force=1) this is skipped on purpose: every park
      // is recomputed right after this step and overwrites its own old copy,
      // so there is no moment where a park has nothing to show.
      if (!force) {
        for (const park of Object.keys(PARK_KEYWORDS)) {
          try { await redis.del(`npd:cache:park_full:${park}:Total Till Date`); } catch { /* non-fatal */ }
        }
      }
    }

    const included = results.filter(r => !r.skipped_duplicate);
    const skipped = results.filter(r => r.skipped_duplicate);

    return res.status(200).json({
      account: accountName,
      already_fresh: false,
      mode,
      bills_opened: stats.opened, bills_reused: stats.reused,
      saved,
      total_included: included.length,
      total_skipped_as_duplicate: skipped.length,
      cached_at: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
}
