export const MONTHS = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'];

// Month index → calendar month (0-based): Apr=3, May=4, ... Mar=2
export const IDX_TO_CAL_MONTH = [3,4,5,6,7,8,9,10,11,0,1,2];

export const REV_STRUCTURE = [
  { head: 'Project Revenue', subs: [
    'Project Sales', 'Exports Sales', 'Consultancy Income', 'Lease Income',
  ]},
  { head: 'O&M Revenue', subs: ['Operation And Maintenance'] },
  { head: 'Rooftop EPC Revenue', subs: ['Solar Power Generating System (Rooftop)'] },
  { head: 'Sales of Electricity', subs: ['Generation Income'] },
  { head: 'Other & Indirect Income', subs: [
    'Incentives and Other Income', 'Prior Period Items', 'Interest Income', 'Other Income',
  ]},
];

export const EXP_STRUCTURE = [
  { head: 'Cost of Goods Sold', subs: [
    'Purchases', 'Purchases (Import Goods)', 'Purchases (Custom Duty)',
    'Purchases (O&M)', 'Purchases (Rays Rooftop)', 'Purchases (Others)',
    'Purchases (NPD)', 'New Park Development', 'Civil and Erection Expenses',
    'Transportation Expense', 'Project Management & Technical Services', 'Land Lease Expenses',
  ]},
  { head: 'O&M Expense', subs: [
    'Module Services Expenses (O&M)', 'Security Expenses (O&M)',
  ]},
  { head: 'Change in Inventory', subs: ['Opening Inventories - Closing Inventories'] },
  { head: 'Indirect Expense', subs: [
    'Salaries/Labour Charges and Staff Welfare', 'Finance Costs',
    'Power Purchase Commitment Charges', 'Brokerage and Commission',
    'Government Expenses (Fees)', 'Tender Fee', 'Statutory Fees',
    'Repair & Maintenance Expenses', 'Travelling Expenses',
    'Selling & Marketing Expenses', 'Legal and Consultancy Charges',
    'Rent', 'Office Expenses', 'Other Expenses', 'Electricity Charges Expense',
    'Water Tank Expenses', 'Miscellaneous Expenses', 'Written Off', 'Round Off',
    'Tax Paid Expense', 'Audit Fees Provision Reversal', 'Insurance Charges',
    'Transportation Charges',
  ]},
];

export const ALL_REV_SUBS = REV_STRUCTURE.flatMap(g => g.subs);
export const ALL_EXP_SUBS = EXP_STRUCTURE.flatMap(g => g.subs);

// FY config — auto-expands: add FY28 when Apr 2027 starts, etc.
function buildFYConfig() {
  const base = [
    { id: 'FY25', label: 'FY 25', startYear: 2024 },
    { id: 'FY26', label: 'FY 26', startYear: 2025 },
    { id: 'FY27', label: 'FY 27', startYear: 2026 },
  ];
  const now = new Date();
  let y = 2027;
  let fyNum = 28;
  while (new Date(y, 3, 1) <= now) {
    base.push({ id: `FY${fyNum}`, label: `FY ${fyNum}`, startYear: y });
    y++;
    fyNum++;
  }
  return base;
}
export const FY_CONFIG = buildFYConfig();

// Returns array of visible month objects for a given FY (up to but NOT including current month)
export function getVisibleMonths(fyId) {
  const cfg = FY_CONFIG.find(f => f.id === fyId);
  if (!cfg) return [];
  const now = new Date();
  return MONTHS.map((label, i) => {
    const calMonth = IDX_TO_CAL_MONTH[i];
    const year = i < 9 ? cfg.startYear : cfg.startYear + 1;
    const monthStart = new Date(year, calMonth, 1);
    if (monthStart >= now) return null;
    return { label, idx: i, calMonth, year };
  }).filter(Boolean);
}
