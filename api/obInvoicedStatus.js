import { getRedis, getZohoAuth, getSecondsUntilNext6AMIST, ZohoRateLimitError } from './_npdShared.js';
import { OB_PROJECT_MAP, computeInvoicedForProject, mergeStableAndRecent, sixMonthsAgoISO, TENTATIVE_MATCHES } from './_obShared.js';

// Self-healing, same pattern as npdAllParksSummary.js: read from cache when
// warm, compute live and cache on a miss when cold — NOT pure read-only.
// This is what makes the feature actually work on a branch deployment
// where Vercel Cron never fires (cron only runs against Production), not
// just on main: the first visit of the day (or the first visit ever, right
// after this cache-key change) pays the live-compute cost once, then
// everyone after that gets the fast cached path until the next day.
//
// Batched via ?batch=N (defaults to all) so the frontend can chunk cold-
// start work across a few smaller calls instead of one call risking the
// 300s function timeout when everything is cold at once.
const BATCH_SIZE = 10;

async function getOrCompute(H, ORG, redis, projectId) {
  let stable = null, recent = null;
  if (redis) {
    try { [stable, recent] = await Promise.all([redis.get(`ob:cache:stable:${projectId}`), redis.get(`ob:cache:recent:${projectId}`)]); }
    catch { /* fall through — treat as cold */ }
  }

  // Treat a cached entry from before a field existed (e.g. paidByFY, added
  // for Receipt Amount) the same as genuinely missing — forces exactly one
  // more live recompute per project rather than silently showing 0 for a
  // number the old cache never tracked. Self-healing, no manual reload.
  const isCurrentShape = (d) => d && 'paidByFY' in d;

  if (!isCurrentShape(stable)) {
    // Never finalized (or finalized before this field existed) — full
    // history, same as obInvoicedMonthlyReload.js does for one project.
    // The one genuinely slow path, paid once.
    const today = new Date().toISOString().slice(0, 10);
    const data = await computeInvoicedForProject(H, ORG, projectId, null);
    if (redis) {
      const ttl = getSecondsUntilNext6AMIST() + 3600 * 24 * 40;
      try {
        await redis.set(`ob:cache:stable:${projectId}`, data, { ex: ttl });
        await redis.set(`ob:cache:stableCutoff:${projectId}`, today, { ex: ttl });
        await redis.del(`ob:cache:recent:${projectId}`);
      } catch { /* non-fatal — still return the freshly computed value below */ }
    }
    return mergeStableAndRecent(data, null);
  }

  if (!isCurrentShape(recent)) {
    // Stable exists but today's "since last finalization" slice doesn't —
    // cheap: only whatever's happened since stableCutoff, not full history.
    let cutoff = null;
    if (redis) { try { cutoff = await redis.get(`ob:cache:stableCutoff:${projectId}`); } catch { /* fall through */ } }
    const sinceDate = cutoff || sixMonthsAgoISO();
    const data = await computeInvoicedForProject(H, ORG, projectId, sinceDate);
    if (redis) { try { await redis.set(`ob:cache:recent:${projectId}`, data, { ex: getSecondsUntilNext6AMIST() + 3600 }); } catch { /* non-fatal */ } }
    return mergeStableAndRecent(stable, data);
  }

  // Both warm and current-shape — the fast path, zero Zoho calls, what most of the day looks like.
  return mergeStableAndRecent(stable, recent);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const redis = await getRedis();

  const auth = await getZohoAuth();
  if (auth.error) return res.status(500).json({ error: 'Token failed', detail: auth.error });
  const { H, ORG } = auth;

  const batchParam = req.query?.batch;
  const scope = batchParam
    ? OB_PROJECT_MAP.slice((parseInt(batchParam, 10) - 1) * BATCH_SIZE, parseInt(batchParam, 10) * BATCH_SIZE)
    : OB_PROJECT_MAP;

  // Keyed by projectId, not client name — a rename in investorData.js
  // (even a live one via Edit Outlook Data) never breaks this lookup,
  // since Outlook.jsx now looks up invoiced data by each row's own
  // projectId field, not by its editable display name.
  const entries = [];
  for (const { projectId } of scope) {
    try {
      entries.push([projectId, await getOrCompute(H, ORG, redis, projectId)]);
    } catch (err) {
      if (err instanceof ZohoRateLimitError) {
        return res.status(429).json({ error: 'RATE_LIMITED', message: err.message, completed_before_limit: entries.map(e => e[0]) });
      }
      entries.push([projectId, null]); // this one project's failure doesn't blank out everything else in the batch
    }
  }

  return res.status(200).json({
    invoiced: Object.fromEntries(entries),
    tentative_matches: [...TENTATIVE_MATCHES],
  });
}
