import React from 'react';
import {
  ResponsiveContainer, ComposedChart, BarChart, PieChart, Pie, Cell,
  Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
} from 'recharts';
import { fmt } from '../utils.js';

function tickFmt(v) {
  const abs = Math.abs(v);
  if (abs >= 10000000) return (v / 10000000).toFixed(1) + 'Cr';
  if (abs >= 100000)   return (v / 100000).toFixed(1) + 'L';
  return v;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="chart-tooltip-row">
          <span className="chart-tooltip-dot" style={{ background: p.color }} />
          {p.name}: <b>{fmt(p.value)}</b>
        </div>
      ))}
    </div>
  );
}

// Mid-tone color scheme used across all charts in the dashboard
const MID_REVENUE = '#60a5fa'; // blue-400 (lighter)
const MID_EXPENSE = '#f87171'; // red-400 (lighter)
const MID_EBITDA  = '#34d399'; // emerald-400 (lighter)
const MID_ACCENT  = '#a78bfa'; // violet-400 (lighter)
const MID_PALETTE = ['#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#f87171', '#22d3ee', '#f472b6', '#a3e635'];

// ── Chart 1: Monthly P&L — Revenue/Expense bars + EBITDA line ────────────────
export function RevenueExpenseTrendChart({ months, revenue, expenses, ebitda }) {
  const data = months.map((m, i) => ({
    name: m, Revenue: revenue[i], Expenses: expenses[i], EBITDA: ebitda[i],
  }));
  return (
    <div className="chart-card">
      <div className="chart-card-title">Revenue vs Expenses &amp; EBITDA Trend</div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#475569' }} />
          <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11, fill: '#475569' }} width={55} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Revenue" fill={MID_REVENUE} radius={[4, 4, 0, 0]} maxBarSize={38} />
          <Bar dataKey="Expenses" fill={MID_EXPENSE} radius={[4, 4, 0, 0]} maxBarSize={38} />
          <Line type="monotone" dataKey="EBITDA" stroke="#1e3a5f" strokeWidth={2.5} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Chart 2: Head-wise breakdown pie ──────────────────────────────────────────
