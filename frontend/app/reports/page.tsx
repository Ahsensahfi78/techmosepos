"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/constants";
import { useToast } from "@/components/ui/Toast";
import StatCard from "@/components/ui/StatCard";
import EmptyState from "@/components/ui/EmptyState";
import PageHeader from "@/components/ui/PageHeader";
import type {
  AnalyticsReport,
  CashierPerformanceRow,
  SalesReport,
  StockReport,
  TaxDiscountCollection,
} from "@/lib/types";

type Period = 7 | 30 | 0;

const methodLabels: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  cheque: "Cheque",
  bank: "Bank transfer",
  split: "Split",
};

export default function ReportsPage() {
  const [stock, setStock] = useState<StockReport | null>(null);
  const [sales, setSales] = useState<SalesReport | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsReport | null>(null);
  const [cashiers, setCashiers] = useState<CashierPerformanceRow[]>([]);
  const [taxes, setTaxes] = useState<TaxDiscountCollection | null>(null);
  const [period, setPeriod] = useState<Period>(7);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const periodLabel =
    period === 7 ? "last 7 days" : period === 30 ? "last 30 days" : "all time";

  async function load() {
    setLoading(true);
    try {
      const days = period === 0 ? undefined : period;
      const [s, r, a, c, t] = await Promise.all([
        api.reports.stock(),
        api.reports.sales(days),
        api.reports.analytics({ trend_days: period === 0 ? 365 : period }),
        api.reports.cashiers(days),
        api.reports.taxesDiscounts(days),
      ]);
      setStock(s);
      setSales(r);
      setAnalytics(a);
      setCashiers(c.cashiers);
      setTaxes(t);
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Failed to load reports",
        "error"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [period]);

  const maxRevenue = useMemo(
    () => Math.max(...(sales?.top_products.map((t) => t.revenue) ?? [1]), 1),
    [sales]
  );

  const payTotal =
    analytics?.payment_breakdown.reduce((s, p) => s + (p.amount || 0), 0) ?? 0;

  const hasData = useMemo(
    () =>
      !!(
        stock?.low_stock.length ||
        stock?.out_of_stock.length ||
        sales?.top_products.length ||
        (analytics &&
          (analytics.overview.orders > 0 ||
            analytics.payment_breakdown.length > 0 ||
            analytics.customer_insights.top_customers.length > 0 ||
            analytics.profit.revenue > 0 ||
            analytics.dead_stock.length > 0)) ||
        cashiers.length > 0 ||
        (taxes && taxes.orders > 0)
      ),
    [stock, sales, analytics, cashiers, taxes]
  );

  function exportCsv() {
    if (!stock || !sales) return;
    const rows: string[] = [
      ["TechMOS Stock Report", new Date().toLocaleString()].join(","),
      "",
      "Product,Category,Price,Stock",
      ...stock.low_stock
        .concat(stock.out_of_stock)
        .map((p) =>
          [p.name, p.category, p.price, p.stock].map(escapeCsv).join(",")
        ),
      "",
      `Total products,${stock.total_products}`,
      `Total units,${stock.total_units}`,
      `Stock value,${stock.total_value}`,
      "",
      "Sales Summary",
      `Total sales,${sales.total_sales}`,
      `Total revenue,${sales.total_revenue}`,
      "",
      "Top Products",
      "Product,Units sold,Revenue",
      ...sales.top_products.map((t) =>
        [t.name, t.units_sold, t.revenue].map(escapeCsv).join(",")
      ),
    ];
    const blob = new Blob([rows.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `techmos-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Report exported as CSV", "success");
  }

  if (loading && !stock) {
    return (
      <div className="animate-pulse space-y-6 pt-4">
        <div className="h-8 w-48 rounded-lg bg-slate-200" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded-2xl bg-slate-200" />
          ))}
        </div>
        <div className="h-80 rounded-2xl bg-slate-200" />
      </div>
    );
  }

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title="Stock & Sales Report" subtitle={periodLabel}>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
            {([7, 30, 0] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  period === p
                    ? "bg-slate-900 text-white"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {p === 0 ? "All" : `${p}d`}
              </button>
            ))}
          </div>
          <button onClick={exportCsv} className="btn btn-secondary">
            ⬇ CSV
          </button>
          <button
            onClick={load}
            className="btn bg-slate-900 text-white hover:bg-slate-700"
          >
            Refresh
          </button>
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Products"
          value={String(stock?.total_products ?? 0)}
          sub="in catalog"
          icon="📦"
          iconClass="bg-slate-100 text-slate-600"
        />
        <StatCard
          label="Units in stock"
          value={String(stock?.total_units ?? 0)}
          sub="total items"
          icon="🗂️"
          iconClass="bg-teal-100 text-teal-600"
        />
        <StatCard
          label="Stock value"
          value={formatMoney(stock?.total_value ?? 0)}
          sub="at retail price"
          icon="💰"
          iconClass="bg-emerald-100 text-emerald-600"
        />
        <StatCard
          label="Sales · revenue"
          value={String(sales?.total_sales ?? 0)}
          sub={formatMoney(sales?.total_revenue ?? 0)}
          icon="📈"
          iconClass="bg-indigo-100 text-indigo-600"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {analytics && analytics.overview.orders > 0 && (
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Sales trend ({periodLabel})</h2>
              <span className="text-xs text-slate-400">
                revenue & transactions per day
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  Revenue
                </p>
                <p className="text-sm font-bold text-slate-900">
                  {formatMoney(analytics.overview.revenue)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  Transactions
                </p>
                <p className="text-sm font-bold text-slate-900">
                  {analytics.overview.orders}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  Avg order
                </p>
                <p className="text-sm font-bold text-slate-900">
                  {formatMoney(analytics.overview.avg_order_value)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  vs previous
                </p>
                <p
                  className={`text-sm font-bold ${
                    analytics.overview.revenue_change_pct >= 0
                      ? "text-emerald-600"
                      : "text-rose-600"
                  }`}
                >
                  {analytics.overview.revenue_change_pct >= 0 ? "▲" : "▼"}{" "}
                  {Math.abs(analytics.overview.revenue_change_pct)}%
                </p>
              </div>
            </div>
            <div className="mt-3 max-h-72 overflow-y-auto rounded-xl ring-1 ring-slate-100">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left font-bold">Date</th>
                    <th className="px-3 py-2 text-right font-bold">Sales</th>
                    <th className="px-3 py-2 text-right font-bold">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {analytics.trend.map((t) => (
                    <tr key={t.date}>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {t.date}
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-semibold">
                        {t.orders}
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-bold text-slate-900">
                        {formatMoney(t.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {analytics && analytics.payment_breakdown.length > 0 && (
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Payment methods</h2>
              <span className="text-xs text-slate-400">collections</span>
            </div>
            <div className="mt-3 space-y-3">
              {analytics.payment_breakdown.map((p) => (
                <div key={p.method}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-semibold capitalize">
                      {methodLabels[p.method] ?? p.method}
                    </span>
                    <span className="text-xs text-slate-500">
                      {p.orders} txn ·{" "}
                      <span className="font-bold text-emerald-600">
                        {formatMoney(p.amount)}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-400"
                      style={{
                        width: `${payTotal > 0 ? Math.max((p.amount / payTotal) * 100, 2) : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {sales && sales.top_products.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Top sellers ({periodLabel})</h2>
            <span className="text-xs text-slate-400">by revenue</span>
          </div>
          <div className="mt-4 space-y-3">
            {sales.top_products.slice(0, 6).map((t, i) => (
              <div key={t.name} className="flex items-center gap-3">
                <span className="w-5 text-right text-xs font-bold text-slate-400">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-semibold">{t.name}</span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {t.units_sold} sold ·{" "}
                      <span className="font-bold text-emerald-600">
                        {formatMoney(t.revenue)}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
                      style={{
                        width: `${Math.max((t.revenue / maxRevenue) * 100, 4)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {analytics && analytics.profit.revenue > 0 && (
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Profit & loss</h2>
              <span className="text-xs text-slate-400">cost vs selling</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  Revenue
                </p>
                <p className="text-sm font-bold text-slate-900">
                  {formatMoney(analytics.profit.revenue)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  COGS
                </p>
                <p className="text-sm font-bold text-slate-600">
                  {formatMoney(analytics.profit.cogs)}
                </p>
              </div>
              <div className="rounded-xl bg-emerald-50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-500">
                  Gross profit
                </p>
                <p className="text-sm font-bold text-emerald-600">
                  {formatMoney(analytics.profit.gross_profit)}
                </p>
              </div>
              <div className="rounded-xl bg-indigo-50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-500">
                  Margin
                </p>
                <p className="text-sm font-bold text-indigo-600">
                  {analytics.profit.margin_pct}%
                </p>
              </div>
            </div>
            {analytics.profit.by_category.length > 0 && (
              <div className="mt-3 max-h-64 overflow-y-auto rounded-xl ring-1 ring-slate-100">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-3 py-2 text-left font-bold">
                        Category
                      </th>
                      <th className="px-3 py-2 text-right font-bold">
                        Revenue
                      </th>
                      <th className="px-3 py-2 text-right font-bold">COGS</th>
                      <th className="px-3 py-2 text-right font-bold">
                        Profit
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analytics.profit.by_category.map((c) => (
                      <tr key={c.category}>
                        <td className="px-3 py-2 text-xs font-semibold">
                          {c.category}
                        </td>
                        <td className="px-3 py-2 text-right text-xs">
                          {formatMoney(c.revenue)}
                        </td>
                        <td className="px-3 py-2 text-right text-xs text-slate-500">
                          {formatMoney(c.cogs)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right text-xs font-bold ${
                            c.profit >= 0 ? "text-emerald-600" : "text-rose-600"
                          }`}
                        >
                          {formatMoney(c.profit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {analytics &&
          analytics.customer_insights.top_customers.length > 0 && (
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Top customers</h2>
                <span className="text-xs text-slate-400">
                  top spenders & repeat buyers
                </span>
              </div>
              <div className="mt-3 space-y-3">
                {analytics.customer_insights.top_customers.map((c, i) => (
                  <div key={c.customer_id} className="flex items-center gap-3">
                    <span className="w-5 text-right text-xs font-bold text-slate-400">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold">
                          {c.name}
                        </span>
                        <span className="shrink-0 text-xs font-bold text-emerald-600">
                          {formatMoney(c.spend)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        {c.orders} purchase{c.orders === 1 ? "" : "s"}
                        {c.phone ? ` · ${c.phone}` : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
      </div>

      {cashiers.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Cashier performance ({periodLabel})</h2>
            <span className="text-xs text-slate-400">by revenue</span>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left font-bold">Cashier</th>
                  <th className="px-3 py-2 text-right font-bold">Orders</th>
                  <th className="px-3 py-2 text-right font-bold">Items</th>
                  <th className="px-3 py-2 text-right font-bold">Revenue</th>
                  <th className="px-3 py-2 text-right font-bold">Avg</th>
                  <th className="px-3 py-2 text-right font-bold">Discounts</th>
                  <th className="px-3 py-2 text-right font-bold">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cashiers.map((c) => (
                  <tr key={c.user_id}>
                    <td className="px-3 py-2.5 text-xs font-semibold">
                      {c.name}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs">
                      {c.orders}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs">
                      {c.items_sold}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs font-bold">
                      {formatMoney(c.revenue)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs">
                      {formatMoney(c.avg_order)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs text-slate-500">
                      {formatMoney(c.discount_given)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs font-bold text-indigo-600">
                      {c.share_pct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {taxes && taxes.orders > 0 && (
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Discounts & tax collected ({periodLabel})</h2>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <div className="rounded-xl bg-rose-50 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-rose-400">
                Discounts given
              </p>
              <p className="text-sm font-bold text-rose-600">
                {formatMoney(taxes.discount_total)}
              </p>
            </div>
            <div className="rounded-xl bg-emerald-50 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-500">
                Tax collected
              </p>
              <p className="text-sm font-bold text-emerald-600">
                {formatMoney(taxes.tax_total)}
              </p>
            </div>
            <div className="rounded-xl bg-amber-50 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-amber-500">
                Points redeemed
              </p>
              <p className="text-sm font-bold text-amber-700">
                {taxes.points_redeemed}
              </p>
            </div>
            <div className="rounded-xl bg-indigo-50 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-500">
                Returns refunded
              </p>
              <p className="text-sm font-bold text-indigo-600">
                {formatMoney(taxes.refunded)}
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            {taxes.orders} transactions · {formatMoney(taxes.revenue)} revenue ·
            {taxes.returns} return{taxes.returns === 1 ? "" : "s"}
          </p>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Low stock (≤ 5)</h2>
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">
              {stock?.low_stock.length ?? 0}
            </span>
          </div>
          {stock?.low_stock.length ? (
            <div className="mt-3 space-y-2">
              {stock.low_stock.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-xl bg-amber-50 px-3.5 py-2.5"
                >
                  <div>
                    <p className="text-sm font-semibold">{p.name}</p>
                    <p className="text-[11px] text-slate-500">{p.category}</p>
                  </div>
                  <span className="rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-white">
                    {p.stock} left
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-slate-400">
              ✅ All good — no low stock items
            </p>
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Out of stock</h2>
            <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700">
              {stock?.out_of_stock.length ?? 0}
            </span>
          </div>
          {stock?.out_of_stock.length ? (
            <div className="mt-3 space-y-2">
              {stock.out_of_stock.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-xl bg-red-50 px-3.5 py-2.5"
                >
                  <div>
                    <p className="text-sm font-semibold">{p.name}</p>
                    <p className="text-[11px] text-slate-500">{p.category}</p>
                  </div>
                  <span className="rounded-full bg-red-500 px-2.5 py-1 text-[11px] font-bold text-white">
                    Sold out
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-slate-400">
              Everything is in stock
            </p>
          )}
        </section>
      </div>

      {analytics && analytics.dead_stock.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Slow movers</h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
              {analytics.dead_stock.length}
            </span>
          </div>
          <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
            {analytics.dead_stock.map((p) => (
              <div
                key={p.product_id}
                className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{p.name}</p>
                  <p className="text-[11px] text-slate-500">
                    {p.category}
                    {p.sku ? ` · ${p.sku}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xs font-bold text-slate-500">
                  {p.stock} in stock
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            No sales in the last 30 days
          </p>
        </section>
      )}

      {!hasData && (
        <EmptyState
          icon="📈"
          title="No report data yet"
          hint="Make some sales and keep products stocked to see insights."
        />
      )}
    </div>
  );
}

function escapeCsv(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
