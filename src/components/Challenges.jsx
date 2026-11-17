import React, { useEffect, useState } from 'react';
import { loadInvestorData, DEFAULTS as INV_DEFAULTS } from '../data/investorData.js';
import { getRevData, getExpData } from '../data/dataService.js';
import { computeTotals } from '../data/quarterUtils.js';
import { mergeList, buildIndicators, SEVERITIES, AS_OF } from '../data/challengesData.js';
import { useChallengeEdits, newId, SeverityPill, EditBar, SaveMessage } from './challengesShared.jsx';

// Micro challenges (inside RPEL, with indicators worked out live from this dashboard's own data)
// and macro challenges (industry trends, each with dated public sources).

function Indicators({ items }) {
  if (!items || !items.length) return null;
  return (
    <ul className="ch-ind">
      {items.map((i) => (
        <li key={i.label} className={`ch-ind-row tone-${i.tone || 'info'}`}>
          <span className="ch-ind-dot" aria-hidden="true" />
          <span className="ch-ind-label">{i.label}</span>
          <span className="ch-ind-value">{i.value}</span>
        </li>
      ))}
    </ul>
  );
}

function MitigantChips({ ids }) {
  if (!ids.length) return <div className="ch-nomit">No mitigant listed yet - add one in the Mitigants tab.</div>;
  return (
    <div className="ch-mit">
      <span className="ch-label">Mitigated by</span>
      {ids.map((m) => <span key={m.id} className="ch-chip" title={m.mitigant}>{m.id}</span>)}
    </div>
  );
}

function Card({ c, kind, ed, indicators, mitigants }) {
  const edit = ed.editing;
  const f = (field) => (e) => ed.setField(c.id, field, e.target.value);
  return (
    <article className="ch-card" data-challenge={c.id}>
      <div className="ch-card-head">
        <span className="ch-id">{c.id.startsWith('x-') ? 'New' : c.id}</span>
        {edit
          ? <input className="edit-input ch-in-title" value={c.title} onChange={f('title')} aria-label="Title" />
          : <h3 className="ch-title">{c.title}</h3>}
        {edit
          ? <select className="mo-select ch-sel" value={c.severity} onChange={f('severity')} aria-label="Rating">{SEVERITIES.map((s) => <option key={s}>{s}</option>)}</select>
          : <SeverityPill level={c.severity} />}
      </div>
      {(c.theme || edit) && (edit
        ? <input className="edit-input ch-in" value={c.theme || ''} onChange={f('theme')} placeholder="Theme" aria-label="Theme" />
        : <div className="ch-theme">{c.theme}</div>)}

      <div className="ch-label">{kind === 'macro' ? 'What is happening' : 'Why it matters'}</div>
      {edit
        ? <textarea className="edit-input ch-textarea" rows={4} value={c.what || ''} onChange={f('what')} />
        : <p className="ch-text">{c.what}</p>}

      {kind === 'micro' && <Indicators items={indicators} />}

      <div className="ch-label">What it means for us</div>
      {edit
        ? <textarea className="edit-input ch-textarea" rows={3} value={c.impact || ''} onChange={f('impact')} />
        : <p className="ch-text">{c.impact}</p>}

      {kind === 'macro' && (
        <div className="ch-src">
          {(c.sources || []).map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">{s.label}, {s.date}</a>
          ))}
          {edit
            ? <input className="edit-input ch-in" value={c.sourceNote || ''} onChange={f('sourceNote')} placeholder="Source note (optional)" aria-label="Source note" />
            : (c.sourceNote ? <span>{c.sourceNote}</span> : null)}
        </div>
      )}

      <MitigantChips ids={mitigants} />
      {edit && <button className="edit-btn ch-remove" onClick={() => ed.removeItem(kind, c.id)}>Remove this challenge</button>}
    </article>
  );
}

