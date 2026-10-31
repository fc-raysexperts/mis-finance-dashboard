import { getRedis, getZohoAuth, ZohoRateLimitError } from './_npdShared.js';
import { OB_PROJECT_MAP, computeInvoicedForProject, mergeStableAndRecent, sixMonthsAgoISO, TENTATIVE_MATCHES } from './_obShared.js';

// Consolidated from 4 separate files (obInvoicedRefreshBatch.js,
// obInvoicedMonthlyReload.js, obInvoicedRefreshOne.js, obInvoicedStatus.js)
// into this one, dispatched by ?mode= — purely to stay under Vercel's
// Hobby-plan cap of 12 serverless functions per deployment; each mode's
// logic below is otherwise unchanged from its original file. Modes:
//   ?mode=daily&batch=N    — scheduled (GitHub Actions), recent-only (was obInvoicedRefreshBatch.js)
//   ?mode=monthly&batch=N  — scheduled (GitHub Actions), full finalization (was obInvoicedMonthlyReload.js)
//   ?mode=one&client=X (or &projectId=X) — on-demand single project (was obInvoicedRefreshOne.js)
//   ?mode=status&batch=N   — frontend read, self-healing (was obInvoicedStatus.js) — default if mode omitted
//   ?mode=peek             — frontend read, cache-only, never calls Zoho — all projects in one fast call
//                            (one Redis round trip). Also lists which projects/batches have nothing
//                            saved, so the browser calls mode=status ONLY for those and not at all
//                            when everything is saved. (The nightly mode=daily run reads a project's
//                            full history once if it has no finalized copy yet, so after the first
//                            night nothing is ever missing.)
//
// CACHE RULE: nothing saved here expires. Each project's saved figures stay on
// screen until the scheduled run has fully recomputed that project and
// overwrites them in one write.
const BATCH_SIZE = 5;

function requireCronAuth(req, res) {
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: 'Unauthorized — this endpoint is meant to be triggered by the scheduled refresh job only' });
    return false;
  }
  return true;
}

function batchSlice(batchParam) {
  const batch = parseInt(batchParam || '1', 10);
  const startIdx = (batch - 1) * BATCH_SIZE;
  const slice = OB_PROJECT_MAP.slice(startIdx, startIdx + BATCH_SIZE);
  const totalBatches = Math.ceil(OB_PROJECT_MAP.length / BATCH_SIZE);
  return { batch, slice, totalBatches };
}

// ── mode=daily — was obInvoicedRefreshBatch.js ──────────────────────────
async function handleDaily(req, res) {
  if (!requireCronAuth(req, res)) return;
  const { batch, slice, totalBatches } = batchSlice(req.query?.batch);
  if (slice.length === 0) {
    return res.status(400).json({ error: `batch ${batch} is out of range — ${OB_PROJECT_MAP.length} projects, ${totalBatches} batches total (1–${totalBatches})` });
  }

  const auth = await getZohoAuth();
  if (auth.error) return res.status(500).json({ error: 'Token failed', detail: auth.error });
  const { H, ORG } = auth;
  const redis = await getRedis();

  const startTime = Date.now();
  const completed = [];
  const errors = [];
  let firstFullReads = 0;
  for (const { client, projectId } of slice) {
    try {
      // A project with NO finalized (stable) copy yet - first deployment, cleared
      // store, or an older saved shape - gets its full history read once, exactly
      // as the monthly run would. Without this, the browser would have to work
      // that out itself the first time somebody opens the Order Book tab.
      let hasStable = false;
      if (redis) { try { const st = await redis.get(`ob:cache:stable:${projectId}`); hasStable = !!(st && 'paidByFY' in st); } catch { /* treat as absent */ } }
      if (!hasStable && redis) {
        const full = await computeInvoicedForProject(H, ORG, projectId, null);
        const today = new Date().toISOString().slice(0, 10);
        try {
          await redis.set(`ob:cache:stable:${projectId}`, full);
          await redis.set(`ob:cache:stableCutoff:${projectId}`, today);
          await redis.del(`ob:cache:recent:${projectId}`);
        } catch (e) { errors.push({ client, stage: 'cache_write', error: e.message }); }
        completed.push({ client, since: 'full history (first read)', total: full.total, invoice_count: full.invoice_count, creditnote_count: full.creditnote_count });
        firstFullReads++;
        continue;
      }

      let cutoff = null;
      if (redis) { try { cutoff = await redis.get(`ob:cache:stableCutoff:${projectId}`); } catch { /* fall through */ } }
      const sinceDate = cutoff || sixMonthsAgoISO();

      const data = await computeInvoicedForProject(H, ORG, projectId, sinceDate);
      completed.push({ client, since: sinceDate, total: data.total, invoice_count: data.invoice_count, creditnote_count: data.creditnote_count });
      if (redis) {
        try { await redis.set(`ob:cache:recent:${projectId}`, data); }
        catch (e) { errors.push({ client, stage: 'cache_write', error: e.message }); }
      }
    } catch (err) {
      if (err instanceof ZohoRateLimitError) {
        return res.status(429).json({ error: 'RATE_LIMITED', message: err.message, batch, completed_before_limit: completed.map(c => c.client) });
      }
      errors.push({ client, stage: 'compute', error: err.message });
    }
  }

  return res.status(200).json({
    mode: 'daily', batch, total_batches: totalBatches,
    projects_in_this_batch: slice.length, projects_completed: completed.length, first_full_reads: firstFullReads,
    completed, errors, cached: !!redis, duration_ms: Date.now() - startTime,
  });
}

