"use client";

import { formatMoney } from "@/lib/constants";

export const CHART_COLORS = [
  "#10b981",
  "#14b8a6",
  "#0ea5e9",
  "#8b5cf6",
  "#f59e0b",
  "#f43f5e",
  "#6366f1",
  "#84cc16",
  "#f97316",
  "#06b6d4",
];

export function AreaLineChart({
  data,
  height = 200,
  format = formatMoney,
}: {
  data: { label: string; value: number }[];
  height?: number;
  format?: (v: number) => string;
}) {
  const W = 600;
  const H = height;
  const PAD = 8;
  const max = Math.max(...data.map((d) => d.value), 1);
  const stepX = data.length > 1 ? (W - PAD * 2) / (data.length - 1) : 0;
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2 - 16);
  const pts = data.map((d, i) => ({
    x: PAD + i * stepX,
    y: y(d.value),
    ...d,
  }));
  const line = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${pts[pts.length - 1]?.x ?? PAD},${H - PAD} L${pts[0]?.x ?? PAD},${H - PAD} Z`;
  const gridVals = [0, 0.5, 1].map((f) => H - PAD - f * (H - PAD * 2 - 16));

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Revenue trend chart"
      >
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridVals.map((gy, i) => (
          <line
            key={i}
            x1={PAD}
            x2={W - PAD}
            y1={gy}
            y2={gy}
            stroke="#e2e8f0"
            strokeWidth="1"
            strokeDasharray="3 4"
          />
        ))}
        <path d={area} fill="url(#areaFill)" />
        <path d={line} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r={p.value > 0 ? 3.5 : 2}
              fill="#ffffff"
              stroke="#10b981"
              strokeWidth="2"
            >
              <title>{`${p.label}: ${format(p.value)}`}</title>
            </circle>
          </g>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] font-semibold uppercase text-slate-400">
        <span>{data[0]?.label ?? ""}</span>
        <span>{data[data.length - 1]?.label ?? ""}</span>
      </div>
    </div>
  );
}

export function DonutChart({
  data,
  size = 160,
}: {
  data: { label: string; value: number }[];
  size?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const R = 60;
  const C = 2 * Math.PI * R;
  const cx = size / 2;
  const cy = size / 2;
  let acc = 0;

  if (total === 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="No data">
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="#e2e8f0" strokeWidth="18" />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Category breakdown">
      <g transform={`rotate(-90 ${cx} ${cy})`}>
        {data.map((d, i) => {
          const frac = d.value / total;
          const dash = frac * C;
          const offset = -acc * C;
          acc += frac;
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={R}
              fill="none"
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth="18"
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={offset}
            >
              <title>{`${d.label}: ${formatMoney(d.value)}`}</title>
            </circle>
          );
        })}
      </g>
      <text
        x={cx}
        y={cy - 2}
        textAnchor="middle"
        className="fill-slate-800"
        fontSize="15"
        fontWeight="700"
      >
        {data.length}
      </text>
      <text
        x={cx}
        y={cy + 14}
        textAnchor="middle"
        className="fill-slate-400"
        fontSize="9"
        fontWeight="600"
      >
        CATEGORIES
      </text>
    </svg>
  );
}

export function HBarList({
  rows,
  format = formatMoney,
}: {
  rows: { label: string; value: number; sub?: string }[];
  format?: (v: number) => string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-semibold capitalize text-slate-600">
              {r.label}
            </span>
            <span className="font-bold tabular-nums text-slate-800">
              {format(r.value)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400"
              style={{ width: `${Math.max((r.value / max) * 100, r.value > 0 ? 4 : 0)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DonutLegend({
  data,
}: {
  data: { label: string; value: number }[];
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  return (
    <div className="mt-3 space-y-1.5">
      {data.map((d, i) => (
        <div key={i} className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-2 text-slate-600">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
            />
            <span className="max-w-[10rem] truncate">{d.label}</span>
          </span>
          <span className="font-semibold tabular-nums text-slate-500">
            {((d.value / total) * 100).toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  );
}
