import {
  getZohoAuth, fetchAllAccounts, fetchAllProjects,
  fetchGenericAccountTransactions, getRedis, getSecondsUntilNext6AMIST,
} from './_npdShared.js';

// Channel 3, as its own dedicated step — deliberately separate from any
// individual park's own load. Since this data is company-wide, not
// park-scoped, it doesn't belong inside any one park's timing — whichever
// park happened to trigger it first would become unpredictably slow. This
// runs once, explicitly, after all 15 parks have already loaded their own
// Chart-of-Accounts and Projects data, and caches the result for every
// park to then pick up in a fast, cache-only second pass.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const auth = await getZohoAuth();
    if (auth.error) return res.status(500).json({ error: 'Token failed', detail: auth.error });
    const { H, ORG } = auth;

    const accountsResult = await fetchAllAccounts(H, ORG);
    const projectsResult = await fetchAllProjects(H, ORG);
    const fromDate = '2020-04-01';
    const toDate = new Date().toISOString().slice(0, 10);

    // Capital Work in Progress first, then Intangible Asset Under
    // Development — the order fetchGenericAccountTransactions itself
    // already follows internally, kept explicit here for clarity.
    const results = await fetchGenericAccountTransactions(H, ORG, accountsResult.data, projectsResult.data, fromDate, toDate);

    const redis = await getRedis();
    if (redis) {
      await redis.set('npd:cache:generic_accounts_txns:Total Till Date', results, { ex: getSecondsUntilNext6AMIST() });
    }

    const included = results.filter(r => !r.skipped_duplicate);
    const skipped = results.filter(r => r.skipped_duplicate);
    const byPark = {};
    for (const item of included) {
      byPark[item.park] = (byPark[item.park] || 0) + item.amount;
    }

    return res.status(200).json({
      message: 'Channel 3 refreshed and cached.',
      total_included: included.length,
      total_skipped_as_duplicate: skipped.length,
      by_park_totals: byPark,
      cached_at: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Unknown error' });
  }
}