// ── mode=monthly — was obInvoicedMonthlyReload.js ───────────────────────
async function handleMonthly(req, res) {
  if (!requireCronAuth(req, res)) return;

  if (req.query?.force !== '1') {
    const isSaturday = new Date().getUTCDay() === 6;
    if (!isSaturday) {
      return res.status(200).json({ skipped: true, reason: 'Not Saturday — no-op until the 2nd Saturday of the month. Pass ?force=1 to override.' });
    }
  }

  const { batch, slice, totalBatches } = batchSlice(req.query?.batch);
  if (slice.length === 0) {
    return res.status(400).json({ error: `batch ${batch} is out of range — ${OB_PROJECT_MAP.length} projects, ${totalBatches} batches total (1–${totalBatches})` });
  }

  const auth = await getZohoAuth();
  if (auth.error) return res.status(500).json({ error: 'Token failed', detail: auth.error });
  const { H, ORG } = auth;
  const redis = await getRedis();
  const today = new Date().toISOString().slice(0, 10);

  const startTime = Date.now();
  const completed = [];
  const errors = [];
  for (const { client, projectId } of slice) {
    try {
      const data = await computeInvoicedForProject(H, ORG, projectId, null);
      completed.push({ client, total: data.total, invoice_count: data.invoice_count, creditnote_count: data.creditnote_count });
      if (redis) {
        try {
          await redis.set(`ob:cache:stable:${projectId}`, data);
          await redis.set(`ob:cache:stableCutoff:${projectId}`, today);
          await redis.del(`ob:cache:recent:${projectId}`);
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
    mode: 'monthly', batch, total_batches: totalBatches, finalized_through: today,
    projects_in_this_batch: slice.length, projects_completed: completed.length,
    completed, errors, cached: !!redis, duration_ms: Date.now() - startTime,
  });
}

// ── mode=one — was obInvoicedRefreshOne.js ──────────────────────────────
async function handleOne(req, res) {
  if (!requireCronAuth(req, res)) return;

  const clientParam = req.query?.client;
  const projectIdParam = req.query?.projectId;
  if (!clientParam && !projectIdParam) {
    return res.status(400).json({ error: 'client or projectId query param is required' });
  }
  const entry = projectIdParam
    ? OB_PROJECT_MAP.find(p => p.projectId === projectIdParam)
    : OB_PROJECT_MAP.find(p => p.client === clientParam);
  if (!entry) {
    return res.status(404).json({
      error: projectIdParam ? `No project mapped for projectId "${projectIdParam}"` : `No project mapped for client "${clientParam}"`,
      known_projects: OB_PROJECT_MAP.map(p => ({ client: p.client, projectId: p.projectId })),
    });
  }

  const auth = await getZohoAuth();
  if (auth.error) return res.status(500).json({ error: 'Token failed', detail: auth.error });
  const { H, ORG } = auth;
  const redis = await getRedis();
  const today = new Date().toISOString().slice(0, 10);

  const data = await computeInvoicedForProject(H, ORG, entry.projectId, null);

  if (redis) {
    await redis.set(`ob:cache:stable:${entry.projectId}`, data);
    await redis.set(`ob:cache:stableCutoff:${entry.projectId}`, today);
    await redis.del(`ob:cache:recent:${entry.projectId}`);
  }

  return res.status(200).json({
    mode: 'one', client: entry.client, projectId: entry.projectId, finalized_through: today,
    total: data.total, byFY: data.byFY, paidTotal: data.paidTotal, paidByFY: data.paidByFY,
    invoice_count: data.invoice_count, creditnote_count: data.creditnote_count, cached: !!redis,
  });
}

// ── mode=status (default) — was obInvoicedStatus.js ─────────────────────
async function getOrCompute(H, ORG, redis, projectId) {
  let stable = null, recent = null;
  if (redis) {
    try { [stable, recent] = await Promise.all([redis.get(`ob:cache:stable:${projectId}`), redis.get(`ob:cache:recent:${projectId}`)]); }
    catch { /* fall through — treat as cold */ }
  }

  const isCurrentShape = (d) => d && 'paidByFY' in d;

  if (!isCurrentShape(stable)) {
    const today = new Date().toISOString().slice(0, 10);
    const data = await computeInvoicedForProject(H, ORG, projectId, null);
    if (redis) {
      try {
        await redis.set(`ob:cache:stable:${projectId}`, data);
        await redis.set(`ob:cache:stableCutoff:${projectId}`, today);
        await redis.del(`ob:cache:recent:${projectId}`);
      } catch { /* non-fatal — still return the freshly computed value below */ }
    }
    return mergeStableAndRecent(data, null);
  }

  if (!isCurrentShape(recent)) {
    let cutoff = null;
    if (redis) { try { cutoff = await redis.get(`ob:cache:stableCutoff:${projectId}`); } catch { /* fall through */ } }
    const sinceDate = cutoff || sixMonthsAgoISO();
    const data = await computeInvoicedForProject(H, ORG, projectId, sinceDate);
    if (redis) { try { await redis.set(`ob:cache:recent:${projectId}`, data); } catch { /* non-fatal */ } }
    return mergeStableAndRecent(stable, data);
  }

  return mergeStableAndRecent(stable, recent);
}

// The one call the Order Book tab makes when it opens. Everything is read from
// the saved copy in ONE round trip (all projects' keys together), and the
// answer says exactly which projects have nothing usable saved, so the browser
// only asks the slower self-healing call (mode=status) for those - and for
// nothing at all when every project is already saved (the normal case once the
// nightly run has been through).
async function handlePeek(req, res) {
  const redis = await getRedis();
  const isCurrentShape = (d) => d && 'paidByFY' in d;
  const keys = OB_PROJECT_MAP.flatMap(({ projectId }) => [`ob:cache:stable:${projectId}`, `ob:cache:recent:${projectId}`]);
  let values = keys.map(() => null);
  if (redis) {
    try {
      values = typeof redis.mget === 'function' ? await redis.mget(...keys) : await Promise.all(keys.map((k) => redis.get(k)));
    } catch { /* leave everything null - the browser will fall back to the self-healing call */ }
  }
  const entries = [];
  const missing = [];            // projects with no finalized (stable) copy at all
  OB_PROJECT_MAP.forEach(({ projectId }, i) => {
    const stable = values[i * 2], recent = values[i * 2 + 1];
    // No recent copy next to a stable one is normal (right after the monthly full read,
    // before the next nightly run): the stable copy alone is the complete picture.
    if (!isCurrentShape(stable)) { entries.push([projectId, null]); missing.push(projectId); return; }
    entries.push([projectId, mergeStableAndRecent(stable, isCurrentShape(recent) ? recent : null)]);
  });
  const missingSet = new Set(missing);
  const missingBatches = [];
  const totalBatches = Math.ceil(OB_PROJECT_MAP.length / BATCH_SIZE);
  for (let b = 1; b <= totalBatches; b++) {
    if (OB_PROJECT_MAP.slice((b - 1) * BATCH_SIZE, b * BATCH_SIZE).some((p) => missingSet.has(p.projectId))) missingBatches.push(b);
  }
  return res.status(200).json({
    invoiced: Object.fromEntries(entries),
    missing_projects: missing,
    missing_batches: missingBatches,
    total_batches: totalBatches,
  });
}

async function handleStatus(req, res) {
  const redis = await getRedis();
  const auth = await getZohoAuth();
  if (auth.error) return res.status(500).json({ error: 'Token failed', detail: auth.error });
  const { H, ORG } = auth;

  const batchParam = req.query?.batch;
  const scope = batchParam
    ? OB_PROJECT_MAP.slice((parseInt(batchParam, 10) - 1) * BATCH_SIZE, parseInt(batchParam, 10) * BATCH_SIZE)
    : OB_PROJECT_MAP;

  const entries = [];
  for (const { projectId } of scope) {
    try {
      entries.push([projectId, await getOrCompute(H, ORG, redis, projectId)]);
    } catch (err) {
      if (err instanceof ZohoRateLimitError) {
        return res.status(429).json({ error: 'RATE_LIMITED', message: err.message, completed_before_limit: entries.map(e => e[0]) });
      }
      entries.push([projectId, null]);
    }
  }

  return res.status(200).json({
    invoiced: Object.fromEntries(entries),
    tentative_matches: [...TENTATIVE_MATCHES],
  });
}

// ── dispatch ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Without this, browsers can — and, as confirmed via DevTools, actually do
  // — serve a stale cached copy of these responses (HTTP 304) instead of
  // hitting this handler's real logic at all. Every mode here reflects
  // live-ish, Redis-backed state that changes over time, so none of it is
  // ever safe to cache client-side.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const mode = req.query?.mode || 'status';
  switch (mode) {
    case 'daily': return handleDaily(req, res);
    case 'monthly': return handleMonthly(req, res);
    case 'one': return handleOne(req, res);
    case 'status': return handleStatus(req, res);
    case 'peek': return handlePeek(req, res);
    default: return res.status(400).json({ error: `Unknown mode "${mode}" — expected daily, monthly, one, or status` });
  }
}
