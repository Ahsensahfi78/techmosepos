"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatMoney } from "@/lib/constants";
import { useToast } from "@/components/ui/Toast";
import StatCard from "@/components/ui/StatCard";
import type { DashboardReport } from "@/lib/types";

const actions = [
  {
    href: "/pos",
    label: "Point of Sale",
    desc: "Ring up sales and take payments",
    icon: "🛒",
    tint: "bg-emerald-50 ring-emerald-100",
    iconTint: "bg-emerald-500",
  },
  {
    href: "/dashboard",
    label: "Dashboard",
    desc: "Revenue, trends and stock alerts",
    icon: "📊",
    tint: "bg-teal-50 ring-teal-100",
    iconTint: "bg-teal-500",
  },
  {
    href: "/products",
    label: "Products",
    desc: "Manage your catalog and stock",
    icon: "📦",
    tint: "bg-sky-50 ring-sky-100",
    iconTint: "bg-sky-500",
  },
  {
    href: "/reports",
    label: "Reports",
    desc: "KPIs, top sellers and CSV export",
    icon: "📈",
    tint: "bg-indigo-50 ring-indigo-100",
    iconTint: "bg-indigo-500",
  },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function LandingPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState<DashboardReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.reports
      .dashboard()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled)
          toast(
            err instanceof Error ? err.message : "Failed to load dashboard",
            "error"
          );
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const today = new Date().toLocaleDateString("en-LK", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const roleLabel =
    user?.role.replace("_", " ") === "super admin"
      ? "Super Admin"
      : (user?.role.replace("_", " ") ?? "");

  return (
    <div className="animate-fade-up space-y-6">
      <div>
        <p className="text-sm text-slate-500">{today}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
          {greeting()}, {user?.full_name ?? user?.username}
          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 align-middle text-[11px] font-bold uppercase tracking-wide text-emerald-700">
            {roleLabel}
          </span>
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Here&apos;s how your store is doing today.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Today's revenue"
          value={formatMoney(data?.today_revenue ?? 0)}
          sub={
            data
              ? `${data.today_sales} sale${data.today_sales === 1 ? "" : "s"}`
              : "—"
          }
          icon="💰"
          iconClass="bg-emerald-100 text-emerald-600"
        />
        <StatCard
          label="Revenue · 7 days"
          value={formatMoney(data?.week_revenue ?? 0)}
          sub={data ? `${data.week_sales} sales this week` : "—"}
          icon="📈"
          iconClass="bg-teal-100 text-teal-600"
        />
        <StatCard
          label="Low stock"
          value={String(data?.low_stock_count ?? 0)}
          sub="items need restocking"
          icon="⚠️"
          iconClass="bg-amber-100 text-amber-600"
        />
        <StatCard
          label="Out of stock"
          value={String(data?.out_of_stock_count ?? 0)}
          sub="sold-out products"
          icon="🚫"
          iconClass="bg-red-100 text-red-600"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className={`group flex items-center gap-4 card !p-4 transition hover:-translate-y-0.5 hover:shadow-md ${a.tint}`}
          >
            <span
              className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl text-2xl text-white shadow-md transition group-hover:scale-105 ${a.iconTint}`}
            >
              {a.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-slate-900">
                {a.label}
              </span>
              <span className="block text-xs text-slate-500">{a.desc}</span>
            </span>
            <span className="ml-auto text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-emerald-500">
              →
            </span>
          </Link>
        ))}
      </div>

      {data && data.recent_sales.length > 0 && (
        <section className="card overflow-hidden !p-0">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="card-title">Recent sales</h2>
            <Link
              href="/dashboard"
              className="text-xs font-semibold text-emerald-600 hover:text-emerald-700"
            >
              View dashboard →
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {data.recent_sales.slice(0, 4).map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    #{s.id}{" "}
                    <span className="font-normal text-slate-400">
                      {s.items
                        .slice(0, 2)
                        .map((i) => `${i.product_name}×${i.qty}`)
                        .join(", ")}
                    </span>
                  </p>
                </div>
                <span className="text-sm font-bold text-emerald-600">
                  {formatMoney(s.total)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
