// What the Order Book and New Park Development tabs show comes from the SAVED
// copy (filled every night by the scheduled run). This file is the one place
// that reads it, so both tabs behave like the P&L tabs:
//
//   * ONE request per tab reads the whole saved copy (no one-by-one calls).
//   * The result is remembered in memory, so coming back to a tab is instant.
//   * App.jsx starts both reads in the background as soon as the P&L figures are
//     on screen, so by the time a tab is clicked its figures are usually already here.
//   * Slow "fill in what is missing" work happens ONLY for items that have no
//     saved copy at all - never when everything is saved.

const FRESH_FOR_MS = 15 * 60 * 1000;   // after this, a tab quietly re-reads (figures stay on screen meanwhile)

const inflight = new Map();
function once(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = Promise.resolve().then(fn).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function getJson(url) {
  const r = await fetch(url);
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || d.error) throw new Error((d && (d.message || d.error)) || `HTTP ${r.status}`);
  return d;
}

export const isFresh = (memo) => !!memo && (Date.now() - memo.at) < FRESH_FOR_MS;

// ── Order Book ───────────────────────────────────────────────────────────
let obMemo = null; // { invoiced, missingBatches, totalBatches, at }

export const getObMemo = () => obMemo;

export function loadObSaved() {
  return once('ob', async () => {
    const d = await getJson('/api/obInvoiced?mode=peek');
    obMemo = {
      invoiced: d.invoiced || {},
      missingBatches: Array.isArray(d.missing_batches) ? d.missing_batches : null, // null = server did not say
      totalBatches: d.total_batches || 8,
      at: Date.now(),
    };
    return obMemo;
  });
}

// Figures the self-healing call just worked out: fold them into the remembered copy.
export function mergeIntoObMemo(invoiced, stillMissingBatches) {
  if (!obMemo) return;
  obMemo = {
    ...obMemo,
    invoiced: { ...obMemo.invoiced, ...(invoiced || {}) },
    ...(stillMissingBatches ? { missingBatches: stillMissingBatches } : {}),
  };
}

// ── New Park Development ─────────────────────────────────────────────────
const npdMemo = new Map(); // periodQuery -> { parks, missing, detailsOmitted, savedAt, at }

export const getNpdMemo = (periodQuery) => npdMemo.get(periodQuery) || null;

export function loadNpdSaved(periodQuery) {
  return once('npd:' + periodQuery, async () => {
    const d = await getJson(`/api/npdParkTransactions?mode=summary&${periodQuery}`);
    const memo = {
      parks: d.parks || {},                 // each park: the same object the single-park call returns
      missing: d.missing || [],
      detailsOmitted: !!d.details_omitted,
      savedAt: d.saved_at || null,
      at: Date.now(),
    };
    npdMemo.set(periodQuery, memo);
    return memo;
  });
}

// A park that had to be filled in the slow way: remember it too (starting a
// memory entry if the saved copy could not be read at all).
export function addParkToNpdMemo(periodQuery, park, data) {
  const memo = npdMemo.get(periodQuery) || { parks: {}, missing: [], detailsOmitted: false, savedAt: null, at: Date.now() };
  npdMemo.set(periodQuery, { ...memo, parks: { ...memo.parks, [park]: data }, missing: memo.missing.filter((p) => p !== park), at: Date.now() });
}

// Called once from App.jsx right after the P&L figures are showing.
export function prefetchSavedTabs() {
  loadObSaved().catch(() => { /* the tab itself will try again when opened */ });
  loadNpdSaved('period=total').catch(() => { /* same */ });
}
