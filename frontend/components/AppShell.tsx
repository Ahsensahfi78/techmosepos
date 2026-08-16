"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import LiveHeader from "./LiveHeader";
import { useAuth } from "@/lib/auth-context";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, checking } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isLoginPage = pathname === "/login";

  useEffect(() => {
    if (checking) return;
    if (isLoginPage) {
      if (user) router.replace("/");
      return;
    }
    if (!user) router.replace("/login");
  }, [checking, user, isLoginPage, router]);

  if (isLoginPage) return <>{children}</>;

  if (checking || !user) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex flex-col items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-700 text-white shadow-lg shadow-indigo-200">
            <svg
              viewBox="0 0 24 24"
              width={22}
              height={22}
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="5" y="3" width="14" height="18" rx="2.5" />
              <path d="M9 7h6" />
            </svg>
          </span>
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-500" />
        </div>
      </div>
    );
  }

  return (
    <>
      <LiveHeader />
      <main className="page-container">{children}</main>
    </>
  );
}
