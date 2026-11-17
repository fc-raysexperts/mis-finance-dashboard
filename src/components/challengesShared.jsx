// Shared by the Challenges and Mitigants tabs: loading/saving the edits, and the small pieces both tabs use.

import React, { useState, useEffect } from 'react';
import { loadChallengeEdits, saveChallengeEdits, emptyEdits } from '../data/challengesData.js';

let memo = null; // last loaded or saved edits, so switching between the two tabs does not flash empty

export function useChallengeEdits() {
  const [saved, setSaved] = useState(() => memo || emptyEdits());
  const [loading, setLoading] = useState(!memo);
  const [draft, setDraft] = useState(null); // not null while someone is editing
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);     // { text, bad }

  useEffect(() => {
    let off = false;
    loadChallengeEdits().then((e) => { if (off) return; memo = e; setSaved(e); setLoading(false); });
    return () => { off = true; };
  }, []);

  const editing = draft !== null;
  const view = draft || saved;

  const startEdit = () => { setMsg(null); setDraft(structuredClone(saved)); };
  const cancel = () => setDraft(null);
  const save = async () => {
    setSaving(true);
    const r = await saveChallengeEdits(draft);
    setSaving(false);
    if (r.ok) { memo = draft; setSaved(draft); setDraft(null); setMsg({ text: 'Saved for everyone who opens this dashboard.', bad: false }); }
    else setMsg({ text: r.connected ? 'Could not save - please try again.' : 'Not saved: the shared store is not connected, so edits cannot be kept.', bad: true });
  };

  const setField = (id, field, value) => setDraft((d) => ({ ...d, overrides: { ...d.overrides, [id]: { ...(d.overrides[id] || {}), [field]: value } } }));
  const addItem = (kind, item) => setDraft((d) => ({ ...d, extra: { ...d.extra, [kind]: [...d.extra[kind], item] } }));
  const removeItem = (kind, id) => setDraft((d) => (
    id.startsWith('x-')
      ? { ...d, extra: { ...d.extra, [kind]: d.extra[kind].filter((i) => i.id !== id) } }
      : { ...d, removed: [...d.removed, id] }
  ));
  const resetAll = () => setDraft(emptyEdits());

  return { view, loading, editing, saving, msg, startEdit, cancel, save, setField, addItem, removeItem, resetAll };
}

export const newId = (kind) => `x-${kind}-${Date.now().toString(36)}`;

export function SeverityPill({ level }) {
  return <span className={`ch-pill sev-${String(level || '').toLowerCase()}`}>{level || '-'}</span>;
}

export function StatusPill({ status }) {
  return <span className={`ch-pill st-${String(status || '').toLowerCase().replace(/\s+/g, '-')}`}>{status || '-'}</span>;
}

export function EditBar({ ed, extra }) {
  return (
    <div className="cmp-selector-wrap">
      {extra}
      {!ed.editing && <button className="edit-btn" onClick={ed.startEdit}>&#9998; Edit</button>}
      {ed.editing && (
        <>
          <button className="edit-btn" onClick={ed.resetAll} title="Remove every change and go back to the starting content">Reset my edits</button>
          <button className="edit-btn" onClick={ed.cancel}>Cancel</button>
          <button className="edit-btn edit-btn-save" onClick={ed.save} disabled={ed.saving}>{ed.saving ? 'Saving...' : 'Save'}</button>
        </>
      )}
    </div>
  );
}

export function SaveMessage({ msg }) {
  if (!msg) return null;
  return <div className={`ch-msg${msg.bad ? ' ch-msg-bad' : ''}`} role="status">{msg.text}</div>;
}
