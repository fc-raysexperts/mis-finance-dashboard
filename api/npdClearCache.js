import { getRedis, PARK_KEYWORDS } from './_npdShared.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const redis = await getRedis();
  if (!redis) return res.status(500).json({ error: 'Redis not configured' });

  const keysToDelete = [
    'npd:cache:coa_accounts',
    'npd:cache:gl_accounts',
    'npd:cache:projects',
  ];

  // Also clear every park_full cache across every period we know about —
  // Redis doesn't do wildcard delete on the REST API tier, so we delete the
  // specific keys we know could exist.
  const periodLabels = ['Total Till Date'];
  for (let fy = 25; fy <= 28; fy++) {
    periodLabels.push(`FY20${fy}`);
    for (let q = 1; q <= 4; q++) periodLabels.push(`FY20${fy} Q${q}`);
  }
  // FIXED: monthly-period labels (format "YYYY-MM") were never generated
  // here at all — meaning any cache written for a monthly view could never
  // actually be cleared by this tool, silently, since the key just never
  // appeared in the delete list.
  for (let year = 2024; year <= 2027; year++) {
    for (let month = 1; month <= 12; month++) {
      periodLabels.push(`${year}-${String(month).padStart(2, '0')}`);
    }
  }
  for (const park of Object.keys(PARK_KEYWORDS)) {
    for (const label of periodLabels) {
      keysToDelete.push(`npd:cache:park_full:${park}:${label}`);
      // FIXED — this was the actual reason a real code fix could deploy
      // successfully and still appear to change nothing: the separate,
      // longer-lived (7-day) "last known good" fallback cache was never
      // cleared here. If a live recomputation hit any transient hiccup
      // after a regular clear, the system would correctly (by its own
      // design) fall back to this backup — which could still be full of
      // pre-fix data for up to a week, silently masking whether a fix
      // actually took effect.
      keysToDelete.push(`npd:cache:park_lastknown:${park}:${label}`);
    }
  }
  // Channel 3 (generic account transactions) — a single, company-wide key,
  // not park-scoped, so it doesn't belong inside the per-park loop above.
  // Added when Channel 3 was built; without this, clearing the cache would
  // never actually touch this data at all.
  // Channel 3 now stores CWIP and IAUD as two separate keys (not one
  // combined "Total Till Date" key), so each can be checked and
  // recomputed independently by the dedicated refresh endpoint.
  keysToDelete.push('npd:cache:generic_accounts_txns:CWIP');
  keysToDelete.push('npd:cache:generic_accounts_txns:IAUD');

  // Deletes are independent, lightweight, order-doesn't-matter operations —
  // running them one at a time was the real cause of the timeout once this
  // list doubled in size. Parallel batches of 50 finish far faster while
  // staying reasonable about how many concurrent requests Upstash sees at
  // once, rather than either a slow sequential loop or firing 2000+ requests
  // all in one instant.
  let deletedCount = 0;
  const errors = [];
  const BATCH_SIZE = 50;
  for (let i = 0; i < keysToDelete.length; i += BATCH_SIZE) {
    const batch = keysToDelete.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(key => redis.del(key)));
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled' && r.value) deletedCount++;
      else if (r.status === 'rejected') errors.push({ key: batch[idx], error: r.reason?.message || String(r.reason) });
    });
  }

  return res.status(200).json({
    message: 'Cache clear attempted. Note: bill-detail cache (per bill_id) and custom classifications were NOT touched — those are safe to keep.',
    keys_checked: keysToDelete.length,
    keys_actually_deleted: deletedCount,
    errors,
  });
}