export default function Challenges() {
  const ed = useChallengeEdits();
  const [inv, setInv] = useState(INV_DEFAULTS);
  useEffect(() => { loadInvestorData().then(setInv).catch(() => {}); }, []);

  const micro = mergeList('micro', ed.view);
  const macro = mergeList('macro', ed.view);
  const mitigants = mergeList('mitigants', ed.view);

  // Live indicators: FY27 figures from the same saved P&L the other tabs use. Worked out on every
  // render (it is cheap), so they follow the figures as soon as the P&L finishes loading.
  let indicators;
  try {
    const revD = getRevData('FY27');
    const expD = getExpData('FY27');
    const all = Array.from({ length: 12 }, (_, i) => i);
    const ytd = computeTotals(revD.data, expD.data, Object.keys(revD.data), Object.keys(expD.data), all);
    indicators = buildIndicators(inv, ytd, Array.isArray(revD.visMo) ? revD.visMo.length : null);
  } catch {
    indicators = buildIndicators(inv, null, null);
  }

  // Wait for the saved changes on the first visit, so the starting content never flashes before the edited version.
  if (ed.loading) return <div className="fp-loading">Loading...</div>;

  const byChallenge = (id) => mitigants.filter((m) => (m.challengeIds || []).includes(id));
  const all = [...micro, ...macro];
  const high = all.filter((c) => c.severity === 'High').length;
  const covered = all.filter((c) => byChallenge(c.id).length > 0).length;
  const count = (list, s) => list.filter((c) => c.severity === s).length;

  const addChallenge = (kind) => ed.addItem(kind, {
    id: newId(kind), title: kind === 'macro' ? 'New industry challenge' : 'New company challenge',
    theme: '', severity: 'Medium', what: '', impact: '', sources: [],
  });

  return (
    <div className="tab-content">
      <div className="investor-header-bar">
        <div>
          <span className="cmp-main-title">Challenges</span>
          <div className="ch-sub">Micro = specific to RPEL. Macro = industry-wide, tied to current trends. Ratings are a first draft for management to review.</div>
        </div>
        <EditBar ed={ed} />
      </div>
      <SaveMessage msg={ed.msg} />

      <div className="kpi-row">
        <div className="kpi-card"><div className="kpi-value">{micro.length}</div><div className="kpi-label">Micro challenges (company)</div><div className="kpi-sub kpi-sub-neg">High {count(micro, 'High')} &middot; Medium {count(micro, 'Medium')} &middot; Low {count(micro, 'Low')}</div></div>
        <div className="kpi-card"><div className="kpi-value">{macro.length}</div><div className="kpi-label">Macro challenges (industry)</div><div className="kpi-sub kpi-sub-neg">High {count(macro, 'High')} &middot; Medium {count(macro, 'Medium')} &middot; Low {count(macro, 'Low')}</div></div>
        <div className="kpi-card kpi-card-white"><div className="kpi-value">{high}</div><div className="kpi-label">Rated High</div></div>
        <div className="kpi-card kpi-card-white"><div className="kpi-value">{covered} / {all.length}</div><div className="kpi-label">Have at least one mitigant</div></div>
      </div>

      <section>
        <div className="ch-sec-head">
          <h2 className="ch-sec-title">Micro challenges - inside the company</h2>
          {ed.editing && <button className="edit-btn" onClick={() => addChallenge('micro')}>+ Add micro challenge</button>}
        </div>
        <div className="ch-grid">
          {micro.map((c) => <Card key={c.id} c={c} kind="micro" ed={ed} indicators={indicators[c.id]} mitigants={byChallenge(c.id)} />)}
        </div>
      </section>

      <section>
        <div className="ch-sec-head">
          <h2 className="ch-sec-title">Macro challenges - the industry</h2>
          {ed.editing && <button className="edit-btn" onClick={() => addChallenge('macro')}>+ Add macro challenge</button>}
        </div>
        <div className="ch-grid">
          {macro.map((c) => <Card key={c.id} c={c} kind="macro" ed={ed} mitigants={byChallenge(c.id)} />)}
        </div>
      </section>

      <p className="ch-foot">
        Industry facts come from public pages opened on {AS_OF}; market prices are from aggregator pages and should be checked against NSE/BSE before external use.
        Company indicators are worked out from this dashboard's own data (order book, collections, balance sheet and the live FY27 P&amp;L) and update with it.
      </p>
    </div>
  );
}
