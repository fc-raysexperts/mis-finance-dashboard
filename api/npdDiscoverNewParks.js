import { getAccessToken } from './_tokenCache.js';

// Kept in sync with npdParkTransactions.js — the full list of parks we
// currently recognize. If a "[X] Solar Park" customer shows up in ZB whose
// name doesn't match any keyword here, it's flagged as needing human review
// rather than silently ignored or silently auto-added. Auto-merging spelling
// variants isn't safe without human confirmation — we've hit this exact
// ambiguity three times already (Kolayat/Koyalat/Kolyat all needed manual
// confirmation they were the same real park, not three different ones).
const KNOWN_PARK_KEYWORDS = {
  'Jaisalmer': ['jaisalmer'], 'Kolayat': ['kolayat', 'koyalat', 'kolyat'],
  'Dechu': ['dechu'], 'Lunkaransar': ['lunkaransar'], 'Napasar': ['napasar'],
  'Panchu': ['panchu'], 'Pugal': ['pugal'], 'Bhamatsar': ['bhamatsar'],
  'Sanchore': ['sanchore', 'sachore'], 'Tosham': ['tosham', 'tohsam'],
  'SS Nagar': ['ss nagar', 's s nagar'], 'Thukariyasar': ['thukariyasar', 'thukriyasar'],
  'Baithwasiya': ['baithwasiya'], 'Jasarasar': ['jasarasar', 'jasrasar'], 'Sheruna': ['sheruna'],
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let redisClient = null;
async function getRedis() {
  if (redisClient) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const { Redis } = await import('@upstash/redis');
    redisClient = new Redis({ url, token });
    return redisClient;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const env = {
    VITE_ZB_CLIENT_ID: process.env.VITE_ZB_CLIENT_ID,
    VITE_ZB_CLIENT_SECRET: process.env.VITE_ZB_CLIENT_SECRET,
    VITE_ZB_REFRESH_TOKEN: process.env.VITE_ZB_REFRESH_TOKEN,
  };
  const ORG_ID = process.env.VITE_ZB_ORG_ID;
  const { access_token, error } = await getAccessToken(env);
  if (!access_token) return res.status(500).json({ error: 'Token failed', detail: error });
  const H = { Authorization: `Zoho-oauthtoken ${access_token}` };
  const ORG = `organization_id=${ORG_ID}`;

  // Reuses the SAME Redis cache key as npdParkTransactions.js — if a park
  // query already warmed the cache, this scan is nearly instant.
  const redis = await getRedis();
  let projects;
  if (redis) {
    try { projects = await redis.get('npd:cache:projects'); } catch { /* fall through */ }
  }
  if (!projects) {
    projects = [];
    let page = 1;
    while (true) {
      const r = await fetch(`https://www.zohoapis.in/books/v3/projects?${ORG}&page=${page}&per_page=200`, { headers: H });
      const d = await r.json();
      if (d.code !== 0 || !d.projects?.length) break;
      projects = projects.concat(d.projects);
      if (!d.page_context?.has_more_page) break;
      page++; if (page > 5) break;
      await sleep(400);
    }
    if (redis) { try { await redis.set('npd:cache:projects', projects, { ex: 600 }); } catch { /* non-fatal */ } }
  }

  // Every distinct customer_name ending in "solar park" — the structural
  // signature of a real park entity, same pattern used throughout this
  // investigation to distinguish real parks from unrelated businesses.
  const solarParkCustomers = [...new Set(
    projects.map(p => p.customer_name).filter(n => (n || '').toLowerCase().includes('solar park'))
  )];

  const allKnownKeywords = Object.values(KNOWN_PARK_KEYWORDS).flat();
  const unrecognized = solarParkCustomers.filter(customerName => {
    const n = customerName.toLowerCase();
    return !allKnownKeywords.some(kw => n.includes(kw));
  });

  const flaggedNewParks = [];
  if (redis) {
    for (const customerName of unrecognized) {
      const key = `npd:new_park_pending_review:${customerName}`;
      const alreadyFlagged = await redis.get(key);
      if (!alreadyFlagged) {
        await redis.set(key, { first_detected: new Date().toISOString(), customer_name: customerName });
        await redis.sadd('npd:new_parks_pending_review_set', customerName);
      }
      flaggedNewParks.push(customerName);
    }
  }

  return res.status(200).json({
    total_solar_park_customers_found: solarParkCustomers.length,
    known_park_count: Object.keys(KNOWN_PARK_KEYWORDS).length,
    unrecognized_solar_park_customers: unrecognized,
    flagged_for_review: flaggedNewParks,
    redis_available: !!redis,
    note: unrecognized.length === 0
      ? 'No new park entities detected — every "Solar Park" customer in ZB matches a known park.'
      : `${unrecognized.length} unrecognized park customer(s) found. Confirm each is a genuinely new park (not a spelling variant of an existing one or an unrelated entity), then add its keyword to PARK_KEYWORDS in npdParkTransactions.js and KNOWN_PARK_KEYWORDS here.`,
  });
}