export function HeadBreakdownPie({ title, headTotals }) {
  const data = headTotals.filter(h => Math.abs(h.value) > 0.01);
  if (!data.length) return null;
  return (
    <div className="chart-card chart-card-half">
      <div className="chart-card-title">{title}</div>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
            outerRadius={90} innerRadius={45} paddingAngle={2}>
            {data.map((_, i) => <Cell key={i} fill={MID_PALETTE[i % MID_PALETTE.length]} />)}
          </Pie>
          <Tooltip formatter={(v) => fmt(v)} />
          <Legend wrapperStyle={{ fontSize: 11 }} layout="vertical" verticalAlign="middle" align="right" />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Chart 3: Monthly trend bar chart ──────────────────────────────────────────
export function MonthlyTotalBarChart({ title, months, values, color }) {
  const data = months.map((m, i) => ({ name: m, Total: values[i] }));
  return (
    <div className="chart-card chart-card-half">
      <div className="chart-card-title">{title}</div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#475569' }} />
          <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11, fill: '#475569' }} width={55} />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="Total" fill={color || MID_REVENUE} radius={[4, 4, 0, 0]} maxBarSize={42} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Chart 4: FY comparison grouped bar chart ──────────────────────────────────
export function FYComparisonChart({ fyLabels, revenue, expenses, ebitda }) {
  const data = fyLabels.map((f, i) => ({
    name: f, Revenue: revenue[i], Expenses: expenses[i], EBITDA: ebitda[i],
  }));
  return (
    <div className="chart-card">
      <div className="chart-card-title">Fiscal Year Comparison</div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#475569' }} />
          <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11, fill: '#475569' }} width={55} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Revenue" fill={MID_REVENUE} radius={[4, 4, 0, 0]} maxBarSize={34} />
          <Bar dataKey="Expenses" fill={MID_EXPENSE} radius={[4, 4, 0, 0]} maxBarSize={34} />
          <Line type="monotone" dataKey="EBITDA" stroke={MID_ACCENT} strokeWidth={2.5} dot={{ r: 4 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Chart 5: Simple monthly Revenue+EBITDA bar pair (Investor summary) ───────
export function InvestorMonthlyChart({ months, revenue, ebitda, ebitdaMargins }) {
  const data = months.map((m, i) => ({ name: m, Revenue: revenue[i], EBITDA: ebitda[i] }));
  return (
    <div className="chart-card">
      <div className="chart-card-title">Monthly Performance (₹)</div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#475569' }} />
          <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11, fill: '#475569' }} width={55} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Revenue" fill={MID_REVENUE} radius={[4, 4, 0, 0]} maxBarSize={50} />
          <Bar dataKey="EBITDA" fill={MID_EBITDA} radius={[4, 4, 0, 0]} maxBarSize={50} />
        </BarChart>
      </ResponsiveContainer>
      <div className="investor-month-notes">
        {months.map((m, i) => (
          <span key={i} className="investor-month-note">
            {m}: EBITDA {fmt(ebitda[i])} · {ebitdaMargins[i].toFixed(1)}%
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Chart 6: Horizontal % breakdown bars ─────────────────────────────────────
export function MoneyBreakdownBars({ title, items }) {
  return (
    <div className="chart-card chart-card-half money-breakdown">
      <div className="chart-card-title">{title || 'Where The Money Went (% of Revenue)'}</div>
      {items.map((it, i) => (
        <div key={i} className="money-row">
          <span className="money-label">{it.label}</span>
          <div className="money-bar-track">
            <div
              className={`money-bar-fill${it.isEbitda ? ' money-bar-ebitda' : ''}`}
              style={{
                width: `${Math.min(Math.abs(it.pct), 100)}%`,
                background: it.isEbitda ? MID_EBITDA : MID_PALETTE[i % MID_PALETTE.length],
              }}
            />
          </div>
          <span className="money-pct">{it.pct.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

// ── Chart 7: Generic single-series bar chart with custom category labels ────
export function GenericBarChart({ title, categories, values, color, valueLabel, half }) {
  const data = categories.map((c, i) => ({ name: c, [valueLabel || 'Value']: values[i] }));
  return (
    <div className={`chart-card${half ? ' chart-card-half' : ''}`}>
      <div className="chart-card-title">{title}</div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} />
          <YAxis tick={{ fontSize: 11, fill: '#475569' }} width={50} />
          <Tooltip />
          <Bar dataKey={valueLabel || 'Value'} fill={color || MID_REVENUE} radius={[4, 4, 0, 0]} maxBarSize={46} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Chart 8: Generic dual-series bar+line chart (e.g. Revenue vs PBT by year)
export function GenericDualChart({ title, categories, series1, series1Label, series2, series2Label, asLine2 }) {
  const data = categories.map((c, i) => ({ name: c, [series1Label]: series1[i], [series2Label]: series2[i] }));
  return (
    <div className="chart-card">
      <div className="chart-card-title">{title}</div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#475569' }} />
          <YAxis tick={{ fontSize: 11, fill: '#475569' }} width={55} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey={series1Label} fill={MID_REVENUE} radius={[4, 4, 0, 0]} maxBarSize={38} />
          {asLine2
            ? <Line type="monotone" dataKey={series2Label} stroke={MID_ACCENT} strokeWidth={2.5} dot={{ r: 4 }} />
            : <Bar dataKey={series2Label} fill={MID_ACCENT} radius={[4, 4, 0, 0]} maxBarSize={38} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Chart 9: Order Book / probability-tier breakdown with extra columns ─────
export function TierBreakdownBars({ items }) {
  // items: [{ label, pct, cr, orders, gbp }]
  return (
    <div className="chart-card tier-breakdown">
      <div className="chart-card-title">Order Book by Probability Tier (₹ Cr)</div>
      <div className="tier-header-row">
        <span className="tier-col-label"></span>
        <span className="tier-col-bar"></span>
        <span className="tier-col-pct">%</span>
        <span className="tier-col-detail">₹ Cr</span>
        <span className="tier-col-detail">Orders</span>
        <span className="tier-col-detail">£ M</span>
      </div>
      {items.map((it, i) => (
        <div key={i} className="tier-row">
          <span className="tier-label">{it.label}</span>
          <div className="tier-bar-track">
            <div className="tier-bar-fill" style={{
              width: `${Math.min(Math.abs(it.pct), 100)}%`,
              background: MID_PALETTE[i % MID_PALETTE.length],
            }} />
          </div>
          <span className="tier-pct">{it.pct.toFixed(1)}%</span>
          <span className="tier-detail">₹{it.cr}</span>
          <span className="tier-detail">{it.orders}</span>
          <span className="tier-detail">£{it.gbp}M</span>
        </div>
      ))}
    </div>
  );
}

// ── Chart 9b: NPD tab — stacked CWIP/IAUD cost per park ──────────────────────
export function NPDParkCostChart({ parks, cwipValues, iaudValues }) {
  const data = parks.map((p, i) => ({ name: p, IAUD: iaudValues[i] || 0, CWIP: cwipValues[i] || 0 }));
  const CWIP_COLOR = '#f59e0b'; // amber — construction-phase spend, drawn on top
  const IAUD_COLOR = '#60a5fa'; // blue (MID_REVENUE) — development-phase spend, drawn below
  return (
    <div className="chart-card">
      <div className="chart-card-title">Total Cost by Park — CWIP vs IAUD</div>
      <ResponsiveContainer width="100%" height={340}>
        <BarChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="name" interval={0} angle={-35} textAnchor="end"
            tick={{ fontSize: 11, fill: '#475569' }} height={70} />
          <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11, fill: '#475569' }} width={55} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="IAUD" stackId="cost" fill={IAUD_COLOR} />
          <Bar dataKey="CWIP" stackId="cost" fill={CWIP_COLOR} radius={[4, 4, 0, 0]} maxBarSize={42} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
export function RevenuePotentialChart({ parks }) {
  // parks: [{ name, potential }] — sorted descending by potential
  const sorted = [...parks].sort((a, b) => b.potential - a.potential);
  const data = sorted.map(p => ({ name: p.name, Potential: Math.round(p.potential) }));
  const DARK = '#1e3a5f';
  const LIGHT = '#7fa8d9';
  return (
    <div className="chart-card">
      <div className="chart-card-title">Revenue Potential — All Parks (₹ Cr)</div>
      <ResponsiveContainer width="100%" height={340}>
        <BarChart data={data} margin={{ top: 24, right: 10, left: 0, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="name" interval={0} angle={-35} textAnchor="end"
            tick={{ fontSize: 11, fill: '#475569' }} height={70} />
          <YAxis tick={{ fontSize: 11, fill: '#475569' }} width={45} />
          <Tooltip formatter={(v) => `₹${v} Cr`} />
          <Bar dataKey="Potential" radius={[4, 4, 0, 0]} maxBarSize={46}>
            <LabelList dataKey="Potential" position="top" formatter={(v) => `${v} Cr`}
              style={{ fontSize: 11, fontWeight: 700, fill: '#1e3a5f' }} />
            {data.map((_, i) => <Cell key={i} fill={i % 2 === 0 ? LIGHT : DARK} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
