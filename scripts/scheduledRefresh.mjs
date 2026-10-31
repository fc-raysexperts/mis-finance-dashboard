#!/usr/bin/env node
/*
 * Scheduled refresh runner - called by .github/workflows/scheduled-refresh.yml
 *
 *   node scripts/scheduledRefresh.mjs pl            P&L          } the nightly job runs these three one after
 *   node scripts/scheduledRefresh.mjs ob            Order Book   } another, starting 01:17 AM IST: P&L, then
 *   node scripts/scheduledRefresh.mjs npd           NPD          } Order Book, then NPD (new / last-60-days bills only)
 *   node scripts/scheduledRefresh.mjs pl-retry      } SECOND CHANCE (03:17 AM IST): the same three, but each one only
 *   node scripts/scheduledRefresh.mjs ob-retry      } redoes what is NOT already done tonight. If the first pass went
 *   node scripts/scheduledRefresh.mjs npd-retry     } well it finds nothing to do and ends in seconds.
 *   node scripts/scheduledRefresh.mjs ob-monthly    Order Book full re-read (2nd Saturday of the month, 22:00 IST)
 *   node scripts/scheduledRefresh.mjs npd-monthly   NPD full re-read (4th Saturday of the month, 22:00 IST)
 *
 * It does not talk to Zoho itself. It calls the dashboard's own API on Vercel (the same endpoints the
 * browser uses), one step at a time, so Zoho's 100-requests-a-minute limit is never exceeded, and it
 * retries a step that fails. Every saved figure is replaced only after its new copy is complete.
 *
 * Progress: every finished step is noted in the store (key refresh:progress:<pl|ob|npd>, stamped with
 * tonight's IST date). A normal run starts a clean note; a "-retry" run reads it and skips what is done.
 * A note from an earlier date is ignored, so a retry after a missed first pass simply does everything.
 *
 * Needs two environment variables (GitHub repo secrets):
 *   APP_URL      e.g. https://your-dashboard.vercel.app   (no trailing slash needed)
 *   CRON_SECRET  the same value as CRON_SECRET in the Vercel project's environment variables
 *
 * Exit code 0 = everything refreshed, 1 = something failed (the workflow then shows red and GitHub emails you).
 */
process.env.TZ = 'Asia/Kolkata'; // "this month" in the P&L must be IST, not the runner's UTC

const BASE = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
const SECRET = (process.env.CRON_SECRET || '').trim();
const AUTH = SECRET ? { Authorization: `Bearer ${SECRET}` } : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const realFetch = globalThis.fetch;
const log = (phase, msg) => console.log(`[${new Date().toISOString().slice(11, 19)}Z] [${phase}] ${msg}`);

// (the env overrides exist only so the script can be tested quickly; leave them unset in real runs)
const RATE_LIMIT_WAIT_MS = Number(process.env.RATE_LIMIT_WAIT_MS ?? 90_000);   // Zoho's limit is a rolling minute; 90 s clears it
const OTHER_RETRY_WAIT_MS = Number(process.env.OTHER_RETRY_WAIT_MS ?? 20_000);
const PAUSE_BETWEEN_CALLS_MS = Number(process.env.PAUSE_BETWEEN_CALLS_MS ?? 3_000);
const CALL_TIMEOUT_MS = 330_000;     // a little over Vercel's 300 s function limit

