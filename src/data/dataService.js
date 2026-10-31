import { FY25_REV, FY25_EXP, FY26_REV, FY26_EXP } from './hardcoded.js';
import { ALL_REV_SUBS, ALL_EXP_SUBS, getVisibleMonths, FY_CONFIG } from './structure.js';
import { getRemote, setRemote } from './remoteStore.js';

// liveCache: { 'FY27-0': {rev, exp}, 'FY27-1': {rev, exp}, ... }
// FY25 and FY26 are 100% hardcoded — Refresh never touches them.
// Only FY27 and future FYs are fetched live.
// liveCache is hydrated from the shared backend (Vercel KV) on first use,
// so every visitor sees the last-refreshed figures instantly — no one has
// to wait for the Zoho Books API loop just to see numbers that already exist.
let liveCache = {};
let lastRefreshed = null;
let hydrated = false;
let hydratePromise = null;

const LIVE_CACHE_KEY = 'live_cache_v1';

export function getLastRefreshed() { return lastRefreshed; }

// ── "Day" = starts at 12:00 AM IST ─────────────────────────────────────────
// The saved P&L figures are refreshed every night by the scheduled run
// (GitHub Actions, 1:17 AM IST - see .github/workflows/scheduled-refresh.yml).
// They never expire; a browser only steps in as a SAFETY NET when the saved
// copy is from an earlier IST day AND the night run should long be over
// (5:00 AM IST: the nightly job starts 1:17 AM and its second-chance run 3:17 AM,
// so by 5:00 both are over), i.e. the scheduled runs must have failed.
const IST = 'Asia/Kolkata';
const SCHEDULED_RUN_DEADLINE_HOUR_IST = 5;
export function istDay(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); // YYYY-MM-DD
}
function istHour(date) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: IST, hour: '2-digit', hourCycle: 'h23' }).format(date));
}
export function liveCacheNeedsSelfHeal(last, now = new Date()) {
  if (!last) return true;                              // nothing saved yet
  if (istDay(last) === istDay(now)) return false;      // already refreshed since 12:00 AM IST today
  return istHour(now) >= SCHEDULED_RUN_DEADLINE_HOUR_IST; // earlier day, and the night run window is over
}

// Fetches the cached live figures from the shared backend. Safe to call
// multiple times — only does the network round-trip once.
export function hydrateLiveCache() {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    const remote = await getRemote(LIVE_CACHE_KEY, null);
    if (remote && remote.cache) {
      liveCache = remote.cache;
      lastRefreshed = remote.lastRefreshed ? new Date(remote.lastRefreshed) : null;
    }
    hydrated = true;
  })();
  return hydratePromise;
}
export function isHydrated() { return hydrated; }

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

// A month that fails keeps its previous saved figures (liveCache is hydrated
// first), so a partly failed run never blanks anything.
// opts.stampOnlyIfComplete (scheduled run): when any month failed, the figures
// that DID refresh are saved but the "last refreshed" time is left as it was,
// so a half-done night never looks like a finished one.
// Returns { total, failed: ['FY27 Apr', ...], saved }.
export async function refreshLiveData(onProgress, opts = {}) {
  const needed = getLiveMonthsNeeded();
  const failed = [];
  let done = 0;
  for (const m of needed) {
    try {
      const result = await fetchMonth(m.fyId, m.year, m.calMonth);
      liveCache[`${m.fyId}-${m.idx}`] = result;
    } catch (e) {
      failed.push(`${m.fyId} ${m.label}`);
      console.error(`Failed ${m.fyId} ${m.label}:`, e);
    }
    done++;
    if (onProgress) onProgress(done, needed.length);
  }
  if (failed.length === 0 || !opts.stampOnlyIfComplete) lastRefreshed = new Date();
  // Persist to the shared backend so every device sees this instantly next time
  const saved = await setRemote(LIVE_CACHE_KEY, { cache: liveCache, lastRefreshed: lastRefreshed ? lastRefreshed.toISOString() : null });
  return { total: needed.length, failed, saved };
}
