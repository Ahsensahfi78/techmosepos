import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  icon?: string;
  iconClass?: string;
  accent?: string;
  children?: ReactNode;
}

export default function StatCard({
  label,
  value,
  sub,
  icon,
  iconClass = "bg-emerald-100 text-emerald-600",
  accent,
  children,
}: StatCardProps) {
  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-2xl bg-white p-5 shadow-soft ring-1 ring-slate-100 ${
        accent ?? ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-slate-500">{label}</p>
          <p className="mt-1 truncate text-2xl font-bold text-slate-900">
            {value}
          </p>
          {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
        </div>
        {icon && (
          <span
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-lg ${iconClass}`}
          >
            {icon}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
