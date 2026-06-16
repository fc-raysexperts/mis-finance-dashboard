export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { startDate, endDate } = req.query;
  if (!startDate || !endDate)
    return res.status(400).json({ error: 'startDate and endDate required' });

  const CLIENT_ID     = process.env.VITE_ZB_CLIENT_ID;
  const CLIENT_SECRET = process.env.VITE_ZB_CLIENT_SECRET;
  const REFRESH_TOKEN = process.env.VITE_ZB_REFRESH_TOKEN;
  const ORG_ID        = process.env.VITE_ZB_ORG_ID;

  try {
    // ── 1. Access token ──────────────────────────────────────────────────────
    const tokenRes = await fetch('https://accounts.zoho.in/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: REFRESH_TOKEN, client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET, grant_type: 'refresh_token',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token)
      return res.status(500).json({ error: 'Token failed', detail: tokenData });
    const token   = tokenData.access_token;
    const headers = { Authorization: `Zoho-oauthtoken ${token}` };

    // ── 2. Date calculations ─────────────────────────────────────────────────
    const end          = new Date(endDate);
    const fyStartYear  = end.getMonth() >= 3 ? end.getFullYear() : end.getFullYear() - 1;
    const fyStart      = `${fyStartYear}-04-01`;
    const isFirstMonth = end.getMonth() === 3; // April

    // Use local date components to avoid IST timezone offset bug
    const prevEnd    = new Date(end.getFullYear(), end.getMonth(), 0);
    const prevEndStr = `${prevEnd.getFullYear()}-${String(prevEnd.getMonth()+1).padStart(2,'0')}-${String(prevEnd.getDate()).padStart(2,'0')}`;

    // ── 3. All API calls in parallel ─────────────────────────────────────────
    const [
      ytdCurrent,
      ytdPrev,
      invOI,
      invCI,
      purchases,
      vendorCredits,
      invAdj,
    ] = await Promise.all([
      fetchPL(headers, ORG_ID, fyStart, endDate),
      isFirstMonth ? Promise.resolve(null) : fetchPL(headers, ORG_ID, fyStart, prevEndStr),
      fetchInventoryValuation(headers, ORG_ID, prevEndStr),
      fetchInventoryValuation(headers, ORG_ID, endDate),
      fetchPandLDetail(headers, ORG_ID, startDate, endDate, 'purchase',             'debit'),
      fetchPandLDetail(headers, ORG_ID, startDate, endDate, 'debit_note',           'credit'),
      fetchPandLDetail(headers, ORG_ID, startDate, endDate, 'inventory_adjustment', 'debit'),
    ]);

    if (ytdCurrent.code !== 0)
      return res.status(500).json({ error: 'P&L API error', detail: ytdCurrent });

    // ── 4. Extract ZB Net Profit from P&L response ───────────────────────────
    // Used to correct CEE for COGS (4-01-xxx) + Transfer Order gaps
    const zbNetProfit = extractNetProfit(ytdCurrent, ytdPrev);

    // ── 5. Map P&L accounts to MIS ───────────────────────────────────────────
    const parsedCur  = parsePL(ytdCurrent);
    const parsedPrev = ytdPrev ? parsePL(ytdPrev) : null;
    const result     = mapToMIS(parsedCur, parsedPrev);

    // ── 6. Set Purchases and Inventory ───────────────────────────────────────
    result.exp['Purchases'] = purchases + vendorCredits + invAdj;
    result.exp['Opening Inventories - Closing Inventories'] = invOI - invCI;

    // ── 7. Revenue & Expense corrections using ZB totals ─────────────────────
    // ZB Total Revenue = sum of all revenue account nodes in P&L (monthly)
    // ZB Net Profit    = Net Profit/Loss node in P&L (monthly)
    // ZB Total Expenses = ZB Total Revenue − ZB Net Profit
    //
    // Revenue correction → Other Income  (catches any unmapped revenue accounts)
    // Expense correction → Civil & Erection Expenses (absorbs COGS + TO gap)
    //
    // Result: Our (R−E) = ZB (R−E) = ZB Net Profit exactly

    if (zbNetProfit !== null) {
      // ZB Total Revenue = sum of all revenue account nodes for this month
      // Revenue accounts have codes starting with 3- 
      // Monthly value = parsedCur[key] - parsedPrev[key] (same as mapToMIS does)
      let zbTotalRev = 0;
      for (const [key, curVal] of Object.entries(parsedCur)) {
        if (key.startsWith('3-') || key.startsWith('003-')) {
          const prev = parsedPrev ? (parsedPrev[key] || 0) : 0;
          zbTotalRev += curVal - prev;
        }
      }

      // Our totals after all assignments (including Purchases + Inventory)
      const ourTotalRev = Object.values(result.rev).reduce((s, v) => s + v, 0);
      const ourTotalExp = Object.values(result.exp).reduce((s, v) => s + v, 0);

      // ZB Total Expenses = ZB Total Revenue - ZB Net Profit
      const zbTotalExp = zbTotalRev - zbNetProfit;

      // Revenue correction → Other Income (catches unmapped/new revenue accounts)
      // Expense correction → Civil & Erection Expenses (absorbs COGS + TO gap)
      result.rev['Other Income']                += (zbTotalRev - ourTotalRev);
      result.exp['Civil and Erection Expenses']  += (zbTotalExp - ourTotalExp);
    }

    return res.status(200).json(result);

  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}

// ── Extract Net Profit/Loss from P&L API response ────────────────────────────
// For monthly value: subtract previous month's cumulative net profit
function extractNetProfit(ytdCurrent, ytdPrev) {
  function findNetProfit(plData) {
    if (!plData?.profit_and_loss) return null;
    let val = null;
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      const name = (node.name || '').toLowerCase();
      if (name.includes('net profit') && node.total !== undefined) {
        val = parseFloat(node.total);
      }
      Object.values(node).forEach(v => { if (typeof v === 'object') walk(v); });
    }
    walk(plData.profit_and_loss);
    return val;
  }
  const cur  = findNetProfit(ytdCurrent);
  const prev = ytdPrev ? findNetProfit(ytdPrev) : 0;
  if (cur === null) return null;
  return cur - (prev || 0);
}

