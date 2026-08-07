import React, { useState, useEffect, useCallback } from 'react';
import FinTable from './components/FinTable.jsx';
import MonthlyPL from './components/MonthlyPL.jsx';
import Comparison from './components/Comparison.jsx';
import InvestorSummary from './components/InvestorSummary.jsx';
import Outlook from './components/Outlook.jsx';
import SolarParks from './components/SolarParks.jsx';
import Manufacturing from './components/Manufacturing.jsx';
import UKArin from './components/UKArin.jsx';
import NPD from './components/NPD.jsx';
import { getRevData, getExpData, refreshLiveData, getLastRefreshed, hydrateLiveCache } from './data/dataService.js';
import { FY_CONFIG, REV_STRUCTURE, EXP_STRUCTURE } from './data/structure.js';
import { downloadFYSheet, downloadComparisonSheet } from './excelExport.js';

const TABS = ['Monthly P&L', 'Revenue', 'Expenses', 'Comparison', 'Financial Metrics', 'Outlook & Order Book', 'Solar Parks', 'Manufacturing', 'UK - Arin Power', 'New Park Development'];

function ChartIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2"  y="16" width="5" height="10" rx="1.5" fill="rgba(255,255,255,.5)"/>
      <rect x="9"  y="10" width="5" height="16" rx="1.5" fill="rgba(255,255,255,.75)"/>
      <rect x="16" y="6"  width="5" height="20" rx="1.5" fill="#fff"/>
      <rect x="23" y="12" width="5" height="14" rx="1.5" fill="rgba(255,255,255,.65)"/>
      <polyline points="4.5,15 11.5,9 18.5,5 25.5,11"
        stroke="#fbbf24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <circle cx="4.5"  cy="15" r="1.5" fill="#fbbf24"/>
      <circle cx="11.5" cy="9"  r="1.5" fill="#fbbf24"/>
      <circle cx="18.5" cy="5"  r="1.5" fill="#fbbf24"/>
      <circle cx="25.5" cy="11" r="1.5" fill="#fbbf24"/>
    </svg>
  );
}

export default function App() {
  const [curFY, setCurFY]       = useState('FY26');
  const [curTab, setCurTab]     = useState(0);
  const [loading, setLoading]   = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [lastRefresh, setLastRefresh] = useState(null);
  const [liveError, setLiveError]     = useState(null);
  const [cmpOption, setCmpOption]     = useState(0); // lifted for download
  const [, forceUpdate]         = useState(0);
  const [hydrating, setHydrating] = useState(true);
  const [showCredits, setShowCredits] = useState(false);

  const doRefresh = useCallback(async () => {
    if (loading) return;
    setLoading(true); setLiveError(null); setProgress({ done: 0, total: 0 });
    try {
      await refreshLiveData((done, total) => setProgress({ done, total }));
      setLastRefresh(getLastRefreshed());
    } catch (e) {
      setLiveError('Live data fetch failed: ' + e.message);
    } finally {
      setLoading(false); forceUpdate(n => n + 1);
    }
  }, [loading]);

  useEffect(() => {
    (async () => {
      // 1. Load whatever was last refreshed (by anyone, on any device) —
      //    this is a single fast request, so figures appear almost instantly.
      await hydrateLiveCache();
      const cached = getLastRefreshed();
      setLastRefresh(cached);
      setHydrating(false);
      forceUpdate(n => n + 1);

      // 2. Only hit the Zoho Books API loop in the background if the cached
      //    data is missing or from a previous day — most visits won't need this.
      const today = new Date().toDateString();
      if (!cached || cached.toDateString() !== today) {
        doRefresh();
      }
    })();
  }, []); // eslint-disable-line

  const revD = getRevData(curFY);
  const expD = getExpData(curFY);
  const fyLabel = FY_CONFIG.find(f => f.id === curFY)?.label || curFY;

  const refreshLabel = loading
    ? `Fetching… (${progress.done}/${progress.total})`
    : lastRefresh
      ? `Refreshed ${lastRefresh.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
      : 'Refresh Live Data';

  const handleDownload = () => {
    if (curTab === 3) {
      downloadComparisonSheet(cmpOption);
    } else {
      downloadFYSheet(curFY, fyLabel, revD.data, expD.data, revD.visMo);
    }
  };

  const downloadLabel = curTab === 3
    ? 'Download Comparisons Sheet'
    : `Download ${fyLabel} Sheet`;

  return (
    <div className="app">
      <div className="sticky-top-group">
        <header className="app-header">
          <div className="header-left">
            <div className="header-icon"><ChartIcon /></div>
            <div className="header-text">
              <span className="app-title">MIS Finance Dashboard</span>
              <span className="app-sub">Rays Power Experts</span>
            </div>
          </div>
          <div className="header-center">
            <div className="fy-seg">
              {FY_CONFIG.map(f => (
                <button key={f.id} className={`fy-btn${curFY === f.id ? ' active' : ''}`}
                  onClick={() => setCurFY(f.id)}>{f.label}</button>
              ))}
            </div>
            <button className="download-btn" onClick={handleDownload}>
              ⬇ {downloadLabel}
            </button>
            <button className={`refresh-btn${loading ? ' loading' : ''}`}
              onClick={doRefresh} disabled={loading}>
              <span className="refresh-icon">↻</span>{refreshLabel}
            </button>
          </div>
          <div className="header-right">
            <span className="dev-credit-name">Finance Control Team</span>
            <button className="credits-btn" onClick={() => setShowCredits(true)}>Credits</button>
          </div>
        </header>

        <nav className="tab-nav">
          {TABS.map((t, i) => (
            <button key={t} className={`tab-btn${curTab === i ? ' active' : ''}`}
              onClick={() => setCurTab(i)}>{t}</button>
          ))}
        </nav>
      </div>

      {liveError && (
        <div className="error-banner">⚠ {liveError} — hardcoded data is still shown below.</div>
      )}

      <main className="app-main">
        {curTab === 0 && <MonthlyPL revData={revD.data} expData={expD.data} visMo={revD.visMo} />}
        {curTab === 1 && <FinTable structure={REV_STRUCTURE} data={revD.data} visMo={revD.visMo} chartTitle="Revenue" chartColor="#3b82f6" />}
        {curTab === 2 && <FinTable structure={EXP_STRUCTURE} data={expD.data} visMo={expD.visMo} chartTitle="Expenses" chartColor="#ef4444" />}
        {curTab === 3 && <Comparison selOption={cmpOption} setSelOption={setCmpOption} />}
        {curTab === 4 && <InvestorSummary curFY={curFY} />}
        {curTab === 5 && <Outlook curFY={curFY} />}
        {curTab === 6 && <SolarParks />}
        {curTab === 7 && <Manufacturing />}
        {curTab === 8 && <UKArin />}
        {curTab === 9 && <NPD />}
      </main>

      <footer className="app-footer">
        Values in Indian format · Cr = Crores · L = Lakhs · Data shown up to previous month only
      </footer>

      {showCredits && (
        <div className="modal-overlay" onClick={() => setShowCredits(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Credits</h3>
            <div className="modal-row"><span className="modal-label">Name:</span> <b>Ashish Kaswan</b></div>
            <div className="modal-row"><span className="modal-label">Designation:</span> Business Analyst</div>
            <div className="modal-row"><span className="modal-label">Team:</span> Finance Control</div>
            <div className="modal-row"><span className="modal-label">Dept.:</span> Finance &amp; Accounting</div>
            <div className="modal-row"><span className="modal-label">Firm:</span> Rays Power Experts Ltd.</div>
            <button className="modal-close-btn" onClick={() => setShowCredits(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
