import Link from "next/link";

/**
 * The leaf mark on its own, without the wordmark or the link wrapper.
 *
 * `bladeClassName` / `stemClassName` are how callers attach animation: the
 * header logo flutters the blade on hover, the splash unfolds it and draws the
 * stem. Both paths are exposed rather than the whole svg so those animations
 * can move the two parts independently.
 */
export function LeafMark({
  size = 18,
  className = "",
  bladeClassName = "",
  stemClassName = "",
}: {
  size?: number;
  className?: string;
  bladeClassName?: string;
  stemClassName?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path d="M9 15.5C9 10 12 6.5 16 5.5c0 5.5-3 9-7 10Z" fill="currentColor" className={bladeClassName} />
      <path
        d="M2 16.5C4.5 12 6.5 9.5 9 15.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        className={stemClassName}
      />
    </svg>
  );
}

/**
 * The wordmark. A leaf-under-line mark rather than a generic icon, drawn inline
 * so it inherits currentColor and needs no asset.
 *
 * The `logo` class is the hook the leaf-sway animation hangs off (see
 * globals.css); it's a plain CSS animation rather than Framer because this
 * renders in every header and shouldn't drag a client component along with it.
 */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`logo group inline-flex items-baseline gap-2 ${className}`}>
      <LeafMark className="translate-y-[2px] text-accent" bladeClassName="logo-leaf" />
      <span className="font-display text-[1.35rem] leading-none tracking-tight">Underleaf</span>
    </Link>
  );
}
