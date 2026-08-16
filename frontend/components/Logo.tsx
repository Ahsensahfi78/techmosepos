interface LogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
}

export default function Logo({
  size = 36,
  showText = true,
  className = "",
}: LogoProps) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <span
        className="grid shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-blue-700 shadow-md shadow-indigo-200"
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="0 0 24 24"
          width={size * 0.62}
          height={size * 0.62}
          fill="none"
          stroke="white"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="5" y="3" width="14" height="18" rx="2.5" />
          <path d="M9 7h6" />
          <path d="M12 10v7" />
          <path d="M9.5 13.5h5" />
        </svg>
      </span>
      {showText && (
        <span className="text-lg font-bold tracking-tight text-slate-900">
          Tech
          <span className="text-indigo-600">MOS</span>
        </span>
      )}
    </span>
  );
}
