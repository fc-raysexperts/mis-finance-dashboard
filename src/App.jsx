import React, { useState, useEffect, useCallback } from 'react';
import FinTable from './components/FinTable.jsx';
import MonthlyPL from './components/MonthlyPL.jsx';
import Comparison from './components/Comparison.jsx';
import { getRevData, getExpData, refreshLiveData, getLastRefreshed } from './data/dataService.js';
import { FY_CONFIG, REV_STRUCTURE, EXP_STRUCTURE } from './data/structure.js';
import { downloadFYSheet, downloadComparisonSheet } from './excelExport.js';

const TABS = ['Monthly P&L', 'Revenue', 'Expenses', 'Comparison'];

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
    const today = new Date().toDateString();
    let stored = null;
    try { stored = sessionStorage.getItem('mis_refresh_day'); } catch(_) {}
    if (stored !== today) {
      try { sessionStorage.setItem('mis_refresh_day', today); } catch(_) {}
      setTimeout(() => doRefresh(), 500);
    }
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
      <header className="app-header">
        <div className="header-left">
          <div className="header-icon"><ChartIcon /></div>
          <div className="header-text">
            <span className="app-title">MIS Finance Dashboard</span>
            <span className="app-sub">Rays Power Experts</span>
          </div>
        </div>
        <div className="header-right">
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
      </header>

      {liveError && (
        <div className="error-banner">⚠ {liveError} — hardcoded data is still shown below.</div>
      )}

      <nav className="tab-nav">
        {TABS.map((t, i) => (
          <button key={t} className={`tab-btn${curTab === i ? ' active' : ''}`}
            onClick={() => setCurTab(i)}>{t}</button>
        ))}
      </nav>

      <main className="app-main">
        {curTab === 0 && <MonthlyPL revData={revD.data} expData={expD.data} visMo={revD.visMo} />}
        {curTab === 1 && <FinTable structure={REV_STRUCTURE} data={revD.data} visMo={revD.visMo} />}
        {curTab === 2 && <FinTable structure={EXP_STRUCTURE} data={expD.data} visMo={expD.visMo} />}
        {curTab === 3 && <Comparison selOption={cmpOption} setSelOption={setCmpOption} />}
      </main>

      <footer className="app-footer">
        Values in Indian format · Cr = Crores · L = Lakhs · Data shown up to previous month only
      </footer>
    </div>
  );
}
