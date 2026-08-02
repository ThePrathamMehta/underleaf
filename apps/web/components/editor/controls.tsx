"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

/** Small square icon button used throughout the editor chrome. */
export function IconButton({
  label,
  active = false,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors duration-150 disabled:pointer-events-none disabled:opacity-35 ${
        active ? "bg-ink text-paper" : "text-ink-muted hover:bg-paper-sunken hover:text-ink"
      } ${className}`}
      {...props}
    />
  );
}

export function ToolbarDivider() {
  return <div className="mx-1 h-5 w-px shrink-0 bg-rule" aria-hidden />;
}

/**
 * A popover anchored to its trigger. Closes on outside click and Escape;
 * without both, a stray click leaves panels stacked over the canvas.
 */
export function Popover({
  trigger,
  children,
  align = "left",
  width = 260,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            style={{ width }}
            className={`absolute top-[calc(100%+8px)] z-50 origin-top rounded-xl bg-paper-raised p-3 shadow-lift ring-1 ring-rule ${
              align === "right" ? "right-0" : "left-0"
            }`}
          >
            {children(() => setOpen(false))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-ink-faint">
      {children}
    </span>
  );
}

/** Labelled range input with a live numeric readout. */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between">
        <FieldLabel>{label}</FieldLabel>
        <span className="font-mono text-[0.6875rem] tabular-nums text-ink-muted">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-paper-sunken accent-accent"
      />
    </label>
  );
}

/** A row of swatches; the active one gets a ring rather than a checkmark. */
export function SwatchRow({
  label,
  colors,
  value,
  onChange,
}: {
  label: string;
  colors: readonly string[];
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            title={color}
            aria-label={`${label}: ${color}`}
            aria-pressed={value.toLowerCase() === color.toLowerCase()}
            onClick={() => onChange(color)}
            style={{ background: color }}
            className={`h-6 w-6 rounded-full ring-1 ring-inset ring-black/10 transition-transform duration-150 hover:scale-110 ${
              value.toLowerCase() === color.toLowerCase()
                ? "outline outline-2 outline-offset-2 outline-ink"
                : ""
            }`}
          />
        ))}

        <label
          className="relative inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full ring-1 ring-inset ring-rule-strong transition-transform duration-150 hover:scale-110"
          title="Custom color"
          style={{
            background:
              "conic-gradient(from 180deg, #dc2626, #ea580c, #ca8a04, #16a34a, #0891b2, #4f46e5, #dc2626)",
          }}
        >
          <input
            type="color"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      </div>
    </div>
  );
}

/** Segmented control for small closed sets (page size, layout). */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      {label && <FieldLabel>{label}</FieldLabel>}
      <div className={`inline-flex rounded-lg bg-paper-sunken p-0.5 ${label ? "mt-2" : ""}`}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`h-7 rounded-[0.375rem] px-2.5 text-[0.75rem] transition-colors duration-150 ${
              value === option.value
                ? "bg-paper-raised text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06)]"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
