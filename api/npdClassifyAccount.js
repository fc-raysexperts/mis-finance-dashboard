import { Redis } from '@upstash/redis';

const VALID_CATEGORIES = new Set([
  'Registration Fees', 'Commission', 'Land Lease Registration', 'Land Lease Expenses',
  'Legal & Professional Charges', 'Connectivity Charges', 'Purchase', 'Technical Service',
  'Land Levelling & Survey', 'Rent & Other', 'Retention & Deposits',
]);
const VALID_HEAD_GROUPINGS = new Set(['CWIP', 'IAUD']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return res.status(500).json({ error: 'Redis not configured' });
  const redis = new Redis({ url, token });

  if (req.method === 'GET') {
    // List every custom classification saved so far — useful for a
    // "manage saved classifications" view in the eventual UI.
    const all = await redis.hgetall('npd:custom_classifications');
    return res.status(200).json({ custom_classifications: all || {} });
  }

  if (req.method === 'POST') {
    const { account_name, category, head_grouping } = req.body || {};
    if (!account_name || typeof account_name !== 'string') {
      return res.status(400).json({ error: 'account_name is required' });
    }
    if (!VALID_CATEGORIES.has(category)) {
      return res.status(400).json({ error: 'category must be one of the 11 known categories', valid_categories: [...VALID_CATEGORIES] });
    }
    if (!VALID_HEAD_GROUPINGS.has(head_grouping)) {
      return res.status(400).json({ error: 'head_grouping must be CWIP or IAUD' });
    }

    // Keyed by lowercased account_name for consistent matching against
    // whatever casing shows up on future bills.
    const key = account_name.toLowerCase().trim();
    await redis.hset('npd:custom_classifications', {
      [key]: JSON.stringify({ category, head_grouping, original_account_name: account_name, classified_at: new Date().toISOString() }),
    });

    return res.status(200).json({
      success: true,
      message: `"${account_name}" is now permanently classified as ${category} / ${head_grouping}. This applies to every future bill using this exact account name, across every park.`,
    });
  }

  return res.status(405).json({ error: 'Only GET and POST supported' });
}
