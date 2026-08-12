import { getRedis } from './_npdShared.js';

const VALID_CATEGORIES = new Set([
  'Registration Fees', 'Commission', 'Land Lease Registration', 'Land Lease Expenses',
  'Legal & Professional Charges', 'Connectivity Charges', 'Purchase', 'Technical Service',
  'Land Levelling & Survey', 'Rent & Other', 'Retention & Deposits',
]);
const VALID_HEAD_GROUPINGS = new Set(['CWIP', 'IAUD']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const redis = await getRedis();
  if (!redis) return res.status(500).json({ error: 'Redis not configured' });

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

  if (req.method === 'DELETE') {
    const accountName = req.query.account_name;
    if (!accountName) return res.status(400).json({ error: 'account_name query param is required' });
    const key = accountName.toLowerCase().trim();
    const deleted = await redis.hdel('npd:custom_classifications', key);
    return res.status(200).json({
      success: true,
      deleted: deleted > 0,
      message: deleted > 0 ? `"${accountName}" removed from custom classifications.` : `"${accountName}" was not found — nothing to delete.`,
    });
  }

  return res.status(405).json({ error: 'Only GET, POST, and DELETE supported' });
}
