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
    }
  }

  let deletedCount = 0;
  const errors = [];
  for (const key of keysToDelete) {
    try {
      const result = await redis.del(key);
      if (result) deletedCount++;
    } catch (e) {
      errors.push({ key, error: e.message });
    }
  }

  return res.status(200).json({
    message: 'Cache clear attempted. Note: bill-detail cache (per bill_id) and custom classifications were NOT touched — those are safe to keep.',
    keys_checked: keysToDelete.length,
    keys_actually_deleted: deletedCount,
    errors,
  });
}