// ── Fetch P&L cumulative YTD ──────────────────────────────────────────────────
async function fetchPL(headers, orgId, fromDate, toDate) {
  const r = await fetch(
    `https://www.zohoapis.in/books/v3/reports/profitandloss` +
    `?organization_id=${orgId}&from_date=${fromDate}&to_date=${toDate}`,
    { headers }
  );
  return r.json();
}

// ── Inventory Valuation — sum all asset_value across pages ───────────────────
async function fetchInventoryValuation(headers, orgId, toDate) {
  let total = 0, page = 1;
  while (true) {
    const url =
      `https://www.zohoapis.in/books/v3/reports/inventoryvaluation` +
      `?organization_id=${orgId}&filter_by=TransactionDate.CustomDate` +
      `&to_date=${toDate}&usestate=true&response_option=1&page=${page}&per_page=200`;
    const r    = await fetch(url, { headers });
    const data = await r.json();
    if (data.code !== 0) break;
    const items = data.inventory_valuation?.[0]?.item_details || [];
    for (const item of items) total += parseFloat(item.asset_value) || 0;
    if (!data.page_context?.has_more_page) break;
    page++;
    if (page > 100) break;
  }
  return total;
}

// ── horizontalpandldetails for Purchases, VC, IA ─────────────────────────────
async function fetchPandLDetail(headers, orgId, fromDate, toDate, detailType, netSide) {
  let net = 0, page = 1;
  while (true) {
    const url =
      `https://www.zohoapis.in/books/v3/reports/horizontalpandldetails` +
      `?organization_id=${orgId}&detail_type=${detailType}` +
      `&from_date=${fromDate}&to_date=${toDate}&per_page=200&page=${page}`;
    const r    = await fetch(url, { headers });
    const data = await r.json();
    if (data.code !== 0) break;
    const txns = data.account_transactions?.[0]?.account_transactions || [];
    for (const t of txns) {
      const d = parseFloat(t.debit)  || 0;
      const c = parseFloat(t.credit) || 0;
      net += netSide === 'debit' ? (d - c) : (c - d);
    }
    if (!data.page_context?.has_more_page) break;
    page++;
    if (page > 50) break;
  }
  return net;
}

// ── Parse P&L JSON → flat map: key → cumulative YTD value ────────────────────
function parsePL(plData) {
  const map = {};
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.account_id && node.total !== undefined) {
      const code = (node.account_code || '').trim();
      const name = (node.name || '').trim();
      const key  = code || ('name:' + name.toLowerCase());
      map[key]   = (map[key] || 0) + (parseFloat(node.total) || 0);
    }
    Object.values(node).forEach(v => { if (typeof v === 'object') walk(v); });
  }
  walk(plData.profit_and_loss);
  return map;
}

