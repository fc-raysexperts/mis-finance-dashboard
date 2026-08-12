import { getAccessToken } from './_tokenCache.js';
import {
  PARK_KEYWORDS, NON_NPD_ACCOUNT_TYPES, sleep,
  classify, classifyFlatAccount, matchParkProjects,
  fetchAllAccounts, fetchAllGlAccounts, fetchAllProjects, fetchProjectBills,
} from './_npdShared.js';

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

  // Now uses the SAME guarded, shared fetch functions as everything else —
  // never caches a suspiciously small (likely-failed) result, and shares
  // the daily 6am-reset TTL instead of a stale fixed 10-minute one.
  const accountsResult = await fetchAllAccounts(H, ORG);
  const glResult = await fetchAllGlAccounts(H, ORG);
  const projectsResult = await fetchAllProjects(H, ORG);
  const allCoaAccounts = accountsResult.data;
  const allGlAccounts = glResult.data;
  const allProjects = projectsResult.data;

  if (allCoaAccounts.length < 1000 || allGlAccounts.length < 1000 || allProjects.length < 30) {
    return res.status(502).json({
      error: 'Upstream data looks broken — refusing to scan on top of it',
      detail: { coa_accounts_fetched: allCoaAccounts.length, gl_accounts_fetched: allGlAccounts.length, projects_fetched: allProjects.length },
      note: 'Expected roughly 3300+ CoA accounts, 3700+ GL accounts, 57+ projects. If genuinely low, check Zoho auth/token status directly.',
    });
  }

  // Grouped by distinct (account_name + category) pair, across ALL parks —
  // so the same unclassified account name showing up in 5 different parks
  // gets reviewed ONCE, not 5 times.
  const unclassifiedGrouped = {};

  for (const [park, keywords] of Object.entries(PARK_KEYWORDS)) {
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

    const matchedProjects = matchParkProjects(allProjects, keywords);
    for (const proj of matchedProjects) {
      const bills = await fetchProjectBills(H, ORG, proj.project_id);
      for (const b of bills) {
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
