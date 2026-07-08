// Client wrapper for the shared /api/store backend (Vercel KV).
// Used for anything that must persist across browsers/devices:
// editable investor data, and cached live Zoho Books figures.

export async function getRemote(key, fallback = null) {
  try {
    const r = await fetch(`/api/store?key=${encodeURIComponent(key)}`);
    if (!r.ok) return fallback;
    const d = await r.json();
    return (d.value !== undefined && d.value !== null) ? d.value : fallback;
  } catch {
    return fallback;
  }
}

export async function setRemote(key, value) {
  try {
    await fetch('/api/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
    return true;
  } catch (e) {
    console.error('Remote store save failed:', e);
    return false;
  }
}
