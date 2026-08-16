interface EmptyStateProps {
  icon?: string;
  title: string;
  hint?: string;
}

export default function EmptyState({ icon = "🛍️", title, hint }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-50 text-3xl">
        {icon}
      </span>
      <p className="mt-4 text-sm font-semibold text-slate-600">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