/* One API call with retries. `check(body)` returns an error string, or null when the answer is good. */
async function call(phase, label, path, check = () => null, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    const t0 = Date.now();
    let status = 0, body = null, problem = null;
    try {
      const r = await realFetch(BASE + path, { headers: AUTH, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
      status = r.status;
      const text = await r.text();
      try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
      problem = status === 200 ? check(body) : `HTTP ${status} ${body?.error || body?.message || body?.raw || ''}`.trim();
    } catch (e) {
      problem = `no answer (${e.name === 'TimeoutError' ? 'timed out' : e.message})`;
    }
    const secs = Math.round((Date.now() - t0) / 1000);
    if (!problem) { log(phase, `OK    ${label} (${secs}s)`); return { ok: true, body }; }
    const rateLimited = status === 429 || body?.error === 'RATE_LIMITED';
    if (attempt < retries) {
      const waitMs = rateLimited ? RATE_LIMIT_WAIT_MS : OTHER_RETRY_WAIT_MS;
      log(phase, `retry ${label} - ${problem} (${secs}s) - waiting ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs);
      continue;
    }
    log(phase, `FAIL  ${label} - ${problem} (${secs}s)`);
    return { ok: false, body, problem };
  }
}

/* ── tonight's progress notes (so a "-retry" run redoes only what is missing) ─────────────────────── */
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function storeGet(key) {
  try {
    const r = await realFetch(`${BASE}/api/store?key=${encodeURIComponent(key)}`, { headers: AUTH, signal: AbortSignal.timeout(60_000) });
    if (!r.ok) return null;
    const b = await r.json();
    return b.connected ? b.value : null;
  } catch { return null; }
}
async function storePut(key, value) {
  try {
    const r = await realFetch(`${BASE}/api/store`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value }), signal: AbortSignal.timeout(60_000) });
    return r.ok;
  } catch { return false; }
}
async function startProgress(base, resume) {
  const key = `refresh:progress:${base}`;
  const today = todayIST();
  let rec = null;
  if (resume) { const old = await storeGet(key); if (old && old.date === today && Array.isArray(old.done)) rec = old; }
  const reuse = !!rec;
  if (!rec) rec = { date: today, done: [], meta: {} };
  rec.meta = rec.meta || {};
  const save = async () => { if (!(await storePut(key, rec))) log(base, 'note: could not save progress - a second-chance run would redo this step'); };
  if (!reuse) await save(); // a normal run starts a clean note; a retry that finds nothing for tonight starts one too
  return {
    meta: rec.meta,
    isDone: (item) => rec.done.includes(item),
    mark: async (item) => { if (!rec.done.includes(item)) rec.done.push(item); await save(); },
  };
}

/* ── P&L ────────────────────────────────────────────────────────────────────────────────────────────
 * Runs the dashboard's own P&L refresh code (src/data/dataService.js) - the very same code the browser
 * runs - with relative /api/... calls pointed at the live site. So the saved figures are identical.   */
async function runPL(resume = false) {
  const phase = resume ? 'pl-retry' : 'pl';
  // Safety check first: if the saved store cannot be read, refreshing could overwrite good data with a partial copy.
  const pre = await realFetch(`${BASE}/api/store?key=live_cache_v1`, { headers: AUTH, signal: AbortSignal.timeout(60_000) }).catch(() => null);
  const preBody = pre && pre.ok ? await pre.json().catch(() => null) : null;
  if (!preBody || preBody.connected !== true) {
    log(phase, 'FAIL  the saved-data store (Upstash) is not reachable - nothing was changed');
    return false;
  }

  const prog = await startProgress('pl', resume);
  if (resume && prog.isDone('months')) { log(phase, 'already refreshed tonight - nothing to do'); return true; }

  globalThis.fetch = (input, init = {}) =>
    realFetch(typeof input === 'string' && input.startsWith('/') ? BASE + input : input, {
      ...init,
      headers: { ...(init.headers || {}), ...AUTH },
      signal: init.signal ?? AbortSignal.timeout(120_000),
    });
  const ds = await import('../src/data/dataService.js');
  await ds.hydrateLiveCache();
  log(phase, `previous refresh: ${ds.getLastRefreshed() ? ds.getLastRefreshed().toISOString() : 'none'}`);

  let res = await ds.refreshLiveData((d, t) => { if (d === t || d % 4 === 0) log(phase, `months ${d}/${t}`); }, { stampOnlyIfComplete: true });
  if (res.failed.length) {
    log(phase, `retrying after: ${res.failed.join(', ')} failed - waiting ${Math.round(RATE_LIMIT_WAIT_MS / 1000)}s`);
    await sleep(RATE_LIMIT_WAIT_MS);
    res = await ds.refreshLiveData(() => {}, { stampOnlyIfComplete: true });
  }
  if (res.failed.length || !res.saved) {
    log(phase, `FAIL  ${res.failed.length ? 'months still failing: ' + res.failed.join(', ') : 'figures could not be saved'}`);
    return false;
  }
  log(phase, `OK    all ${res.total} months refreshed and saved`);
  await prog.mark('months');
  return true;
}

/* ── Order Book ─────────────────────────────────────────────────────────────────────────────────── */
async function runOB(mode, resume = false) {
  const phase = mode === 'monthly' ? 'ob-monthly' : (resume ? 'ob-retry' : 'ob');
  const prog = mode === 'daily' ? await startProgress('ob', resume) : null;
  let total = Number(prog?.meta.total) || 8, failed = 0, did = 0;
  for (let batch = 1; batch <= total; batch++) {
    if (resume && prog.isDone(`batch-${batch}`)) continue;
    const r = await call(phase, `batch ${batch}/${total}`, `/api/obInvoiced?mode=${mode}&batch=${batch}${mode === 'monthly' && process.env.FORCE === '1' ? '&force=1' : ''}`, (b) => {
      if (b.skipped) return null;
      if ((b.errors || []).length) return `${b.errors.length} project(s) failed: ${b.errors.map((e) => e.client).join(', ')}`;
      if (b.projects_completed !== b.projects_in_this_batch) return `only ${b.projects_completed}/${b.projects_in_this_batch} projects done`;
      return null;
    });
    did++;
    if (!r.ok) failed++;
    if (r.ok && r.body.total_batches) { total = r.body.total_batches; if (prog) prog.meta.total = total; }
    if (r.ok && r.body.skipped) { log(phase, r.body.reason); return true; }
    if (r.ok && prog) await prog.mark(`batch-${batch}`);
    await sleep(PAUSE_BETWEEN_CALLS_MS);
  }
  if (resume && did === 0) log(phase, 'everything already refreshed tonight - nothing to do');
  return failed === 0;
}

/* ── NPD ────────────────────────────────────────────────────────────────────────────────────────── */
async function runNPD(full = false, resume = false) {
  const phase = full ? 'npd-monthly' : (resume ? 'npd-retry' : 'npd');
  const fullQ = full ? '&full=1' : '';
  const { PARK_KEYWORDS } = await import('../api/_npdShared.js'); // the park list always matches the code
  const prog = full ? null : await startProgress('npd', resume); // the monthly full run keeps no notes
  const skip = (item) => resume && prog && prog.isDone(item);
  const finish = async (item) => { if (prog) await prog.mark(item); };
  let failed = 0, did = 0;

  // 1. fresh shared inputs (Chart of Accounts, GL, Projects) - replaced only if complete
  let r;
  if (!skip('shared')) {
    r = await call(phase, 'shared inputs (accounts, GL, projects)', '/api/npdGenericAccountsRefresh?account=shared&force=1',
      (b) => (b.saved ? null : 'could not save to the store'));
    if (!r.ok) { log(phase, 'STOP  without fresh shared inputs the parks would be computed on old data - nothing replaced'); return false; }
    await finish('shared'); did++;
  }

  // 2. company-wide accounts, then every park (each replaces only its own old copy)
  for (const acct of ['cwip', 'iaud', 'llr']) {
    if (skip(acct)) continue;
    r = await call(phase, `generic account ${acct.toUpperCase()}`, `/api/npdGenericAccountsRefresh?account=${acct}&force=1${fullQ}`,
      (b) => (b.saved ? null : 'could not save to the store'));
    did++;
    if (r.ok) { log(phase, `      ${acct.toUpperCase()}: ${r.body.mode} run - ${r.body.bills_opened} bills opened, ${r.body.bills_reused} reused`); await finish(acct); }
    else failed++;
    await sleep(PAUSE_BETWEEN_CALLS_MS);
  }
  for (const park of Object.keys(PARK_KEYWORDS)) {
    if (skip(`park:${park}`)) continue;
    r = await call(phase, `park ${park}`, `/api/npdCronRefreshPark?park=${encodeURIComponent(park)}${fullQ}`,
      (b) => (b.cached ? null : 'computed but could not save to the store'));
    did++;
    if (r.ok && r.body.bill_refresh_budget_hit) log(phase, `      ${park}: time budget reached - the oldest bills reused their saved line items`);
    if (r.ok) await finish(`park:${park}`); else failed++;
    await sleep(PAUSE_BETWEEN_CALLS_MS);
  }
  if (resume && did === 0) log(phase, 'everything already refreshed tonight - nothing to do');
  return failed === 0;
}

/* ── main ───────────────────────────────────────────────────────────────────────────────────────── */
const phase = process.argv[2];
const PHASES = ['pl', 'ob', 'npd', 'pl-retry', 'ob-retry', 'npd-retry', 'ob-monthly', 'npd-monthly'];
if (!BASE) { console.error('APP_URL is not set. Add it under GitHub repo -> Settings -> Secrets and variables -> Actions.'); process.exit(2); }
if (!PHASES.includes(phase)) { console.error('Usage: scheduledRefresh.mjs ' + PHASES.join(' | ')); process.exit(2); }

// The monthly runs are scheduled on days 8-14 (Order Book) and days 22-28 (NPD); each range holds exactly
// one Saturday, so "only on a Saturday" means the 2nd / 4th Saturday. FORCE=1 (a manual run) skips the check.
if ((phase === 'ob-monthly' || phase === 'npd-monthly') && process.env.FORCE !== '1' && new Date().getUTCDay() !== 6) {
  log(phase, `not a Saturday - nothing to do until the ${phase === 'ob-monthly' ? '2nd' : '4th'} Saturday of the month`);
  process.exit(0);
}

const started = Date.now();
log(phase, `start -> ${BASE}${SECRET ? '' : '  (no CRON_SECRET set: calls are unauthenticated)'}`);
let ok = false;
try {
  ok = phase === 'pl' ? await runPL(false)
    : phase === 'pl-retry' ? await runPL(true)
    : phase === 'ob' ? await runOB('daily', false)
    : phase === 'ob-retry' ? await runOB('daily', true)
    : phase === 'ob-monthly' ? await runOB('monthly', false)
    : phase === 'npd' ? await runNPD(false, false)
    : phase === 'npd-retry' ? await runNPD(false, true)
    : await runNPD(true, false);
} catch (e) {
  log(phase, `FAIL  unexpected error: ${e.message}`);
}
const mins = Math.round((Date.now() - started) / 60000);
log(phase, `${ok ? 'DONE - everything refreshed' : 'FINISHED WITH FAILURES - see FAIL lines above'} in ${mins < 1 ? 'under a minute' : mins + ' min'}`);
process.exit(ok ? 0 : 1);
