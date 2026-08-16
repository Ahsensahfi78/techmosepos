"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/constants";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/Toast";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import {
  AreaLineChart,
  DonutChart,
  DonutLegend,
  HBarList,
  CHART_COLORS,
} from "@/components/charts";
import { downloadCSV, exportDashboardPDF } from "@/lib/export";
import type { AnalyticsReport } from "@/lib/types";

type Preset = "today" | "week" | "month" | "custom";
const TREND_OPTIONS = [7, 30, 90];

function dateStr(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function presetRange(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const today = dateStr(now);
  if (preset === "today") return { from: today, to: today };
  if (preset === "week") {
    const day = now.getDay() === 0 ? 7 : now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day - 1));
    return { from: dateStr(monday), to: today };
  }
  if (preset === "month") {
    return { from: dateStr(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  }
  return { from: today, to: today };
}

function ChangePill({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${
        up ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400"
      }`}
    >
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const role = user?.role ?? "";
  const isAnalytics = ["super_admin", "admin", "manager", "accountant"].includes(role);

  const [preset, setPreset] = useState<Preset>("week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [trendDays, setTrendDays] = useState(7);
  const [data, setData] = useState<AnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number>(0);
  const [forceRefresh, setForceRefresh] = useState(0);
  const cacheRef = useRef<{ key: string; data: AnalyticsReport; at: number } | null>(null);

  const range = useMemo(() => {
    if (preset === "custom") {
      return { from: customFrom || dateStr(new Date()), to: customTo || customFrom || dateStr(new Date()) };
    }
    return presetRange(preset);
  }, [preset, customFrom, customTo]);

  const cacheKey = useMemo(
    () => `${range.from}|${range.to}|${trendDays}`,
    [range, trendDays]
  );

  const load = useCallback(async () => {
    const cached = cacheRef.current;
    if (cached && cached.key === cacheKey && Date.now() - cached.at < 60_000 && forceRefresh === 0) {
      setData(cached.data);
      setLastUpdated(cached.at);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.reports.analytics({
        date_from: range.from,
        date_to: range.to,
        trend_days: trendDays,
      });
      cacheRef.current = { key: cacheKey, data: res, at: Date.now() };
      setData(res);
      setLastUpdated(Date.now());
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load dashboard", "error");
    } finally {
      setLoading(false);
    }
  }, [range, trendDays, cacheKey, forceRefresh, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = () => {
    cacheRef.current = null;
    setForceRefresh((f) => f + 1);
  };

  const overview = data?.overview;
  const trendData = useMemo(
    () =>
      (data?.trend ?? []).map((t) => ({
        label: new Date(t.date + "T00:00:00").toLocaleDateString("en-LK", {
          day: "2-digit",
          month: "short",
        }),
        value: t.revenue,
      })),
    [data]
  );
  const categoryData = useMemo(
    () =>
      (data?.category_breakdown ?? []).map((c) => ({
        label: c.category,
        value: c.revenue,
      })),
    [data]
  );
  const payData = useMemo(
    () =>
      (data?.payment_breakdown ?? []).map((p) => ({
        label: p.method,
        value: p.amount,
        sub: `${p.orders} order${p.orders === 1 ? "" : "s"}`,
      })),
    [data]
  );
  const profitData = useMemo(
    () =>
      (data?.profit.by_category ?? [])
        .filter((c) => c.revenue > 0)
        .map((c) => ({
          label: c.category,
          value: c.profit,
          sub: `${formatMoney(c.revenue)} rev`,
        })),
    [data]
  );

  function exportCSV() {
    if (!data) return;
    const rows: (string | number)[][] = [];
    rows.push(["", ""], ["OVERVIEW"], ["Orders", data.overview.orders], ["Revenue", data.overview.revenue], ["Avg order value", data.overview.avg_order_value], ["Revenue change %", data.overview.revenue_change_pct]);
    rows.push(["", ""], ["TOP PRODUCTS"], ["Product", "Units sold", "Revenue", "COGS"]);
    data.top_products.forEach((p) => rows.push([p.name, p.units_sold, p.revenue, p.cogs]));
    rows.push(["", ""], ["CATEGORIES"], ["Category", "Revenue"]);
    data.category_breakdown.forEach((c) => rows.push([c.category, c.revenue]));
    rows.push(["", ""], ["PAYMENTS"], ["Method", "Orders", "Amount"]);
    data.payment_breakdown.forEach((p) => rows.push([p.method, p.orders, p.amount]));
    rows.push(["", ""], ["RECENT TRANSACTIONS"], ["Reference", "Party", "Total", "Status"]);
    data.recent_transactions.forEach((t) => rows.push([t.reference, t.party_name ?? "Walk-in", t.total, t.status]));
    downloadCSV(`dashboard-${data.range.from}-${data.range.to}.csv`, [], rows);
    toast("Dashboard exported as CSV", "success");
  }

  function exportPDF() {
    if (!data) return;
    try {
      exportDashboardPDF(data, "TechMOS");
      toast("Dashboard exported as PDF", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "PDF export failed", "error");
    }
  }

  const storeName = "TechMOS";

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle={`${storeName} · ${data ? `${data.range.from} → ${data.range.to}` : "…"}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl bg-white p-1 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
            {(
              [
                { key: "today", label: "Today" },
                { key: "week", label: "This week" },
                { key: "month", label: "This month" },
                { key: "custom", label: "Custom" },
              ] as { key: Preset; label: string }[]
            ).map((p) => (
              <button
                key={p.key}
                onClick={() => setPreset(p.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  preset === p.key
                    ? "bg-slate-900 text-white dark:bg-slate-700"
                    : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {preset === "custom" && (
            <div className="flex items-center gap-1.5">
              <input type="date" className="input h-9 !w-auto text-xs" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              <span className="text-slate-400">–</span>
              <input type="date" className="input h-9 !w-auto text-xs" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          )}
          <div className="flex items-center gap-1 rounded-xl bg-white p-1 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
            {TREND_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setTrendDays(d)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                  trendDays === d
                    ? "bg-emerald-500 text-white"
                    : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <button onClick={refresh} className="btn btn-secondary btn-sm">
            ↻ Refresh
          </button>
          <button onClick={exportCSV} className="btn btn-secondary btn-sm">
            ⬇ CSV
          </button>
          <button onClick={exportPDF} className="btn btn-secondary btn-sm">
            ⬇ PDF
          </button>
        </div>
      </PageHeader>

      {loading && !data ? (
        <DashboardSkeleton />
      ) : !data ? (
        <EmptyState icon="📊" title="Could not load dashboard" hint="Is the backend running?" />
      ) : !isAnalytics ? (
        <CashierView data={data} onRefresh={refresh} />
      ) : (
        <>
          {/* Overview cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <OverviewCard
              label="Revenue"
              value={formatMoney(overview!.revenue)}
              sub={`${overview!.orders} orders`}
              icon="💰"
              iconClass="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400"
            >
              <ChangePill pct={overview!.revenue_change_pct} />
            </OverviewCard>
            <OverviewCard
              label="Orders"
              value={String(overview!.orders)}
              sub="vs previous period"
              icon="🧾"
              iconClass="bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400"
            >
              <ChangePill pct={overview!.orders_change_pct} />
            </OverviewCard>
            <OverviewCard
              label="Avg order value"
              value={formatMoney(overview!.avg_order_value)}
              sub="per transaction"
              icon="🎯"
              iconClass="bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400"
            />
            <OverviewCard
              label="Gross profit"
              value={formatMoney(data.profit.gross_profit)}
              sub={`${data.profit.margin_pct}% margin`}
              icon="📈"
              iconClass="bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            {/* Revenue trend */}
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Revenue trend</h2>
                <span className="text-xs text-slate-400">last {trendDays} days</span>
              </div>
              {trendData.every((t) => t.value === 0) ? (
                <WidgetEmpty hint="No sales in this period yet — make your first sale on the POS page!" />
              ) : (
                <AreaLineChart data={trendData} />
              )}
            </section>

            {/* Category breakdown */}
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Sales by category</h2>
              </div>
              {categoryData.length === 0 ? (
                <WidgetEmpty hint="No category sales in this period." />
              ) : (
                <div className="flex flex-col items-center">
                  <DonutChart data={categoryData} />
                  <div className="w-full">
                    <DonutLegend data={categoryData} />
                  </div>
                </div>
              )}
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            {/* Top products */}
            <section className="card !p-0 overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                <h2 className="card-title">Top selling products</h2>
                <span className="text-xs text-slate-400">by units sold</span>
              </div>
              {data.top_products.length === 0 ? (
                <div className="px-5 py-10">
                  <WidgetEmpty hint="Nothing sold in this period yet." />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table !min-w-0">
                    <thead>
                      <tr>
                        <th className="px-5">#</th>
                        <th>Product</th>
                        <th className="text-right">Units</th>
                        <th className="text-right">Revenue</th>
                        <th className="text-right">Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.top_products.map((p, i) => (
                        <tr key={p.product_id}>
                          <td className="px-5">
                            <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                              {i + 1}
                            </span>
                          </td>
                          <td className="max-w-[16rem] truncate font-semibold">{p.name}</td>
                          <td className="text-right tabular-nums">{p.units_sold}</td>
                          <td className="text-right font-semibold tabular-nums">{formatMoney(p.revenue)}</td>
                          <td className="text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                            {formatMoney(p.revenue - p.cogs)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Low stock */}
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Low stock alerts</h2>
                <Link href="/inventory" className="text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-400">
                  Inventory →
                </Link>
              </div>
              {data.low_stock.length === 0 ? (
                <WidgetEmpty hint="✅ Everything is well stocked" />
              ) : (
                <div className="space-y-2">
                  {data.low_stock.map((p) => (
                    <div key={p.product_id} className="flex items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2.5 dark:bg-amber-900/20">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{p.name}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {p.category ?? "General"} · min {p.threshold}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold text-white ${p.stock === 0 ? "bg-red-500" : "bg-amber-500"}`}>
                          {p.stock} left
                        </span>
                        <Link
                          href="/purchases"
                          title={`Restock ${p.name} (suggest ${p.suggested_qty})`}
                          className="rounded-md bg-emerald-500 px-2 py-1 text-[11px] font-bold text-white transition hover:bg-emerald-600"
                        >
                          Restock
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {/* Payment split */}
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Payment methods</h2>
              </div>
              {payData.length === 0 ? (
                <WidgetEmpty hint="No payments recorded in this period." />
              ) : (
                <HBarList rows={payData} />
              )}
            </section>

            {/* Customer insights */}
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Customer insights</h2>
              </div>
              <div className="mb-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
                  <div className="text-lg font-bold text-slate-900 dark:text-slate-100">{data.customer_insights.new_customers}</div>
                  <div className="text-[10px] font-semibold uppercase text-slate-400">New</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
                  <div className="text-lg font-bold text-slate-900 dark:text-slate-100">{data.customer_insights.returning_customers}</div>
                  <div className="text-[10px] font-semibold uppercase text-slate-400">Returning</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
                  <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{data.customer_insights.total_customers}</div>
                  <div className="text-[10px] font-semibold uppercase text-slate-400">Total</div>
                </div>
              </div>
              {data.customer_insights.top_customers.length === 0 ? (
                <WidgetEmpty hint="No customer sales in this period." />
              ) : (
                <div className="space-y-1.5">
                  {data.customer_insights.top_customers.map((c, i) => (
                    <div key={c.customer_id} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm">
                      <span className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                        />
                        <span className="truncate font-semibold">{c.name}</span>
                        <span className="text-xs text-slate-400">{c.orders} ord.</span>
                      </span>
                      <span className="font-semibold tabular-nums">{formatMoney(c.spend)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Profit by category */}
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Profit by category</h2>
                <span className="text-xs text-slate-400">
                  gross {formatMoney(data.profit.gross_profit)}
                </span>
              </div>
              {profitData.length === 0 ? (
                <WidgetEmpty hint="No cost data yet — add cost prices to products." />
              ) : (
                <HBarList rows={profitData} format={(v) => formatMoney(v)} />
              )}
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            {/* Recent transactions */}
            <section className="card !p-0 overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                <h2 className="card-title">Recent transactions</h2>
                <Link href="/transactions" className="text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-400">
                  All transactions →
                </Link>
              </div>
              {data.recent_transactions.length === 0 ? (
                <div className="px-5 py-10">
                  <WidgetEmpty hint="No sales yet — make your first sale on the POS page!" />
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.recent_transactions.map((t) => (
                    <div key={t.key} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {t.reference}
                          <span className="ml-2 font-normal text-slate-400">
                            {t.party_name ?? "Walk-in"} · {t.item_count} item{t.item_count === 1 ? "" : "s"}
                          </span>
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {new Date(t.date).toLocaleString("en-LK", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold tabular-nums">{formatMoney(t.total)}</span>
                        <Link
                          href={`/transactions?q=${encodeURIComponent(t.reference)}`}
                          className="btn btn-sm btn-secondary"
                        >
                          View
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Dead stock */}
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Dead stock</h2>
                <span className="text-xs text-slate-400">no sales in 30 days</span>
              </div>
              {data.dead_stock.length === 0 ? (
                <WidgetEmpty hint="🎉 No dead stock — everything has moved in the last 30 days" />
              ) : (
                <div className="space-y-1.5">
                  {data.dead_stock.slice(0, 8).map((p) => (
                    <div key={p.product_id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
                      <span className="min-w-0 truncate font-semibold">{p.name}</span>
                      <span className="ml-2 shrink-0 text-xs text-slate-400">{p.stock} in stock</span>
                    </div>
                  ))}
                  {data.dead_stock.length > 8 && (
                    <p className="pt-1 text-center text-xs text-slate-400">
                      +{data.dead_stock.length - 8} more dead stock items
                    </p>
                  )}
                </div>
              )}
            </section>
          </div>

          {lastUpdated > 0 && (
            <p className="text-center text-xs text-slate-400">
              Updated {new Date(lastUpdated).toLocaleTimeString("en-LK")} · cached for 60s
            </p>
          )}
        </>
      )}
    </div>
  );
}

function CashierView({
  data,
  onRefresh,
}: {
  data: AnalyticsReport;
  onRefresh: () => void;
}) {
  const o = data.overview;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <OverviewCard label="Today's revenue" value={formatMoney(o.revenue)} sub={`${o.orders} orders`} icon="💰" iconClass="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400">
          <ChangePill pct={o.revenue_change_pct} />
        </OverviewCard>
        <OverviewCard label="Orders" value={String(o.orders)} sub="this period" icon="🧾" iconClass="bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400">
          <ChangePill pct={o.orders_change_pct} />
        </OverviewCard>
        <OverviewCard label="Avg order value" value={formatMoney(o.avg_order_value)} sub="per transaction" icon="🎯" iconClass="bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400" />
        <OverviewCard label="Low stock" value={String(data.low_stock.length)} sub="items need restocking" icon="⚠️" iconClass="bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400" />
      </div>

      <div className="flex justify-end">
        <button onClick={onRefresh} className="btn btn-secondary btn-sm">↻ Refresh</button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="card !p-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
            <h2 className="card-title">Recent transactions</h2>
            <Link href="/transactions" className="text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-400">All transactions →</Link>
          </div>
          {data.recent_transactions.length === 0 ? (
            <div className="px-5 py-10">
              <WidgetEmpty hint="No sales yet — make your first sale on the POS page!" />
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.recent_transactions.map((t) => (
                <div key={t.key} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {t.reference}
                      <span className="ml-2 font-normal text-slate-400">{t.party_name ?? "Walk-in"} · {t.item_count} item{t.item_count === 1 ? "" : "s"}</span>
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {new Date(t.date).toLocaleString("en-LK", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold tabular-nums">{formatMoney(t.total)}</span>
                    <Link href={`/transactions?q=${encodeURIComponent(t.reference)}`} className="btn btn-sm btn-secondary">View</Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Stock alerts</h2>
            <Link href="/inventory" className="text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-400">Inventory →</Link>
          </div>
          {data.low_stock.length === 0 ? (
            <WidgetEmpty hint="✅ Everything is well stocked" />
          ) : (
            <div className="space-y-2">
              {data.low_stock.map((p) => (
                <div key={p.product_id} className="flex items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2.5 dark:bg-amber-900/20">
                  <p className="min-w-0 truncate text-sm font-semibold">{p.name}</p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold text-white ${p.stock === 0 ? "bg-red-500" : "bg-amber-500"}`}>
                    {p.stock} left
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function OverviewCard({
  label,
  value,
  sub,
  icon,
  iconClass,
  children,
}: {
  label: string;
  value: string;
  sub: string;
  icon: string;
  iconClass: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="card !p-4">
      <div className="flex items-center gap-2">
        <span className={`grid h-9 w-9 place-items-center rounded-xl text-base ${iconClass}`}>{icon}</span>
        <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{value}</div>
      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">{sub}{children}</div>
    </div>
  );
}

function WidgetEmpty({ hint }: { hint: string }) {
  return <p className="py-8 text-center text-sm text-slate-400">{hint}</p>;
}

function DashboardSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-28 rounded-2xl bg-slate-200 dark:bg-slate-800" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="h-64 rounded-2xl bg-slate-200 dark:bg-slate-800" />
        <div className="h-64 rounded-2xl bg-slate-200 dark:bg-slate-800" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="h-80 rounded-2xl bg-slate-200 dark:bg-slate-800" />
        <div className="h-80 rounded-2xl bg-slate-200 dark:bg-slate-800" />
      </div>
    </div>
  );
}
