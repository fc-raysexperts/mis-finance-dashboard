// Format number in Indian system (Cr / L / raw)
export function fmt(v, short = true) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  const n = Number(v);
  const abs = Math.abs(n);
  let s;
  if (short) {
    if (abs >= 10000000) s = (abs / 10000000).toFixed(2) + ' Cr';
    else if (abs >= 100000) s = (abs / 100000).toFixed(2) + ' L';
    else s = Math.round(abs).toLocaleString('en-IN');
  } else {
    s = Math.round(abs).toLocaleString('en-IN');
  }
  return n < 0 ? `(${s})` : s;
}

export function rowSum(arr, visMo) {
  return visMo.reduce((s, m) => s + (arr[m.idx] || 0), 0);
}
