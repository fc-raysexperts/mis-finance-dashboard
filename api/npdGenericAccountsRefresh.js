import {
  getZohoAuth, fetchAllAccounts, fetchAllProjects,
  fetchGenericAccountTransactions, getRedis, getSecondsUntilNext6AMIST,
  PARK_KEYWORDS, GENERIC_ACCOUNTS,
} from './_npdShared.js';

// Channel 3, one account at a time — called with ?account=cwip or
// ?account=iaud, giving the frontend genuine, separate progress states
// instead of one opaque "loading generic accounts" spinner.
//
// Each call is self-checking: if this specific account's data is already
// cached for today (the normal case, once the daily cron — scheduled
// before any park's own cron — has run), it returns almost immediately.
// Only genuinely computes when that account's cache is actually missing
// (first deployment, a failed cron day, etc.) — meaning the frontend can
// always call this first, every time, and it naturally resolves fast or
// slow depending on whether real work is needed, with no separate
// "check" vs "refresh" logic required on either side.
const ACCOUNT_KEY_MAP = { cwip: 'Capital Work in Progress', iaud: 'Intangible Asset Under Development' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const accountParam = (req.query.account || '').toLowerCase();
    const accountName = ACCOUNT_KEY_MAP[accountParam];
    if (!accountName) {
      return res.status(400).json({ error: 'Missing or invalid ?account= — expected "cwip" or "iaud"' });
    }
    const cacheSubKey = `npd:cache:generic_accounts_txns:${accountParam.toUpperCase()}`;

    const redis = await getRedis();
    if (redis) {
      try {
        const existing = await redis.get(cacheSubKey);
        if (existing) {
          return res.status(200).json({
            account: accountName,
            already_fresh: true,
            entry_count: existing.length,
            message: `${accountName} was already cached for today — no recomputation needed.`,
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

    const results = await fetchGenericAccountTransactions(H, ORG, accountsResult.data, projectsResult.data, fromDate, toDate, accountName);

    if (redis) {
      await redis.set(cacheSubKey, results, { ex: getSecondsUntilNext6AMIST() });
      // This account genuinely changed — invalidate every park's own
      // Total Till Date cache so the next request for any park actually
      // recomputes and picks up this fresh data, rather than continuing
      // to serve whatever was cached before this account was refreshed.
      for (const park of Object.keys(PARK_KEYWORDS)) {
        try { await redis.del(`npd:cache:park_full:${park}:Total Till Date`); } catch { /* non-fatal */ }
      }
    }

    const included = results.filter(r => !r.skipped_duplicate);
    const skipped = results.filter(r => r.skipped_duplicate);

    return res.status(200).json({
      account: accountName,
      already_fresh: false,
      total_included: included.length,
      total_skipped_as_duplicate: skipped.length,
      cached_at: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
}