// ── Revenue mappings ──────────────────────────────────────────────────────────
const CODE_REV = {
  '3-01-001': 'Project Sales',
  '3-01-002': 'Project Sales',
  '3-01-003': 'Project Sales',
  '3-01-004': 'Project Sales',
  '3-01-010': 'Project Sales',
  '3-01-012': 'Project Sales',
  '3-01-013': 'Project Sales',
  '3-01-005': 'Solar Power Generating System (Rooftop)',
  '3-01-006': 'Solar Power Generating System (Rooftop)',
  '3-01-007': 'Generation Income',
  '3-01-008': 'Operation And Maintenance',
  '3-01-009': 'Consultancy Income',
  '3-01-011': 'Lease Income',
  '3-02-001': 'Interest Income',
  '3-02-002': 'Incentives and Other Income',
  '003-02-002': 'Other Income',
};
const NAME_REV = {
  'discount':                      'Other Income',
  'misc. income':                   'Other Income',
  'profit on sale of mutual fund':  'Incentives and Other Income',
  'prior period income':            'Prior Period Items',
  'rounding off - income':          'Other Income',
};

// ── Expense mappings ──────────────────────────────────────────────────────────
// NOTE: 4-01-xxx (Consumption) excluded — ZB P&L API returns FIFO cost not GL entries.
//       The gap (COGS + Transfer Order) is corrected via the Net Profit residual method.
const CODE_EXP = {
  '4-02-001': 'Civil and Erection Expenses',
  '4-02-002': 'Civil and Erection Expenses',
  '4-02-003': 'Civil and Erection Expenses',
  '4-02-004': 'Civil and Erection Expenses',
  '4-02-005': 'Government Expenses (Fees)',
  '4-02-006': 'Project Management & Technical Services',
  '4-02-007': 'Project Management & Technical Services',
  '4-02-008': 'Tender Fee',
  '4-02-009': 'Module Services Expenses (O&M)',
  '4-02-010': 'Security Expenses (O&M)',
  '4-02-010_1': 'Security Expenses (O&M)',
  '4-02-011': 'Land Lease Expenses',
  '4-02-012': 'Land Lease Expenses',
  '4-02-013': 'Power Purchase Commitment Charges',
  '4-02-014': 'Power Purchase Commitment Charges',
  '4-02-015': 'Transportation Expense',   // Freight Inward → COGS section Transport
  '4-02-016': 'Module Services Expenses (O&M)',
  '4-03-001': 'Salaries/Labour Charges and Staff Welfare',
  '4-03-002': 'Salaries/Labour Charges and Staff Welfare',
  '4-03-003': 'Salaries/Labour Charges and Staff Welfare',
  '4-03-004': 'Salaries/Labour Charges and Staff Welfare',
  '4-03-005': 'Salaries/Labour Charges and Staff Welfare',
  '4-03-006': 'Salaries/Labour Charges and Staff Welfare',
  '4-03-007': 'Salaries/Labour Charges and Staff Welfare',
  '4-06-005': 'Salaries/Labour Charges and Staff Welfare',
  '4-04-001': 'Finance Costs',
  '4-04-002': 'Finance Costs',
  '4-04-003': 'Finance Costs',
  '4-04-004': 'Finance Costs',
  // 4-05-xxx (Depreciation) excluded — shown in Monthly P&L only, not Expenses tab
  '4-06-001': 'Audit Fees Provision Reversal',
  '4-06-002': 'Office Expenses',
  '4-06-003': 'Legal and Consultancy Charges',
  '4-06-004': 'Brokerage and Commission',
  '4-06-006': 'Rent',
  '4-06-007': 'Insurance Charges',
  '4-06-008': 'Office Expenses',
  '4-06-009': 'Electricity Charges Expense',
  '4-06-010': 'Water Tank Expenses',
  '4-06-011': 'Office Expenses',
  '4-06-012': 'Office Expenses',
  '4-06-013': 'Office Expenses',
  '4-06-014': 'Office Expenses',
  '4-06-015': 'Other Expenses',
  '4-06-016': 'Selling & Marketing Expenses',
  '4-06-017': 'Selling & Marketing Expenses',
  '4-06-018': 'Selling & Marketing Expenses',
  '4-06-019': 'Travelling Expenses',
  '4-06-020': 'Repair & Maintenance Expenses',
  '4-06-021': 'Travelling Expenses',
  '4-06-022': 'Travelling Expenses',
  '4-06-023': 'Office Expenses',
  '4-06-024': 'Office Expenses',
  '4-06-025': 'Travelling Expenses',
  '4-06-026': 'Office Expenses',
  '4-06-027': 'Written Off',
  '4-06-028': 'Statutory Fees',
  '4-06-029': 'Statutory Fees',
  '4-06-030': 'Statutory Fees',
  '4-06-031': 'Tax Paid Expense',
  '4-06-032': 'Statutory Fees',
  '4-06-033': 'Round Off',
  '4-06-034': 'Transportation Charges',
  '4-06-035': 'Other Expenses',
  '4-06-036': 'Other Expenses',
  '4-07-001': 'Tax Paid Expense',
  '4-07-002': 'Tax Paid Expense',
  '4-07-003': 'Tax Paid Expense',
};
const NAME_EXP = {
  'other expenses':                'Other Expenses',
  'salaries and employee wages':   'Salaries/Labour Charges and Staff Welfare',
  'salaries account':              'Salaries/Labour Charges and Staff Welfare',
  'salary-jaipur':                 'Salaries/Labour Charges and Staff Welfare',
  'security manpower expenses_1':  'Security Expenses (O&M)',
  'it and internet expenses':      'Office Expenses',
  'rates & taxes- ineligible itc': 'Tax Paid Expense',
  'balances written off':          'Written Off',
  'round off':                     'Round Off',
  'rounding off - income':         'Other Income',
};

