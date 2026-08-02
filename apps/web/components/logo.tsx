import Link from "next/link";

/**
 * The wordmark. A leaf-under-line mark rather than a generic icon, drawn inline
 * so it inherits currentColor and needs no asset.
 */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`group inline-flex items-baseline gap-2 ${className}`}>
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        aria-hidden="true"
        className="translate-y-[2px] text-accent"
      >
        <path
          d="M9 15.5C9 10 12 6.5 16 5.5c0 5.5-3 9-7 10Z"
          fill="currentColor"
          className="transition-transform duration-300 ease-out group-hover:-translate-y-[1px]"
        />
        <path d="M2 16.5C4.5 12 6.5 9.5 9 15.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <span className="font-display text-[1.35rem] leading-none tracking-tight">Underleaf</span>
    </Link>
  );
}
