import React, { useState, useEffect } from 'react';
import { fmt } from '../utils.js';
import { NPDParkCostChart } from './Charts.jsx';
import { downloadNPDExcel } from '../npdExcelExport.js';

// Descending by real Total Till Date cost (biggest first) — verified from
// actual dashboard figures, not assumption. Drives table column order and
// the Park Detail dropdown. FETCH_ORDER below is deliberately just this,
// reversed — one array, always in sync, no risk of the two drifting apart.
const PARK_LIST = [
  'Dechu', 'Lunkaransar', 'SS Nagar', 'Pugal', 'Panchu', 'Kolayat', 'Tosham',
  'Jaisalmer', 'Napasar', 'Bhamatsar', 'Sanchore', 'Jasarasar', 'Baithwasiya',
  'Sheruna', 'Thukariyasar',
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

// OB/CB can genuinely be unavailable (Total cache not yet warm for a park)
// — show a plain dash rather than a misleading 0.
function fmtOB(v) {
  return (v === null || v === undefined) ? '—' : fmt(v);
}

// Indian fiscal year (Apr-Mar) that "today" currently falls in, as a
// 2-digit end-year (e.g. 27 for FY ending March 2027) — matches the same
// short form used by the fy dropdown/state elsewhere in this component.
function getCurrentFiscalYearShort() {
  const now = new Date();
  const endYear = now.getMonth() + 1 >= 4 ? now.getFullYear() + 1 : now.getFullYear();
  return endYear % 100;
}

// Client-side mirror of the server's derivePeriodFromFullData — filters an
// already-fetched transaction list by date range and recomputes the
// aggregates, entirely in the browser. Used to proactively build a second
// snapshot (current FY) from data we already have in hand after a Total
// load, with zero additional network calls.
function deriveClientSidePeriod(transactions, fromDate, toDate) {
  const filtered = (transactions || []).filter(t => (t.date || '') >= fromDate && (t.date || '') <= toDate);
  const total = Math.round(filtered.reduce((s, t) => s + t.amount, 0) * 100) / 100;
  const cwip_total = Math.round(filtered.filter(t => t.head_grouping === 'CWIP').reduce((s, t) => s + t.amount, 0) * 100) / 100;
  const iaud_total = Math.round(filtered.filter(t => t.head_grouping === 'IAUD').reduce((s, t) => s + t.amount, 0) * 100) / 100;
  const category_totals = {};
  for (const t of filtered) category_totals[t.category] = Math.round(((category_totals[t.category] || 0) + t.amount) * 100) / 100;
  const unclassified_count = filtered.filter(t => t.head_grouping === 'Unclassified').length;
  const account_count = new Set(filtered.map(t => t.account_name).filter(Boolean)).size;
  return { account_count, total, cwip_total, iaud_total, category_totals, unclassified_count };
}

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

// Builds the two summary tables' per-park aggregate fields from a single
// park's FULL npdParkTransactions response (which includes everything
// needed, plus the full transaction list we don't need for the tables).
function extractSummaryFields(fullData) {
  return {
    account_count: fullData.account_count,
    cwip_total: fullData.cwip_total,
    iaud_total: fullData.iaud_total,
    total: fullData.total,
    unclassified_count: fullData.unclassified_count,
    category_totals: fullData.category_totals,
    ob_cwip_total: fullData.ob_cwip_total ?? null,
    ob_iaud_total: fullData.ob_iaud_total ?? null,
    ob_total: fullData.ob_total ?? null,
    ob_category_totals: fullData.ob_category_totals ?? null,
    cb_cwip_total: fullData.cb_cwip_total ?? null,
    cb_iaud_total: fullData.cb_iaud_total ?? null,
    cb_total: fullData.cb_total ?? null,
    cb_category_totals: fullData.cb_category_totals ?? null,
  };
}

function computeSumRow(parks) {
  const parkList = Object.values(parks);
  const allCategories = new Set();
  parkList.forEach(p => Object.keys(p.category_totals || {}).forEach(c => allCategories.add(c)));
  const sum = { cwip_total: 0, iaud_total: 0, total: 0, category_totals: {} };
  for (const cat of allCategories) sum.category_totals[cat] = 0;
  for (const p of parkList) {
    sum.cwip_total += p.cwip_total || 0;
    sum.iaud_total += p.iaud_total || 0;
    sum.total += p.total || 0;
    for (const [cat, amt] of Object.entries(p.category_totals || {})) sum.category_totals[cat] += amt;
  }
  sum.cwip_total = Math.round(sum.cwip_total * 100) / 100;
  sum.iaud_total = Math.round(sum.iaud_total * 100) / 100;
  sum.total = Math.round(sum.total * 100) / 100;
  for (const k in sum.category_totals) sum.category_totals[k] = Math.round(sum.category_totals[k] * 100) / 100;

  const allHaveOb = parkList.length > 0 && parkList.every(p => p.ob_total !== null && p.ob_total !== undefined);
  if (allHaveOb) {
    const obSum = { cwip_total: 0, iaud_total: 0, total: 0, category_totals: {} };
    const cbSum = { cwip_total: 0, iaud_total: 0, total: 0, category_totals: {} };
    for (const cat of allCategories) { obSum.category_totals[cat] = 0; cbSum.category_totals[cat] = 0; }
    for (const p of parkList) {
      obSum.cwip_total += p.ob_cwip_total || 0; obSum.iaud_total += p.ob_iaud_total || 0; obSum.total += p.ob_total || 0;
      cbSum.cwip_total += p.cb_cwip_total || 0; cbSum.iaud_total += p.cb_iaud_total || 0; cbSum.total += p.cb_total || 0;
      for (const [cat, amt] of Object.entries(p.ob_category_totals || {})) obSum.category_totals[cat] += amt;
      for (const [cat, amt] of Object.entries(p.cb_category_totals || {})) cbSum.category_totals[cat] += amt;
    }
    for (const k of ['cwip_total', 'iaud_total', 'total']) { obSum[k] = Math.round(obSum[k] * 100) / 100; cbSum[k] = Math.round(cbSum[k] * 100) / 100; }
    for (const k in obSum.category_totals) obSum.category_totals[k] = Math.round(obSum.category_totals[k] * 100) / 100;
    for (const k in cbSum.category_totals) cbSum.category_totals[k] = Math.round(cbSum.category_totals[k] * 100) / 100;
    sum.ob = obSum;
    sum.cb = cbSum;
  }
  return sum;
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
  const [parksLoaded, setParksLoaded] = useState(0);
  const [snapshotTimestamp, setSnapshotTimestamp] = useState(null);

  // Holds each park's COMPLETE response (including full transactions) as
  // the sequential loop fetches them — lets Park Detail reuse this directly
  // for whichever park is selected, instead of a redundant separate fetch.
  const [allParksFullData, setAllParksFullData] = useState({});

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
        summary, periodQuery, periodLabel, periodType,
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

  // ── Summary: fetch all 15 parks ONE AT A TIME via the same proven
  //    single-park endpoint that already powers Park Detail and the Excel
  //    export. A failure on any one park is fully isolated — it can never
  //    destroy other parks' already-successful data, unlike the previous
  //    4-park-chunk design where one failure lost the whole chunk.
  useEffect(() => {
    let cancelled = false;
    setSummaryLoading(true); setSummaryError(null); setParksLoaded(0);
    setAllParksFullData({});

    // Show a previous successful snapshot instantly, clearly labeled as
    // possibly outdated, while the real fetch runs underneath — something
    // useful on screen immediately instead of a blank wait on every load.
    try {
      const snapshotRaw = localStorage.getItem(`npd_snapshot_${periodQuery}`);
      if (snapshotRaw) {
        const snapshot = JSON.parse(snapshotRaw);
        setSummary(snapshot.data);
        setSnapshotTimestamp(snapshot.savedAt);
      } else {
        setSnapshotTimestamp(null);
      }
    } catch { /* corrupted/unavailable storage — just skip the instant snapshot */ }

    (async () => {
      const parks = {};
      const fullData = {};
      const staleParks = [];
      let lastError = '';
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      async function fetchOnePark(park) {
        const r = await fetch(`/api/npdParkTransactions?park=${encodeURIComponent(park)}&${periodQuery}`);
        const d = await r.json();
        if (d.error === 'RATE_LIMITED') throw new Error(d.message);
        if (d.error) throw new Error(d.error);
        return d;
      }

      // Staged retry: finish a full first pass through every park before
      // ever retrying anything, THEN retry only what failed after a short
      // wait, THEN one final retry after a longer wait. Letting other
      // parks' work happen in between gives a transient issue more natural
      // time to clear than immediately re-hitting the same park again.
      //
      // Fetch order only — NEVER changes table column order (that always
      // stays PARK_LIST). Lightest/fastest parks first, heaviest last —
      // derived directly from PARK_LIST (which is now sorted biggest-first)
      // via reverse(), rather than a second hardcoded list. One source of
      // truth for park size — impossible for fetch order and display order
      // to silently disagree with each other the way two separate
      // hardcoded arrays eventually could.
      const FETCH_ORDER = [...PARK_LIST].reverse();
      let remaining = [...FETCH_ORDER];
      for (const park of remaining) {
        if (cancelled) return;
        try {
          const d = await fetchOnePark(park);
          parks[park] = extractSummaryFields(d);
          fullData[park] = d;
          if (d.stale) staleParks.push(park);
          if (!cancelled) setParksLoaded(n => n + 1);
        } catch { /* leave in remaining-to-retry, handled below */ }
      }
      remaining = FETCH_ORDER.filter(p => !parks[p]);

      if (remaining.length > 0 && !cancelled) {
        await sleep(5000); // 2nd try — short wait
        const stillFailed = [];
        for (const park of remaining) {
          if (cancelled) return;
          try {
            const d = await fetchOnePark(park);
            parks[park] = extractSummaryFields(d);
            fullData[park] = d;
            if (d.stale) staleParks.push(park);
            if (!cancelled) setParksLoaded(n => n + 1);
          } catch (e) {
            stillFailed.push(park);
            lastError = e.message;
          }
        }
        remaining = stillFailed;
      }

      if (remaining.length > 0 && !cancelled) {
        await sleep(10000); // 3rd try — longer wait
        const stillFailed2 = [];
        for (const park of remaining) {
          if (cancelled) return;
          try {
            const d = await fetchOnePark(park);
            parks[park] = extractSummaryFields(d);
            fullData[park] = d;
            if (d.stale) staleParks.push(park);
            if (!cancelled) setParksLoaded(n => n + 1);
          } catch (e) {
            stillFailed2.push(park);
            lastError = e.message;
          }
        }
        remaining = stillFailed2;
      }

      if (remaining.length > 0 && !cancelled) {
        // 4th, final try — a genuine 60-second wait. Zoho's limit is 100
        // requests per MINUTE, rolling — the earlier 5s/10s waits are both
        // shorter than that window, so they can only ever catch a partial
        // recovery. A full 60 seconds guarantees a genuinely fresh window
        // by the time we retry, not one still overlapping the congested one.
        await sleep(60000);
        for (const park of remaining) {
          if (cancelled) return;
          try {
            const d = await fetchOnePark(park);
            parks[park] = extractSummaryFields(d);
            fullData[park] = d;
            if (d.stale) staleParks.push(park);
            if (!cancelled) setParksLoaded(n => n + 1);
          } catch (e) {
            lastError = e.message;
          }
        }
      }

      const failedParks = PARK_LIST.filter(p => !parks[p]);
      if (cancelled) return;

      setAllParksFullData(fullData);
      if (Object.keys(parks).length > 0) {
        const freshSummary = { parks, sum: computeSumRow(parks) };
        setSummary(freshSummary);
        setSnapshotTimestamp(null);
        // Only snapshot a genuinely COMPLETE result (all 15 parks, zero
        // failures) — a partial snapshot could later get shown as if it
        // were the full picture, which is worse than no snapshot at all.
        if (failedParks.length === 0 && staleParks.length === 0) {
          try {
            localStorage.setItem(`npd_snapshot_${periodQuery}`, JSON.stringify({ data: freshSummary, savedAt: new Date().toISOString() }));
          } catch { /* storage full/unavailable — non-fatal, just skip snapshotting */ }

          // Proactive extra snapshot: if this WAS the Total view, also
          // derive and save the current fiscal year — entirely from data
          // already in hand (each park's full transaction list), zero
          // extra network calls. Means switching to "this year" after a
          // Total load also gets an instant snapshot, not just reloading
          // the exact same period you were already on.
          if (periodType === 'total') {
            try {
              const currentFy = getCurrentFiscalYearShort();
              const fyStartYear = 2000 + currentFy - 1;
              const fyFromDate = `${fyStartYear}-04-01`;
              const fyToDate = `${2000 + currentFy}-03-31`;
              const derivedParks = {};
              for (const [parkName, data] of Object.entries(fullData)) {
                derivedParks[parkName] = deriveClientSidePeriod(data.transactions, fyFromDate, fyToDate);
              }
              const derivedSummary = { parks: derivedParks, sum: computeSumRow(derivedParks) };
              const fyPeriodQuery = `period=yearly&fy=${currentFy}`;
              localStorage.setItem(`npd_snapshot_${fyPeriodQuery}`, JSON.stringify({ data: derivedSummary, savedAt: new Date().toISOString() }));
            } catch { /* non-fatal — this is a bonus snapshot, not the primary one */ }
          }
        }
      }
      if (failedParks.length > 0) {
        setSummaryError(
          `${failedParks.length} of ${PARK_LIST.length} parks failed to load (after 4 attempts each, including a full 60s wait) — missing: ${failedParks.join(', ')}. ` +
          `${Object.keys(parks).length > 0 ? 'Showing the parks that did load successfully below.' : ''} Reason: ${lastError}` +
          (staleParks.length > 0 ? ` Note: ${staleParks.join(', ')} are showing older cached data (fresh load failed) — check individual Park Detail for exact age.` : '')
        );
      } else if (staleParks.length > 0) {
        setSummaryError(`${staleParks.join(', ')} are showing older cached data (a fresh load failed after 4 attempts) — check individual Park Detail for exact age.`);
      }
      setSummaryLoading(false);
    })();

    return () => { cancelled = true; };
  }, [periodQuery]);

  // ── Park Detail: reuse data already fetched during the summary loop if
  //    available (instant, zero extra request) — only fetch fresh if the
  //    selected park wasn't successfully loaded there (e.g. it failed, or
  //    the user picked a different park after summary already finished).
  useEffect(() => {
    if (summaryLoading) return;
    let cancelled = false;

    if (allParksFullData[selectedPark]) {
      setParkDetail(allParksFullData[selectedPark]);
      setParkDetailError(null);
      setParkDetailLoading(false);
      return;
    }

    setParkDetailLoading(true); setParkDetailError(null);
    (async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      let lastErr;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (cancelled) return;
        try {
          const r = await fetch(`/api/npdParkTransactions?park=${encodeURIComponent(selectedPark)}&${periodQuery}`);
          const d = await r.json();
          if (d.error === 'RATE_LIMITED') throw new Error(d.message); if (d.error) throw new Error(d.error);
          if (!cancelled) setParkDetail(d);
          if (!cancelled) setParkDetailLoading(false);
          return;
        } catch (e) {
          lastErr = e;
          if (attempt === 0) await sleep(5000);
        }
      }
      if (!cancelled) { setParkDetailError(lastErr.message); setParkDetailLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [selectedPark, periodQuery, summaryLoading, allParksFullData]);

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
            disabled={!summary || excelExporting || summaryLoading}
            style={{ cursor: (!summary || excelExporting || summaryLoading) ? 'not-allowed' : 'pointer', opacity: (!summary || excelExporting || summaryLoading) ? 0.6 : 1 }}
          >
            {excelExporting ? (excelProgress || 'Generating…') : '⬇ Download NPD Excel Data'}
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
      {summaryLoading && snapshotTimestamp && (
        <div className="npd-loading" style={{ background: '#eff6ff', borderColor: '#93c5fd', color: '#1d4ed8' }}>
          ℹ Showing your last successful load (from {new Date(snapshotTimestamp).toLocaleString()}) while today's fresh data loads underneath — this will be replaced automatically once ready.
        </div>
      )}
      {summaryLoading && (
        <div className="npd-loading">
          <span className="npd-spinner" /> Loading summary — {parksLoaded}/{PARK_LIST.length} parks done (one at a time, so one park's issue can never affect another's)…
        </div>
      )}
      {summaryError && <div className="error-banner">⚠ {summaryError}</div>}

      {summaryError && summary && (
        <div className="npd-loading" style={{ background: '#fff7ed', borderColor: '#fdba74', color: '#c2410c' }}>
          ⚠ The tables below may be incomplete or from an earlier load — see the error above for what's missing and why.
        </div>
      )}
      {summary && (
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
                {periodType !== 'total' && (
                  <>
                    <tr className="npd-ob-row">
                      <td className="col-head" colSpan={2}>Opening Balance</td>
                      {PARK_LIST.map((p, i) => <td key={p} className="col-num" style={parkColStyle(i)}>{fmtOB(parks[p]?.ob_total)}</td>)}
                      <td className="col-num col-total-val">{fmtOB(sum?.ob?.total)}</td>
                    </tr>
                    <tr className="npd-cb-row">
                      <td className="col-head" colSpan={2}>Closing Balance</td>
                      {PARK_LIST.map((p, i) => <td key={p} className="col-num" style={parkColStyle(i)}>{fmtOB(parks[p]?.cb_total)}</td>)}
                      <td className="col-num col-total-val">{fmtOB(sum?.cb?.total)}</td>
                    </tr>
                  </>
                )}
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
                {periodType !== 'total' && (
                  <>
                    <tr className="npd-ob-row">
                      <td className="col-head" colSpan={2}>Opening Balance</td>
                      {PARK_LIST.map((p, i) => <td key={p} className="col-num" style={parkColStyle(i)}>{fmtOB(parks[p]?.ob_total)}</td>)}
                      <td className="col-num col-total-val">{fmtOB(sum?.ob?.total)}</td>
                    </tr>
                    <tr className="npd-cb-row">
                      <td className="col-head" colSpan={2}>Closing Balance</td>
                      {PARK_LIST.map((p, i) => <td key={p} className="col-num" style={parkColStyle(i)}>{fmtOB(parks[p]?.cb_total)}</td>)}
                      <td className="col-num col-total-val">{fmtOB(sum?.cb?.total)}</td>
                    </tr>
                  </>
                )}
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

          {parkDetail.stale && (
            <div className="error-banner">
              ⚠ A fresh load for {selectedPark} failed — showing the last successfully cached data instead, from {parkDetail.stale_since ? new Date(parkDetail.stale_since).toLocaleString() : 'an earlier time'}. This may not reflect the very latest bills.
            </div>
          )}
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
                {(parkDetail.transactions || []).map((t, i) => (
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