// ── Map P&L to MIS structure ──────────────────────────────────────────────────
function mapToMIS(cur, prev) {
  const ALL_REV = [
    'Project Sales','Exports Sales','Consultancy Income','Lease Income',
    'Operation And Maintenance','Solar Power Generating System (Rooftop)',
    'Generation Income','Incentives and Other Income','Prior Period Items',
    'Interest Income','Other Income',
  ];
  const ALL_EXP = [
    'Purchases','Purchases (Import Goods)','Purchases (Custom Duty)',
    'Purchases (O&M)','Purchases (Rays Rooftop)','Purchases (Others)',
    'Purchases (NPD)','New Park Development','Civil and Erection Expenses',
    'Transportation Expense','Project Management & Technical Services',
    'Land Lease Expenses','Module Services Expenses (O&M)','Security Expenses (O&M)',
    'Opening Inventories - Closing Inventories',
    'Salaries/Labour Charges and Staff Welfare','Finance Costs',
    'Power Purchase Commitment Charges','Brokerage and Commission',
    'Government Expenses (Fees)','Tender Fee','Statutory Fees',
    'Repair & Maintenance Expenses','Travelling Expenses',
    'Selling & Marketing Expenses','Legal and Consultancy Charges',
    'Rent','Office Expenses','Other Expenses','Electricity Charges Expense',
    'Water Tank Expenses','Miscellaneous Expenses','Written Off','Round Off',
    'Tax Paid Expense','Audit Fees Provision Reversal','Insurance Charges',
    'Transportation Charges','Depreciation',
  ];

  const rev = Object.fromEntries(ALL_REV.map(s => [s, 0]));
  const exp = Object.fromEntries(ALL_EXP.map(s => [s, 0]));

  for (const [key, curVal] of Object.entries(cur)) {
    const val = curVal - (prev ? (prev[key] || 0) : 0);
    if (!val) continue;
    if (CODE_REV[key]) { rev[CODE_REV[key]] += val; continue; }
    if (CODE_EXP[key]) { exp[CODE_EXP[key]] += val; continue; }
    if (key.startsWith('name:')) {
      const n = key.slice(5);
      if (NAME_REV[n]) { rev[NAME_REV[n]] += val; continue; }
      if (NAME_EXP[n]) { exp[NAME_EXP[n]] += val; continue; }
      if (n.includes('salary') || n.includes('salaries') || n.includes('wage'))
        exp['Salaries/Labour Charges and Staff Welfare'] += val;
      else if (n.includes('security'))
        exp['Security Expenses (O&M)'] += val;
      else if (n.includes('depreciation') || n.includes('amortization'))
        exp['Depreciation'] += val;
      else if (n.includes('travel') || n.includes('vehicle'))
        exp['Travelling Expenses'] += val;
      else if (n.includes('internet') || n.includes('telephone') || n.includes('computer'))
        exp['Office Expenses'] += val;
    }
  }
  return { rev, exp };
}
