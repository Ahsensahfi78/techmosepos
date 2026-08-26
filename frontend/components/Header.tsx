"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useCallback } from "react";
import Logo from "./Logo";
import GlobalSearch from "./GlobalSearch";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";

const primaryLinks = [
  { href: "/pos", label: "POS", icon: "🛒" },
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/ezcash", label: "EZ Cash", icon: "📱" },
  { href: "/products", label: "Products", icon: "📦", adminOnly: true },
  { href: "/customers", label: "Customers", icon: "🧑‍🤝‍🧑" },
  { href: "/reports", label: "Reports", icon: "📈", adminOnly: true },
];

const secondaryLinks = [
  { href: "/sales", label: "Sales", icon: "🧾" },
  { href: "/transactions", label: "Transactions", icon: "🔄" },
  { href: "/purchases", label: "Purchases", icon: "📦", staff: true },
  { href: "/suppliers", label: "Suppliers", icon: "🚚", staff: true },
  { href: "/quotations", label: "Quotations", icon: "📄", staff: true },
  { href: "/expenses", label: "Expenses & Income", icon: "💸", staff: true },
  { href: "/cheques", label: "Cheques", icon: "💳", staff: true },
  { href: "/inventory", label: "Inventory", icon: "🧮", staff: true },
  { href: "/barcodes", label: "Print Barcode", icon: "🏷️", staff: true },
  { href: "/warranty", label: "Warranty", icon: "🛡️" },
  { href: "/repairs", label: "Repairs", icon: "🔧" },
  { href: "/ezcash/history", label: "EZ Cash History", icon: "📋", staff: true },
  { href: "/users", label: "Users", icon: "👥", adminOnly: true },
  { href: "/audit", label: "Audit", icon: "🕵️‍♀️", adminOnly: true },
  { href: "/settings", label: "Settings", icon: "⚙️", adminOnly: true },
  { href: "/backup-data", label: "Tools", icon: "🗄️", adminOnly: true },
];

const mobileBottomLinks = [
  { href: "/pos", label: "POS", icon: "🛒" },
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/sales", label: "Sales", icon: "🧾" },
  { href: "/products", label: "Products", icon: "📦" },
];

const roleLabel: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  cashier: "Cashier",
  accountant: "Accountant",
};

