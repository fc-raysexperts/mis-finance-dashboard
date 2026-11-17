import React, { useState } from 'react';
import { mergeList, STATUSES, BASES } from '../data/challengesData.js';
import { useChallengeEdits, newId, StatusPill, EditBar, SaveMessage } from './challengesShared.jsx';

// For each challenge: what answers it, how it is being carried out, the evidence from our own
// data, who owns it and where it stands. Linked to the Challenges tab by challenge id.

const toIds = (text) => String(text || '').split(',').map((s) => s.trim()).filter(Boolean);

export default function Mitigants() {
  const ed = useChallengeEdits();
  const [statusFilter, setStatusFilter] = useState('All');
  const [kindFilter, setKindFilter] = useState('All');

  // Wait for the saved changes on the first visit, so the starting content never flashes before the edited version.
  if (ed.loading) return <div className="fp-loading">Loading...</div>;

  const micro = mergeList('micro', ed.view);
  const macro = mergeList('macro', ed.view);
  const mitigants = mergeList('mitigants', ed.view);
  const lookup = new Map([...micro, ...macro].map((c) => [c.id, c]));
  const microIds = new Set(micro.map((c) => c.id));
  const macroIds = new Set(macro.map((c) => c.id));

  const shown = mitigants.filter((m) => {
    if (statusFilter !== 'All' && m.status !== statusFilter) return false;
    const ids = m.challengeIds || [];
    if (kindFilter === 'Micro' && !ids.some((i) => microIds.has(i))) return false;
    if (kindFilter === 'Macro' && !ids.some((i) => macroIds.has(i))) return false;
    return true;
  });

  const coveredIds = new Set(mitigants.flatMap((m) => m.challengeIds || []));
  const uncovered = [...micro, ...macro].filter((c) => !coveredIds.has(c.id));
  const n = (s) => mitigants.filter((m) => m.status === s).length;
  const proposed = mitigants.filter((m) => m.basis !== 'Company data').length;

  const f = (m, field) => (e) => ed.setField(m.id, field, e.target.value);
  const addMitigant = () => ed.addItem('mitigants', {
    id: newId('mitigants'), challengeIds: [], basis: BASES[1], mitigant: 'New mitigant',
    how: '', evidence: '', owner: '', timeline: '', status: 'Planned',
  });

  return (
    <div className="tab-content">
      <div className="investor-header-bar">
        <div>
          <span className="cmp-main-title">Mitigants</span>
          <div className="ch-sub">What answers each challenge, and how we are carrying it out. Refs link to the Challenges tab (MI = micro, MA = macro).</div>
        </div>
        <EditBar ed={ed} extra={ed.editing ? <button className="edit-btn" onClick={addMitigant}>+ Add mitigant</button> : null} />
      </div>
      <SaveMessage msg={ed.msg} />

      <div className="ch-draft">
        <strong>Draft for management review.</strong> Rows marked "Company data" rest on figures in this dashboard. Rows marked "Proposed - to confirm" are suggested actions;
        owners are functions, not named people, and timelines are indicative. Use Edit to correct any of it.
      </div>

      <div className="kpi-row">
        <div className="kpi-card"><div className="kpi-value">{mitigants.length}</div><div className="kpi-label">Mitigants listed</div></div>
        <div className="kpi-card kpi-card-white"><div className="kpi-value kpi-value-green">{n('In place')}</div><div className="kpi-label">In place</div></div>
        <div className="kpi-card kpi-card-white"><div className="kpi-value">{n('In progress')}</div><div className="kpi-label">In progress</div></div>
        <div className="kpi-card kpi-card-white"><div className="kpi-value">{n('Planned')}</div><div className="kpi-label">Planned</div><div className="kpi-sub kpi-sub-neg">{proposed} still to be confirmed</div></div>
        <div className="kpi-card kpi-card-white">
          <div className="kpi-value">{uncovered.length}</div>
          <div className="kpi-label">Challenges with no mitigant</div>
          {uncovered.length > 0 && <div className="kpi-sub kpi-sub-neg">{uncovered.map((c) => c.id).join(', ')}</div>}
        </div>
      </div>

      <div className="ch-filters">
        <label>Status{' '}
          <select className="mo-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option>All</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label>Answers{' '}
          <select className="mo-select" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
            <option>All</option><option>Micro</option><option>Macro</option>
          </select>
        </label>
        <span className="ch-count">{shown.length} of {mitigants.length} shown</span>
      </div>

      <div className="ch-table-wrap">
        <table className="ch-table">
          <thead>
            <tr>
              <th>Ref</th><th>Mitigant</th><th>Answers</th><th>How we are executing it</th>
              <th>Evidence from our data</th><th>Owner</th><th>Timeline</th><th>Status</th><th>Basis</th>
              {ed.editing && <th />}
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.id} data-mitigant={m.id}>
                <td className="ch-ref">{m.id.startsWith('x-') ? 'New' : m.id}</td>
                <td className="ch-wide">
                  {ed.editing ? <textarea className="edit-input ch-textarea" rows={3} value={m.mitigant || ''} onChange={f(m, 'mitigant')} /> : <strong>{m.mitigant}</strong>}
                </td>
                <td>
                  {ed.editing
                    ? <input className="edit-input ch-in" value={(m.challengeIds || []).join(', ')} onChange={(e) => ed.setField(m.id, 'challengeIds', toIds(e.target.value))} placeholder="e.g. MI1, MA6" aria-label="Challenge refs" />
                    : (m.challengeIds || []).map((id) => {
                      const c = lookup.get(id);
                      return <span key={id} className={`ch-chip${c ? '' : ' ch-chip-missing'}`} title={c ? c.title : 'Not found - check the ref'}>{id}</span>;
                    })}
                </td>
                <td className="ch-wide">{ed.editing ? <textarea className="edit-input ch-textarea" rows={4} value={m.how || ''} onChange={f(m, 'how')} /> : m.how}</td>
                <td className="ch-wide">{ed.editing ? <textarea className="edit-input ch-textarea" rows={4} value={m.evidence || ''} onChange={f(m, 'evidence')} /> : m.evidence}</td>
                <td>{ed.editing ? <input className="edit-input ch-in" value={m.owner || ''} onChange={f(m, 'owner')} /> : m.owner}</td>
                <td>{ed.editing ? <input className="edit-input ch-in" value={m.timeline || ''} onChange={f(m, 'timeline')} /> : m.timeline}</td>
                <td>
                  {ed.editing
                    ? <select className="mo-select ch-sel" value={m.status} onChange={f(m, 'status')}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
                    : <StatusPill status={m.status} />}
                </td>
                <td>
                  {ed.editing
                    ? <select className="mo-select ch-sel" value={m.basis} onChange={f(m, 'basis')}>{BASES.map((b) => <option key={b}>{b}</option>)}</select>
                    : <span className={`ch-basis${m.basis === 'Company data' ? '' : ' ch-basis-prop'}`}>{m.basis}</span>}
                </td>
                {ed.editing && <td><button className="edit-btn" onClick={() => ed.removeItem('mitigants', m.id)} title="Remove this mitigant">Remove</button></td>}
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={ed.editing ? 10 : 9} className="ch-empty">No mitigants match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
