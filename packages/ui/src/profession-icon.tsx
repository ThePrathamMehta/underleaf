/**
 * Icons for the profession selector, keyed by `Profession.iconKey` in the
 * database. Stroked to match the editor chrome — 24×24 grid, `currentColor`,
 * 1.75 stroke, round caps and joins — so they sit correctly beside the app's
 * existing icons at any size.
 *
 * Drawn rather than pulled from an icon font or emoji, per the v1 design
 * direction. A seeded `iconKey` with no drawing here falls back to the generic
 * mark instead of rendering a hole, so adding a profession never hard-fails the
 * gallery — it just looks unremarkable until someone draws for it.
 */

export type ProfessionIconProps = {
  iconKey: string;
  size?: number;
  className?: string;
};

const paths: Record<string, React.ReactNode> = {
  // Software Engineer — a prompt and caret.
  terminal: (
    <>
      <path d="M4 5.5h16v13H4z" />
      <path d="m8 10 2.5 2.5L8 15" />
      <path d="M13 15h3" />
    </>
  ),

  // CA / Accountant — a ledger column with a rule under the total.
  ledger: (
    <>
      <path d="M5 4h14v16H5z" />
      <path d="M9 8h6M9 12h6" />
      <path d="M9 16h6" strokeWidth={2.4} />
    </>
  ),

  // Lawyer — balance scales.
  scales: (
    <>
      <path d="M12 4v16M8 20h8" />
      <path d="M5 8h14" />
      <path d="M5 8 2.5 13.5h5zM19 8l-2.5 5.5h5z" />
    </>
  ),

  // Doctor / Healthcare — a trace with a beat.
  pulse: (
    <>
      <path d="M3 12h4l2.5-6 4 12 2.5-6h5" />
    </>
  ),

  // Academic / Researcher — an open book.
  book: (
    <>
      <path d="M12 7.5v11" />
      <path d="M12 7.5C10.5 6 8 5.5 4 5.5v11c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-11c-4 0-6.5.5-8 2Z" />
    </>
  ),

  // Designer / Creative — a painter's palette.
  palette: (
    <>
      <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.1-.9-1.6-.9-2.6 0-.8.7-1.4 1.6-1.4h1.4a4.6 4.6 0 0 0 4.6-4.6c0-3.7-3.8-6.7-8.5-6.7Z" />
      <path d="M8 10.5h.01M11.5 8h.01M15.5 9.5h.01" strokeWidth={2.4} />
    </>
  ),

  // Marketing / Sales — a megaphone.
  megaphone: (
    <>
      <path d="M4 10v4a1 1 0 0 0 1 1h3l8 4V5L8 9H5a1 1 0 0 0-1 1Z" />
      <path d="M19 10.5v3" />
      <path d="M8 15v3.5" />
    </>
  ),

  // Student / Entry-Level — a mortarboard.
  cap: (
    <>
      <path d="m12 5 9 4-9 4-9-4 9-4Z" />
      <path d="M7 11v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4" />
    </>
  ),

  // General / Other — a compass rose.
  compass: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m15 9-1.8 4.2L9 15l1.8-4.2L15 9Z" />
    </>
  ),
};

export function ProfessionIcon({ iconKey, size = 18, className = "" }: ProfessionIconProps) {
  const drawing = paths[iconKey] ?? paths.compass;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {drawing}
    </svg>
  );
}
