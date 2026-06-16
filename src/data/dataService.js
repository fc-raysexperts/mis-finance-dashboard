import { FY25_REV, FY25_EXP, FY26_REV, FY26_EXP } from './hardcoded.js';
import { ALL_REV_SUBS, ALL_EXP_SUBS, getVisibleMonths, FY_CONFIG } from './structure.js';

// liveCache: { 'FY27-0': {rev, exp}, 'FY27-1': {rev, exp}, ... }
// FY25 and FY26 are 100% hardcoded — Refresh never touches them.
// Only FY27 and future FYs are fetched live.
let liveCache = {};
let lastRefreshed = null;

export function getLastRefreshed() { return lastRefreshed; }

function zero12() { return Array(12).fill(0); }

function mergeRevData(fyId) {
  const out = {};
  ALL_REV_SUBS.forEach(sub => {
    let base;
    if (fyId === 'FY25')      base = (FY25_REV[sub] || zero12()).slice();
    else if (fyId === 'FY26') base = (FY26_REV[sub] || zero12()).slice();
    else                      base = zero12();

    // Only overlay live data for FY27 and beyond — never for FY25 or FY26
    if (fyId !== 'FY25' && fyId !== 'FY26') {
      for (let i = 0; i < 12; i++) {
        const key = `${fyId}-${i}`;
        if (liveCache[key]?.rev?.[sub] !== undefined) {
          base[i] = liveCache[key].rev[sub];
        }
      }
    }
    out[sub] = base;
  });
  return out;
}

function mergeExpData(fyId) {
  const out = {};
  ALL_EXP_SUBS.forEach(sub => {
    let base;
    if (fyId === 'FY25')      base = (FY25_EXP[sub] || zero12()).slice();
    else if (fyId === 'FY26') base = (FY26_EXP[sub] || zero12()).slice();
    else                      base = zero12();

    // Only overlay live data for FY27 and beyond — never for FY25 or FY26
    if (fyId !== 'FY25' && fyId !== 'FY26') {
      for (let i = 0; i < 12; i++) {
        const key = `${fyId}-${i}`;
        if (liveCache[key]?.exp?.[sub] !== undefined) {
          base[i] = liveCache[key].exp[sub];
        }
      }
    }
    out[sub] = base;
  });
  return out;
}

export function getRevData(fyId) {
  return { data: mergeRevData(fyId), visMo: getVisibleMonths(fyId) };
}

export function getExpData(fyId) {
  return { data: mergeExpData(fyId), visMo: getVisibleMonths(fyId) };
}

// Only fetch live data for FY27 and future FYs — FY25 & FY26 are fully hardcoded
function getLiveMonthsNeeded() {
  const needed = [];
  for (const fy of FY_CONFIG) {
    if (fy.id === 'FY25' || fy.id === 'FY26') continue; // hardcoded, never fetch
    getVisibleMonths(fy.id).forEach(m => needed.push({ fyId: fy.id, ...m }));
  }
  return needed;
}

async function fetchMonth(fyId, year, calMonth) {
  const m       = String(calMonth + 1).padStart(2, '0');
  const lastDay = new Date(year, calMonth + 1, 0).getDate();
  const start   = `${year}-${m}-01`;
  const end     = `${year}-${m}-${lastDay}`;
  const res = await fetch(`/api/zoho?startDate=${start}&endDate=${end}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function refreshLiveData(onProgress) {
  const needed = getLiveMonthsNeeded();
  let done = 0;
  for (const m of needed) {
    try {
      const result = await fetchMonth(m.fyId, m.year, m.calMonth);
      liveCache[`${m.fyId}-${m.idx}`] = result;
    } catch (e) {
      console.error(`Failed ${m.fyId} ${m.label}:`, e);
    }
    done++;
    if (onProgress) onProgress(done, needed.length);
  }
  lastRefreshed = new Date();
}