export default function Header({
  connected,
  lastEvent,
}: {
  connected: boolean;
  lastEvent: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const role = user?.role ?? "";
  const isAdmin = role === "super_admin" || role === "admin";
  const canSeeStaff = isAdmin || role === "manager" || role === "accountant";

  const navPrimary = primaryLinks.filter((l) =>
    l.adminOnly ? canSeeStaff : true
  );
  const visibleSecondary = secondaryLinks.filter((l) => {
    if (l.adminOnly) return isAdmin;
    if (l.staff) return canSeeStaff;
    return true;
  });

  const allLinks = [...navPrimary, ...visibleSecondary];

  useEffect(() => {
    if (!moreOpen) return;
    function onClick(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [moreOpen]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeDrawer();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen, closeDrawer]);

  useEffect(() => {
    closeDrawer();
  }, [pathname, closeDrawer]);

  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [drawerOpen]);

  async function handleLogout() {
    closeDrawer();
    await logout();
    router.replace("/login");
  }

  function handleDrawerNav() {
    closeDrawer();
  }

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-2 px-3 sm:h-[72px] sm:px-4 md:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 md:hidden"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <Link href="/" className="shrink-0">
              <Logo size={32} />
            </Link>
          </div>

          <nav className="hidden items-center gap-0.5 md:flex">
            {navPrimary.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition lg:px-4 ${
                  pathname === link.href
                    ? "bg-emerald-50 text-emerald-700"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <span className="text-base">{link.icon}</span>
                <span className="hidden lg:inline">{link.label}</span>
              </Link>
            ))}
            {visibleSecondary.length > 0 && (
              <div className="relative" ref={moreRef}>
                <button
                  onClick={() => setMoreOpen((o) => !o)}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition lg:px-4 ${
                    moreOpen
                      ? "bg-slate-100 text-slate-900"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <span className="text-base">☰</span>
                  <span className="hidden lg:inline">More</span>
                  <svg
                    className={`hidden h-3 w-3 transition lg:block ${
                      moreOpen ? "rotate-180" : ""
                    }`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {moreOpen && (
                  <div className="absolute right-0 top-full z-40 mt-2 max-h-[70vh] w-56 overflow-y-auto overscroll-contain rounded-2xl border border-slate-100 bg-white py-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
                    {visibleSecondary.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={() => setMoreOpen(false)}
                        className={`flex items-center gap-2.5 px-4 py-2.5 text-sm font-semibold transition ${
                          pathname === link.href
                            ? "bg-emerald-50 text-emerald-700"
                            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700"
                        }`}
                      >
                        <span className="text-base">{link.icon}</span>
                        {link.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <GlobalSearch />
            <button
              onClick={toggle}
              aria-label="Toggle dark mode"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              {theme === "dark" ? (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
            <span className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 sm:flex">
              <span
                className={`h-2 w-2 rounded-full ${
                  connected ? "bg-emerald-500" : "animate-pulse bg-red-400"
                }`}
              />
              {connected ? "Live" : "Offline"}
            </span>

            <span className="hidden items-center gap-1.5 rounded-full bg-slate-900 py-1.5 pl-1.5 pr-3 text-xs font-semibold text-white sm:flex">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 text-[10px] font-bold uppercase">
                {(user?.full_name ?? user?.username ?? "?")
                  .split(" ")
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <span className="max-w-28 truncate">{user?.full_name ?? user?.username ?? ""}</span>
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                {roleLabel[role] ?? role}
              </span>
            </span>

            <button
              onClick={handleLogout}
              aria-label="Sign out"
              title="Sign out"
              className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                viewBox="0 0 24 24"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
            </button>
          </div>
        </div>
        {lastEvent && (
          <div className="bg-emerald-500 px-4 py-1 text-center text-xs font-medium text-white">
            {lastEvent}
          </div>
        )}
      </header>

      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm transition-opacity md:hidden"
          onClick={closeDrawer}
          aria-hidden="true"
        />
      )}

      <div
        ref={drawerRef}
        className={`fixed inset-y-0 left-0 z-[45] flex w-72 max-w-[85vw] flex-col bg-white shadow-2xl transition-transform duration-300 ease-in-out dark:bg-slate-900 md:hidden ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-100 px-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <Logo size={28} />
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">Techmos POS</span>
          </div>
          <button
            onClick={closeDrawer}
            aria-label="Close menu"
            className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 text-sm font-bold text-white uppercase">
            {(user?.full_name ?? user?.username ?? "?")
              .split(" ")
              .map((w) => w[0])
              .slice(0, 2)
              .join("")}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
              {user?.full_name ?? user?.username ?? ""}
            </p>
            <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  connected ? "bg-emerald-500" : "animate-pulse bg-red-400"
                }`}
              />
              {roleLabel[role] ?? role} · {connected ? "Online" : "Offline"}
            </p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
          <div className="mb-1 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Main
          </div>
          {navPrimary.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={handleDrawerNav}
                className={`mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                  active
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                }`}
              >
                <span className="text-lg">{link.icon}</span>
                {link.label}
                {active && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-500" />
                )}
              </Link>
            );
          })}

          {visibleSecondary.length > 0 && (
            <>
              <div className="mb-1 mt-4 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                More
              </div>
              {visibleSecondary.map((link) => {
                const active = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={handleDrawerNav}
                    className={`mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                      active
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    }`}
                  >
                    <span className="text-lg">{link.icon}</span>
                    {link.label}
                    {active && (
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    )}
                  </Link>
                );
              })}
            </>
          )}
        </nav>

        <div className="shrink-0 border-t border-slate-100 px-3 py-3 dark:border-slate-800">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
            Sign out
          </button>
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur md:hidden">
        <div className="mx-auto grid grid-cols-5 max-w-md">
          {mobileBottomLinks.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition min-h-[48px] justify-center ${
                  active ? "text-emerald-600" : "text-slate-400"
                }`}
              >
                <span className={`text-lg transition ${active ? "scale-110" : ""}`}>
                  {link.icon}
                </span>
                {link.label}
                <span className={`h-1 w-6 rounded-full transition ${active ? "bg-emerald-500" : "bg-transparent"}`} />
              </Link>
            );
          })}
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold text-slate-400 transition min-h-[48px] justify-center"
          >
            <span className="text-lg">☰</span>
            More
            <span className="h-1 w-6 rounded-full bg-transparent" />
          </button>
        </div>
      </nav>
    </>
  );
}
