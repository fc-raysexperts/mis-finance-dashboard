import { getAccessToken } from './_tokenCache.js';

const PARK_KEYWORDS = {
  'Jaisalmer':    ['jaisalmer'],
  'Kolayat':      ['kolayat', 'koyalat', 'kolyat'],
  'Dechu':        ['dechu'],
  'Lunkaransar':  ['lunkaransar'],
  'Napasar':      ['napasar'],
  'Panchu':       ['panchu'],
  'Pugal':        ['pugal'],
  'Bhamatsar':    ['bhamatsar'],
  'Sanchore':     ['sanchore', 'sachore'],
  'Tosham':       ['tosham', 'tohsam'],
  'SS Nagar':     ['ss nagar', 's s nagar'],
  'Thukariyasar': ['thukariyasar', 'thukriyasar'],
  'Baithwasiya':  ['baithwasiya'],
  'Jasarasar':    ['jasarasar', 'jasrasar'],
  'Sheruna':      ['sheruna'],
};
const NON_NPD_ACCOUNT_TYPES = new Set(['bank', 'cash']);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Same classification rules as npdParkTransactions.js — kept in sync manually.
const CLASSIFICATION_RULES = [
  { test: n => n.includes('registration fee'), category: 'Registration Fees', head: 'IAUD' },
  { test: n => n.includes('commission') || n.includes('brokerage'), category: 'Commission', head: 'IAUD' },
  { test: n => n.includes('land registration charges'), category: 'Land Lease Registration', head: 'IAUD' },
  { test: n => n.includes('lease registration'), category: 'Land Lease Registration', head: 'IAUD' },
  { test: n => n.includes('land at'), category: 'Land Lease Expenses', head: 'CWIP' },
  { test: n => n.includes('land lease'), category: 'Land Lease Expenses', head: 'IAUD' },
  { test: n => n.includes('legal') || n.includes('professional') || n.includes('consultancy'), category: 'Legal & Professional Charges', head: 'IAUD' },
  { test: n => n.includes('connectivity'), category: 'Connectivity Charges', head: 'IAUD' },
  { test: n => n.includes('technical service'), category: 'Technical Service', head: 'IAUD', parkException: { 'Panchu': 'CWIP' } },
  { test: n => n.includes('levelling') || n.includes('leveling'), category: 'Land Levelling & Survey', head: 'CWIP' },
  { test: n => n.includes('purchase') || n.includes('civil work') || n.includes('transmission line') || n.includes('cwip') || n.includes('erection') || n.includes('installation') || n.includes('mms') || n.includes('module') || n.includes('inventory asset') || n.includes('other project expenses'), category: 'Purchase', head: 'CWIP' },
  { test: n => n.includes('freight') || n.includes('cartage'), category: 'Rent & Other', head: 'CWIP' },
  { test: n => n.includes('loading') || n.includes('unloading'), category: 'Rent & Other', head: 'CWIP' },
  { test: n => n.includes('imprest'), category: 'Rent & Other', head: 'CWIP' },
  { test: n => n.includes('transportation'), category: 'Rent & Other', head: 'CWIP' },
  { test: n => n.includes('taxi') || n.includes('conveyance'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('boarding'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('rent'), category: 'Rent & Other', head: 'CWIP' },
  { test: n => n.includes('other work'), category: 'Rent & Other', head: 'CWIP' },
  { test: n => n.includes('site expenses'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('security service'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('labour charges') || n.includes('labor charges'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('project approval') || n.includes('govt fees') || n.includes('government fees'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('intangible assets') && !n.includes('development rights'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('intangible asset under development'), category: 'Land Lease Expenses', head: 'IAUD' },
  { test: n => n.includes('consumption') || n.includes('cost of goods sold') || n.includes('work in progress'), category: 'Purchase', head: 'CWIP' },
  { test: n => n.includes('testing fee') || n.includes('inspection charge'), category: 'Technical Service', head: 'CWIP' },
  { test: n => n.includes('retention') || n.includes('security deposit'), category: 'Retention & Deposits', head: 'CWIP' },
  { test: n => n.includes('inventories'), category: 'Purchase', head: 'CWIP' },
  { test: n => n.includes('security manpower'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('vehicle running') || n.includes('vehicle maintenance'), category: 'Rent & Other', head: 'IAUD' },
  { test: n => n.includes('travelling') || n.includes('traveling'), category: 'Rent & Other', head: 'IAUD' },
];
function classify(accountName, park) {
  const n = (accountName || '').toLowerCase();
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.test(n)) {
      const head = (rule.parkException && rule.parkException[park]) || rule.head;
      return { category: rule.category, head_grouping: head };
    }
  }
  return { category: 'Unclassified', head_grouping: 'Unclassified' };
}
function classifyFlatAccount(flatAccountName) {
  const specific = classify(flatAccountName, null);
  if (specific.category !== 'Unclassified') return specific;
  const n = (flatAccountName || '').toLowerCase();
  if (n === 'capital work in progress') return { category: 'Purchase', head_grouping: 'CWIP' };
  if (n === 'intangible assets - development rights') return { category: 'Land Lease Expenses', head_grouping: 'IAUD' };
  if (n === 'intangible asset under development') return { category: 'Land Lease Expenses', head_grouping: 'IAUD' };
  return { category: 'Unclassified', head_grouping: 'Unclassified' };
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

  const allCoaAccounts = await fetchAllAccounts(H, ORG);
  const allGlAccounts = await fetchAllGlAccounts(H, ORG);
  const allProjects = await fetchAllProjects(H, ORG);

  // Grouped by distinct (account_name + category) pair, across ALL parks —
  // so the same unclassified account name showing up in 5 different parks
  // gets reviewed ONCE, not 5 times.
  const unclassifiedGrouped = {};

  for (const [park, keywords] of Object.entries(PARK_KEYWORDS)) {
    // CoA channel
    const parkAccounts = allCoaAccounts.filter(a => {
      if (NON_NPD_ACCOUNT_TYPES.has(a.account_type)) return false;
      const cn = (a.account_name || '').toLowerCase();
      const pn = (a.parent_account_name || '').toLowerCase();
      return keywords.some(kw => cn.includes(kw) || pn.includes(kw));
    }).filter(a => {
      const g = allGlAccounts.find(g => g.name === a.account_name);
      return g && (parseFloat(g.debit_total) || 0) !== 0;
    });
    for (const acct of parkAccounts) {
      const cls = classify(acct.account_name, park);
      if (cls.category === 'Unclassified') {
        const g = allGlAccounts.find(g => g.name === acct.account_name);
        const key = `${acct.account_name}__CoA`;
        if (!unclassifiedGrouped[key]) unclassifiedGrouped[key] = { account_name: acct.account_name, source: 'chart_of_accounts', parks: [], total: 0 };
        unclassifiedGrouped[key].parks.push(park);
        unclassifiedGrouped[key].total += g ? parseFloat(g.debit_total) || 0 : 0;
      }
    }

    // Bills-fallback channel
    const matchedProjects = allProjects.filter(p => {
      const customerName = (p.customer_name || '').toLowerCase();
      const projectName = (p.project_name || '').toLowerCase();
      const isRealParkCustomer = keywords.some(kw => customerName.includes(kw)) && customerName.includes('solar park');
      const isNpdDesignated = projectName.includes('npd');
      const tokens = projectName.split(/[^a-z0-9]+/).filter(Boolean);
      const validSuffixes = new Set(['bw', 'land', 'mcr', 'pss', 'tl']);
      const hasValidComponentSuffix = tokens.some(t => validSuffixes.has(t));
      return isRealParkCustomer && isNpdDesignated && hasValidComponentSuffix;
    });
    for (const proj of matchedProjects) {
      const br = await fetch(`https://www.zohoapis.in/books/v3/bills?${ORG}&project_id=${proj.project_id}&per_page=200`, { headers: H });
      const bd = await br.json();
      for (const b of (bd.bills || [])) {
        const dr = await fetch(`https://www.zohoapis.in/books/v3/bills/${b.bill_id}?${ORG}`, { headers: H });
        const dd = await dr.json();
        for (const li of (dd.bill?.line_items || [])) {
          const cls = classifyFlatAccount(li.account_name);
          if (cls.category === 'Unclassified') {
            const key = `${li.account_name}__Bills`;
            if (!unclassifiedGrouped[key]) unclassifiedGrouped[key] = { account_name: li.account_name, source: 'project_tagged_bill_supplemental', parks: [], total: 0 };
            unclassifiedGrouped[key].parks.push(park);
            unclassifiedGrouped[key].total += parseFloat(li.item_total) || 0;
          }
        }
        await sleep(250);
      }
      await sleep(300);
    }
  }

  const results = Object.values(unclassifiedGrouped).map(g => ({
    account_name: g.account_name,
    source: g.source,
    parks_affected: [...new Set(g.parks)],
    total_amount: Math.round(g.total * 100) / 100,
  })).sort((a, b) => b.total_amount - a.total_amount);

  return res.status(200).json({
    total_distinct_unclassified_account_names: results.length,
    total_unclassified_amount: Math.round(results.reduce((s, r) => s + r.total_amount, 0) * 100) / 100,
    findings: results,
  });
}

// ── Same fetch helpers as npdParkTransactions.js, with caching ────────────
async function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const { Redis } = await import('@upstash/redis');
    return new Redis({ url, token });
  } catch {
    return null;
  }
}
async function fetchAllAccounts(H, ORG) {
  const redis = await getRedis();
  if (redis) { try { const c = await redis.get('npd:cache:coa_accounts'); if (c) return c; } catch {} }
  let all = [], page = 1, lastFirstId = null;
  while (true) {
    const r = await fetch(`https://www.zohoapis.in/books/v3/chartofaccounts?${ORG}&page=${page}&per_page=1000&filter_by=AccountType.All`, { headers: H });
    const d = await r.json();
    const returned = d.chartofaccounts?.length || 0;
    const firstId = d.chartofaccounts?.[0]?.account_id || null;
    if (d.code !== 0 || returned === 0) break;
    if (firstId && firstId === lastFirstId) break;
    all = all.concat(d.chartofaccounts); lastFirstId = firstId;
    page++; if (page > 15) break;
    await sleep(400);
  }
  if (redis) { try { await redis.set('npd:cache:coa_accounts', all, { ex: 600 }); } catch {} }
  return all;
}
async function fetchAllGlAccounts(H, ORG) {
  const redis = await getRedis();
  if (redis) { try { const c = await redis.get('npd:cache:gl_accounts'); if (c) return c; } catch {} }
  let all = [], page = 1;
  while (true) {
    const r = await fetch(`https://www.zohoapis.in/books/v3/reports/generalledger?${ORG}&from_date=2020-04-01&to_date=2026-08-04&page=${page}&per_page=200`, { headers: H });
    const d = await r.json();
    if (d.code !== 0 || !d.generalledger?.length) break;
    all = all.concat(d.generalledger);
    if (!d.page_context?.has_more_page) break;
    page++; if (page > 5) break;
    await sleep(400);
  }
  if (redis) { try { await redis.set('npd:cache:gl_accounts', all, { ex: 600 }); } catch {} }
  return all;
}
async function fetchAllProjects(H, ORG) {
  const redis = await getRedis();
  if (redis) { try { const c = await redis.get('npd:cache:projects'); if (c) return c; } catch {} }
  let all = [], page = 1;
  while (true) {
    const r = await fetch(`https://www.zohoapis.in/books/v3/projects?${ORG}&page=${page}&per_page=200`, { headers: H });
    const d = await r.json();
    if (d.code !== 0 || !d.projects?.length) break;
    all = all.concat(d.projects);
    if (!d.page_context?.has_more_page) break;
    page++; if (page > 5) break;
    await sleep(400);
  }
  if (redis) { try { await redis.set('npd:cache:projects', all, { ex: 600 }); } catch {} }
  return all;
}
