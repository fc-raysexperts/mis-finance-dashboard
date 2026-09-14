import { getRedis, getSecondsUntilNext6AMIST, getZohoAuth, ZohoRateLimitError } from './_npdShared.js';
import { OB_PROJECT_MAP, computeInvoicedForProject } from './_obShared.js';

// Monthly "finalization" — full history, from scratch, for every project.
// This is what actually keeps the daily crons cheap: it resets each
// project's stableCutoff to today, so tomorrow's daily run only has to
// look at what's happened since. Also the only thing that can catch a late
// correction to an old, already-"finalized" transaction (e.g. a credit
// note issued months after the original invoice).
//
// Cron can't express "2nd Saturday of the month" directly — scheduled to
// fire daily across days 8-14 instead (the range that always contains
// exactly one Saturday, which by definition is always the 2nd one), and
// this check turns every day except that one into a no-op. Pass
// ?force=1 to run on any day regardless — used for the initial bootstrap
// right after deploying this, and for any ad-hoc full refresh later.
const BATCH_SIZE = 10;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized — this endpoint is meant to be triggered by Vercel Cron only' });
  }

  if (req.query?.force !== '1') {
    const isSaturday = new Date().getUTCDay() === 6;
    if (!isSaturday) {
      return res.status(200).json({ skipped: true, reason: 'Not Saturday — no-op until the 2nd Saturday of the month. Pass ?force=1 to override.' });
    }
  }

  const batch = parseInt(req.query?.batch || '1', 10);
  const startIdx = (batch - 1) * BATCH_SIZE;
  const slice = OB_PROJECT_MAP.slice(startIdx, startIdx + BATCH_SIZE);
  const totalBatches = Math.ceil(OB_PROJECT_MAP.length / BATCH_SIZE);
  if (slice.length === 0) {
    return res.status(400).json({ error: `batch ${batch} is out of range — ${OB_PROJECT_MAP.length} projects, ${totalBatches} batches total (1–${totalBatches})` });
  }

  const auth = await getZohoAuth();
  if (auth.error) return res.status(500).json({ error: 'Token failed', detail: auth.error });
  const { H, ORG } = auth;
  const redis = await getRedis();
  const today = new Date().toISOString().slice(0, 10);
  const STABLE_TTL = getSecondsUntilNext6AMIST() + 3600 * 24 * 40; // ~40 days — comfortably past the next monthly run

  const startTime = Date.now();
  const completed = [];
  const errors = [];
  for (const { client, projectId } of slice) {
    try {
      const data = await computeInvoicedForProject(H, ORG, projectId, null); // full history
      completed.push({ client, total: data.total, invoice_count: data.invoice_count, creditnote_count: data.creditnote_count });
      if (redis) {
        try {
          await redis.set(`ob:cache:stable:${projectId}`, data, { ex: STABLE_TTL });
          await redis.set(`ob:cache:stableCutoff:${projectId}`, today, { ex: STABLE_TTL });
          await redis.del(`ob:cache:recent:${projectId}`); // stable now covers through today — nothing left to call "recent"
        } catch (e) { errors.push({ client, stage: 'cache_write', error: e.message }); }
      }
    } catch (err) {
      if (err instanceof ZohoRateLimitError) {
        return res.status(429).json({ error: 'RATE_LIMITED', message: err.message, batch, completed_before_limit: completed.map(c => c.client) });
      }
      errors.push({ client, stage: 'compute', error: err.message });
    }
  }

  return res.status(200).json({
    batch, total_batches: totalBatches, finalized_through: today,
    projects_in_this_batch: slice.length, projects_completed: completed.length,
    completed, errors,
    cached: !!redis,
    duration_ms: Date.now() - startTime,
  });
}
