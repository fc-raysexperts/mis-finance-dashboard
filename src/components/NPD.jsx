import React, { useState, useEffect } from 'react';
import { fmt } from '../utils.js';
import { NPDParkCostChart } from './Charts.jsx';
import { downloadNPDExcel } from '../npdExcelExport.js';

const PARK_LIST = [
  'Jaisalmer', 'Kolayat', 'Dechu', 'Lunkaransar', 'Napasar', 'Panchu', 'Pugal',
  'Bhamatsar', 'Sanchore', 'Tosham', 'SS Nagar', 'Thukariyasar',
  'Baithwasiya', 'Jasarasar', 'Sheruna',
];
const CATEGORIES = [
  'Registration Fees', 'Commission', 'Land Lease Registration', 'Land Lease Expenses',
  'Legal & Professional Charges', 'Connectivity Charges', 'Purchase', 'Technical Service',
  'Land Levelling & Survey', 'Rent & Other', 'Retention & Deposits',
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Vertical divider after every 3rd park column — computed from position, not
// a hardcoded park-name list, so this automatically keeps working as new
// parks get added via the discovery system, with zero further changes.
// Deliberately never applied to the LAST column, even if divisible by 3 —
// a divider "after the last park" only makes sense once a park actually
// exists to its right.
const parkColStyle = (index) => ((index + 1) % 3 === 0 && index < PARK_LIST.length - 1) ? { borderRight: '1.5px solid #94a3b8' } : {};

function buildPeriodQuery({ periodType, fy, quarter, year, month }) {
  if (periodType === 'yearly') return `period=yearly&fy=${fy}`;
  if (periodType === 'quarterly') return `period=quarterly&fy=${fy}&quarter=${quarter}`;
  if (periodType === 'monthly') return `period=monthly&year=${year}&month=${month}`;
  return 'period=total';
}

function getPeriodLabel({ periodType, fy, quarter, year, month }) {
  if (periodType === 'yearly') return `FY20${fy}`;
  if (periodType === 'quarterly') return `FY20${fy}_Q${quarter}`;
  if (periodType === 'monthly') return `${year}-${String(month).padStart(2, '0')}`;
  return 'Total_Till_Date';
}

// Round-robin into 4 chunks so the heaviest parks (Dechu, Lunkaransar,
// Panchu) land in DIFFERENT chunks rather than clustering together — keeps
// each chunk's total work roughly balanced instead of one chunk being much
// slower than the others.
const PARK_CHUNKS = [0, 1, 2, 3].map(offset => PARK_LIST.filter((_, i) => i % 4 === offset));

function mergeSummaryChunks(chunkResults) {
  const parks = {};
  for (const chunk of chunkResults) Object.assign(parks, chunk.parks || {});

  const allCategories = new Set();
  Object.values(parks).forEach(p => Object.keys(p.category_totals || {}).forEach(c => allCategories.add(c)));
  const sum = { cwip_total: 0, iaud_total: 0, total: 0, category_totals: {} };
  for (const cat of allCategories) sum.category_totals[cat] = 0;
  for (const p of Object.values(parks)) {
    sum.cwip_total += p.cwip_total || 0;
    sum.iaud_total += p.iaud_total || 0;
    sum.total += p.total || 0;
    for (const [cat, amt] of Object.entries(p.category_totals || {})) sum.category_totals[cat] += amt;
  }
  sum.cwip_total = Math.round(sum.cwip_total * 100) / 100;
  sum.iaud_total = Math.round(sum.iaud_total * 100) / 100;
  sum.total = Math.round(sum.total * 100) / 100;
  for (const k in sum.category_totals) sum.category_totals[k] = Math.round(sum.category_totals[k] * 100) / 100;

  return { parks, sum };
}

export default function NPD() {
  const [periodType, setPeriodType] = useState('total');
  const [fy, setFy] = useState(27);
  const [quarter, setQuarter] = useState(1);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(8);

  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(null);

  const [selectedPark, setSelectedPark] = useState('Dechu');
  const [parkDetail, setParkDetail] = useState(null);
  const [parkDetailLoading, setParkDetailLoading] = useState(false);
  const [parkDetailError, setParkDetailError] = useState(null);

  const periodQuery = buildPeriodQuery({ periodType, fy, quarter, year, month });
  const periodLabel = getPeriodLabel({ periodType, fy, quarter, year, month });

  const [excelExporting, setExcelExporting] = useState(false);
  const [excelProgress, setExcelProgress] = useState('');

  async function handleDownloadExcel() {
    if (!summary || excelExporting) return;
    setExcelExporting(true);
    setExcelProgress('Starting…');
    try {
      await downloadNPDExcel({
        summary, periodQuery, periodLabel,
        onProgress: (done, total, park) => setExcelProgress(`Fetching ${park} (${done}/${total})…`),
      });
    } catch (e) {
      setExcelProgress('');
      alert(`Excel export failed: ${e.message}`);
    } finally {
      setExcelExporting(false);
      setExcelProgress('');
    }
  }

  const [summaryChunksLoaded, setSummaryChunksLoaded] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSummaryLoading(true); setSummaryError(null); setSummaryChunksLoaded(0);

    (async () => {
      // Sequential, not parallel — this was the real gap. Each chunk's own
      // pacing is safe in isolation, but 4 chunks running truly in parallel
      // on a fully cold cache (e.g. the very first visit of the day, before
      // any cache exists) combine to exceed Zoho's shared 100/min limit,
      // even though no single chunk was ever unsafe on its own. Slower on a
      // cold cache, but reliably stays under the real limit — and once a
      // working cron is live on production, a fully cold cache should be a
      // rare edge case rather than the normal first-visit-of-the-day state.
      const settledResults = [];
      for (const chunk of PARK_CHUNKS) {
        if (cancelled) return;
        try {
          const r = await fetch(`/api/npdAllParksSummary?${periodQuery}&parks=${chunk.map(encodeURIComponent).join(',')}`);
          const d = await r.json();
          if (d.error === 'RATE_LIMITED') throw new Error(d.message); if (d.error) throw new Error(d.error);
          if (!cancelled) setSummaryChunksLoaded(n => n + 1);
          settledResults.push({ status: 'fulfilled', value: d });
        } catch (e) {
          settledResults.push({ status: 'rejected', reason: e });
        }
      }
      if (cancelled) return;

      const successful = settledResults
        .map((r, i) => ({ result: r, chunk: PARK_CHUNKS[i] }))
        .filter(x => x.result.status === 'fulfilled');
      const failed = settledResults
        .map((r, i) => ({ result: r, chunk: PARK_CHUNKS[i] }))
        .filter(x => x.result.status === 'rejected');

      if (successful.length > 0) {
        setSummary(mergeSummaryChunks(successful.map(x => x.result.value)));
      }
      if (failed.length > 0) {
        const missingParks = failed.flatMap(x => x.chunk).join(', ');
        const reason = failed[0].result.reason?.message || 'unknown error';
        setSummaryError(
          `${failed.length} of ${PARK_CHUNKS.length} groups failed to load — missing parks: ${missingParks}. ` +
          `${successful.length > 0 ? 'Showing the parks that did load successfully below.' : ''} Reason: ${reason}`
        );
      }
      setSummaryLoading(false);
    })();

    return () => { cancelled = true; };
  }, [periodQuery]);

  useEffect(() => {
    if (summaryLoading) return;
    let cancelled = false;
    setParkDetailLoading(true); setParkDetailError(null);
    fetch(`/api/npdParkTransactions?park=${encodeURIComponent(selectedPark)}&${periodQuery}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (d.error === 'RATE_LIMITED') throw new Error(d.message); if (d.error) throw new Error(d.error);
        setParkDetail(d);
      })
      .catch(e => { if (!cancelled) setParkDetailError(e.message); })
      .finally(() => { if (!cancelled) setParkDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedPark, periodQuery, summaryLoading]);

  const sum = summary?.sum;
  const parks = summary?.parks || {};

  return (
    <div className="tab-content">
      {/* Period selector */}
      <div className="cmp-header-bar">
        <span className="cmp-main-title">New Park Development</span>
        <div className="cmp-selector-wrap">
          <button
            className="mo-select"
            onClick={handleDownloadExcel}
            disabled={!summary || excelExporting}
            style={{ cursor: (!summary || excelExporting) ? 'not-allowed' : 'pointer', opacity: (!summary || excelExporting) ? 0.6 : 1 }}
          >
            {excelExporting ? (excelProgress || 'Generating…') : '⬇ Download Excel File'}
          </button>
          <label className="cmp-selector-label">Period:</label>
          <select className="mo-select" value={periodType} onChange={e => setPeriodType(e.target.value)}>
            <option value="total">Total Till Date</option>
            <option value="yearly">Yearly</option>
            <option value="quarterly">Quarterly</option>
            <option value="monthly">Monthly</option>
          </select>
          {periodType === 'yearly' && (
            <select className="mo-select" value={fy} onChange={e => setFy(Number(e.target.value))}>
              {[25, 26, 27].map(y => <option key={y} value={y}>FY{y}</option>)}
            </select>
          )}
          {periodType === 'quarterly' && (
            <>
              <select className="mo-select" value={fy} onChange={e => setFy(Number(e.target.value))}>
                {[25, 26, 27].map(y => <option key={y} value={y}>FY{y}</option>)}
              </select>
              <select className="mo-select" value={quarter} onChange={e => setQuarter(Number(e.target.value))}>
                {[1, 2, 3, 4].map(q => <option key={q} value={q}>Q{q}</option>)}
              </select>
            </>
          )}
          {periodType === 'monthly' && (
            <>
              <select className="mo-select" value={year} onChange={e => setYear(Number(e.target.value))}>
                {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <select className="mo-select" value={month} onChange={e => setMonth(Number(e.target.value))}>
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </>
          )}
        </div>
      </div>

      {/* ── Summary tables ── */}
      {summaryLoading && (
        <div className="npd-loading">
          <span className="npd-spinner" /> Loading summary — {summaryChunksLoaded}/{PARK_CHUNKS.length} groups done (loaded one at a time to stay under Zoho's rate limit — can take a while on a fully cold cache)…
        </div>
      )}
      {summaryError && <div className="error-banner">⚠ {summaryError}</div>}

      {summaryError && summary && (
        <div className="npd-loading" style={{ background: '#fff7ed', borderColor: '#fdba74', color: '#c2410c' }}>
          ⚠ The tables below may be incomplete or from an earlier load — see the error above for what's missing and why.
        </div>
      )}
      {summary && !summaryLoading && (
        <>
          <div className="tbl-wrap no-scroll npd-park-table">
            <table>
              <thead>
                <tr>
                  <th className="col-head" colSpan={2}>Head Grouping</th>
                  {PARK_LIST.map((p, i) => <th key={p} className="col-num" style={parkColStyle(i)}>{p}</th>)}
                  <th className="col-num col-total-hd">Sum</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="col-head" colSpan={2}>CWIP</td>
                  {PARK_LIST.map((p, i) => <td key={p} className="col-num" style={parkColStyle(i)}>{fmt(parks[p]?.cwip_total || 0)}</td>)}
                  <td className="col-num col-total-val">{fmt(sum?.cwip_total || 0)}</td>
                </tr>
                <tr>
                  <td className="col-head" colSpan={2}>IAUD</td>
                  {PARK_LIST.map((p, i) => <td key={p} className="col-num" style={parkColStyle(i)}>{fmt(parks[p]?.iaud_total || 0)}</td>)}
                  <td className="col-num col-total-val">{fmt(sum?.iaud_total || 0)}</td>
                </tr>
                <tr className="row-section-total">
                  <td className="col-head" colSpan={2}>Total</td>
                  {PARK_LIST.map((p, i) => <td key={p} className="col-num" style={parkColStyle(i)}>{fmt(parks[p]?.total || 0)}</td>)}
                  <td className="col-num col-total-val">{fmt(sum?.total || 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="tbl-wrap no-scroll npd-park-table" style={{ marginTop: 16 }}>
            <table>
              <thead>
                <tr>
                  <th className="col-head" colSpan={2}>Category</th>
                  {PARK_LIST.map((p, i) => <th key={p} className="col-num" style={parkColStyle(i)}>{p}</th>)}
                  <th className="col-num col-total-hd">Sum</th>
                </tr>
              </thead>
              <tbody>
                {CATEGORIES.map(cat => (
                  <tr key={cat}>
                    <td className="col-head" colSpan={2}>{cat}</td>
                    {PARK_LIST.map((p, i) => <td key={p} className="col-num" style={parkColStyle(i)}>{fmt(parks[p]?.category_totals?.[cat] || 0)}</td>)}
                    <td className="col-num col-total-val">{fmt(sum?.category_totals?.[cat] || 0)}</td>
                  </tr>
                ))}
                {sum?.category_totals?.['Unclassified'] > 0 && (
                  <tr className="npd-unclassified-row">
                    <td className="col-head" colSpan={2}>Unclassified</td>
                    {PARK_LIST.map((p, i) => <td key={p} className="col-num" style={parkColStyle(i)}>{fmt(parks[p]?.category_totals?.['Unclassified'] || 0)}</td>)}
                    <td className="col-num col-total-val">{fmt(sum.category_totals['Unclassified'])}</td>
                  </tr>
                )}
                <tr className="row-section-total">
                  <td className="col-head" colSpan={2}>Total</td>
                  {PARK_LIST.map((p, i) => <td key={p} className="col-num" style={parkColStyle(i)}>{fmt(parks[p]?.total || 0)}</td>)}
                  <td className="col-num col-total-val">{fmt(sum?.total || 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <NPDParkCostChart
            parks={PARK_LIST}
            cwipValues={PARK_LIST.map(p => parks[p]?.cwip_total || 0)}
            iaudValues={PARK_LIST.map(p => parks[p]?.iaud_total || 0)}
          />
        </>
      )}

      {/* ── Park detail section ── */}
      <div className="cmp-header-bar" style={{ marginTop: 24 }}>
        <span className="cmp-main-title">Park Detail</span>
        <div className="cmp-selector-wrap">
          <label className="cmp-selector-label">Park:</label>
          <select className="mo-select" value={selectedPark} onChange={e => setSelectedPark(e.target.value)}>
            {PARK_LIST.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {summaryLoading && (
        <div className="npd-loading">
          <span className="npd-spinner" /> Waiting for the summary above to finish first…
        </div>
      )}
      {!summaryLoading && parkDetailLoading && (
        <div className="npd-loading">
          <span className="npd-spinner" /> Loading {selectedPark}'s detail…
        </div>
      )}
      {parkDetailError && <div className="error-banner">⚠ {parkDetailError}</div>}

      {parkDetail && !parkDetailLoading && (
        <>
          <div className="kpi-row" style={{ marginTop: 14 }}>
            <div className="kpi-card"><div className="kpi-value">₹{fmt(parkDetail.total)}</div><div className="kpi-label">Total</div></div>
            <div className="kpi-card"><div className="kpi-value">₹{fmt(parkDetail.cwip_total)}</div><div className="kpi-label">CWIP</div></div>
            <div className="kpi-card"><div className="kpi-value">₹{fmt(parkDetail.iaud_total)}</div><div className="kpi-label">IAUD</div></div>
            <div className="kpi-card"><div className="kpi-value">{parkDetail.transaction_count}</div><div className="kpi-label">Transactions</div></div>
          </div>

          {parkDetail.coa_transition_warning && (
            <div className="error-banner">⚠ {parkDetail.coa_transition_warning.message}</div>
          )}
          {parkDetail.pending_new_park_review && (
            <div className="error-banner">⚠ {parkDetail.pending_new_park_review.message}</div>
          )}
          {parkDetail.unclassified_count > 0 && (
            <div className="error-banner">⚠ {parkDetail.unclassified_count} unclassified transaction(s) below — categories may be incomplete for {selectedPark}.</div>
          )}

          <div className="tbl-wrap npd-txn-scroll" style={{ marginTop: 14 }}>
            <table className="investor-cmp-table npd-detail-table">
              <thead>
                <tr>
                  <th>Date</th><th>Vendor</th><th>Type</th><th>Bill #</th>
                  <th>Account</th><th>Category</th><th>Head</th><th style={{ textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {parkDetail.transactions.map((t, i) => (
                  <tr key={i} className={t.category === 'Unclassified' ? 'npd-unclassified-row' : ''}>
                    <td>{t.date}</td>
                    <td>{t.vendor}</td>
                    <td>{t.transaction_type}</td>
                    <td>{t.bill_number}</td>
                    <td>{t.account_name || t.project_name || '—'}</td>
                    <td>{t.category}</td>
                    <td>{t.head_grouping}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
