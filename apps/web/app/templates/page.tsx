"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import type { ProfessionDto, TemplateDto } from "@repo/types";
import { ProfessionIcon } from "@repo/ui/profession-icon";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { Button } from "../../components/button";
import { SiteHeader } from "../../components/site-header";
import { ResumeThumbnail } from "../../components/resume-thumbnail";

/**
 * `useSearchParams` opts the tree into client-side rendering, so the boundary
 * keeps that scoped to the gallery instead of the whole route. The profession
 * arrives as `?profession=` from the picker step, which is what lets that step
 * hand off a pre-filtered gallery.
 */
export default function TemplatesPage() {
  return (
    <Suspense
      fallback={
        <>
          <SiteHeader />
          <main className="mx-auto max-w-6xl px-6 py-14 lg:py-16">
            <SkeletonGrid />
          </main>
        </>
      }
    >
      <TemplatesGallery />
    </Suspense>
  );
}

function TemplatesGallery() {
  const router = useRouter();
  const { user } = useAuth();
  const searchParams = useSearchParams();

  const [templates, setTemplates] = useState<TemplateDto[] | null>(null);
  const [professions, setProfessions] = useState<ProfessionDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [profession, setProfession] = useState<string | null>(
    () => searchParams.get("profession"),
  );
  const [category, setCategory] = useState<string | null>(null);
  const [creatingSlug, setCreatingSlug] = useState<string | null>(null);
  const [preview, setPreview] = useState<TemplateDto | null>(null);

  // The profession row is an enhancement, not a dependency — if this fails the
  // gallery still works exactly as it did before professions existed.
  useEffect(() => {
    api
      .professions()
      .then(({ professions: list }) => setProfessions(list))
      .catch(() => setProfessions([]));
  }, []);

  /**
   * Refetched per profession rather than filtered on the client, because the
   * curated `rank` only exists server-side — filtering a cached list here would
   * silently fall back to alphabetical and lose the ordering the whole feature
   * is for.
   */
  useEffect(() => {
    let cancelled = false;
    setTemplates(null);
    setError(null);

    api
      .templates({ profession: profession ?? undefined })
      .then(({ templates: list }) => {
        if (!cancelled) setTemplates(list);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.message : "Could not load templates.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [profession]);

  // Only the categories actually present in the current profession's picks, so
  // the two rows can't combine into an empty grid.
  const categories = useMemo(() => {
    if (!templates) return [];
    return [...new Set(templates.map((t) => t.category))].sort();
  }, [templates]);

  // Category narrows within the profession's list — the AND half of the filter.
  // Kept client-side so it stays instant, and because filtering a ranked list
  // preserves that rank for free.
  const visible = useMemo(() => {
    if (!templates) return [];
    return category ? templates.filter((t) => t.category === category) : templates;
  }, [templates, category]);

  // A category that the newly-chosen profession has none of would read as "no
  // results" with no obvious cause; drop it instead.
  useEffect(() => {
    if (category && categories.length > 0 && !categories.includes(category)) setCategory(null);
  }, [categories, category]);

  function chooseProfession(slug: string | null) {
    setProfession(slug);
    // Keeps the filter in the URL so it survives a refresh and can be shared.
    router.replace(slug ? `/templates?profession=${encodeURIComponent(slug)}` : "/templates", {
      scroll: false,
    });
  }

  const activeProfession = professions.find((p) => p.slug === profession) ?? null;

  // Not `useTemplate`: a use-prefixed name reads as a hook, and the rules-of-
  // hooks lint rightly objected to it being called from an onClick.
  async function createFromTemplate(template: TemplateDto) {
    // Creating a resume requires auth; send guests to signup and return them here.
    if (!user) {
      router.push(`/signup?next=${encodeURIComponent("/templates")}`);
      return;
    }

    setCreatingSlug(template.slug);
    try {
      // Pass the active profession so the resume opens on the sample the card
      // was previewing, not the template's general one.
      const { resume } = await api.createResume({
        templateId: template.id,
        ...(profession ? { profession } : {}),
      });
      router.push(`/editor/${resume.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not create the resume.");
      setCreatingSlug(null);
    }
  }

  // Start from Blank creates against the default template (Jake's) with an empty
  // scaffold rather than its sample content. Styling can be changed later via the
  // editor's template switcher without losing entered content.
  async function startBlank() {
    if (!user) {
      router.push(`/signup?next=${encodeURIComponent("/templates")}`);
      return;
    }
    const base = templates?.find((t) => t.slug === "jakes") ?? templates?.[0];
    if (!base) return;

    setCreatingSlug("__blank__");
    try {
      const { resume } = await api.createResume({ templateId: base.id, blank: true });
      router.push(`/editor/${resume.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not create the resume.");
      setCreatingSlug(null);
    }
  }

  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-6 py-14 lg:py-16">
        <header className="max-w-[52ch]">
          <p className="mb-4 font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-ink-faint">
            Templates
          </p>
          <h1 className="font-display text-[clamp(2.25rem,5vw,3.25rem)] leading-[1.05] tracking-tightest text-balance">
            Formats worth starting from.
          </h1>
          <p className="mt-5 leading-relaxed text-ink-muted text-pretty">
            Each is a rebuild of a resume layout that hiring teams already read
            comfortably. Every preview below is the live renderer — not a
            screenshot — so what you see is what exports.
          </p>
        </header>

        {/* Two filter rows, labelled, because they narrow on different axes and
            an unlabelled pair of chip rows reads as one control that wrapped. */}
        {professions.length > 0 && (
          <div className="mt-10">
            <p className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-ink-faint">
              Built for
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Chip active={profession === null} onClick={() => chooseProfession(null)}>
                All templates
              </Chip>
              {professions.map((p) => (
                <Chip
                  key={p.id}
                  active={profession === p.slug}
                  onClick={() => chooseProfession(p.slug)}
                  icon={<ProfessionIcon iconKey={p.iconKey} size={15} />}
                >
                  {p.name}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {categories.length > 0 && (
          <div className="mt-6">
            <p className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-ink-faint">
              Style
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Chip active={category === null} onClick={() => setCategory(null)}>
                Any
              </Chip>
              {categories.map((c) => (
                <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
                  {c}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {activeProfession && (
          <p className="mt-6 max-w-[52ch] text-sm leading-relaxed text-ink-muted text-pretty">
            {activeProfession.description}
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="mt-10 rounded-lg bg-danger-wash px-4 py-3 text-sm text-danger ring-1 ring-inset ring-danger/15"
          >
            {error}
          </p>
        )}

        {templates === null && !error && <SkeletonGrid />}

        <motion.div layout className="mt-10 grid gap-x-7 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {/* Pinned first: a blank start. Only when unfiltered — under a
              profession the grid is a ranked list, and a pinned card would push
              the strongest recommendation out of first place. */}
          {templates !== null && category === null && profession === null && (
            <motion.article
              layout
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -4 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="group"
            >
              <button
                type="button"
                onClick={() => void startBlank()}
                disabled={creatingSlug !== null}
                className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-rule-strong bg-paper-raised text-center transition-all duration-300 hover:border-accent hover:shadow-lift disabled:opacity-60"
                style={{ aspectRatio: "215.9 / 279.4" }}
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-wash text-accent transition-transform duration-300 group-hover:scale-110">
                  <PlusIcon />
                </span>
                <span className="mt-4 font-display text-xl tracking-tight text-ink">
                  {creatingSlug === "__blank__" ? "Creating…" : "Start from blank"}
                </span>
                <span className="mt-1.5 max-w-[24ch] text-sm text-ink-muted text-pretty">
                  An empty document with just the structure. Style it any way later.
                </span>
              </button>
            </motion.article>
          )}

          <AnimatePresence mode="popLayout">
            {visible.map((template, index) => (
              <motion.article
                key={template.id}
                layout
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                whileHover={{ y: -4 }}
                transition={{
                  duration: 0.45,
                  // Stagger only on first paint; filtering should feel immediate.
                  delay: Math.min(index * 0.06, 0.3),
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="group"
              >
                <div className="relative overflow-hidden rounded-lg ring-1 ring-rule transition-all duration-300 group-hover:shadow-lift group-hover:ring-rule-strong">
                  <ResumeThumbnail
                    templateSlug={template.slug}
                    content={template.sampleContent}
                    theme={template.defaultTheme}
                    className="transition-transform duration-500 ease-out group-hover:scale-[1.015]"
                  />

                  {/* Action layer, revealed on hover and always available on touch. */}
                  <div className="absolute inset-x-0 bottom-0 flex justify-center gap-2 bg-gradient-to-t from-ink/70 via-ink/25 to-transparent p-4 pt-12 opacity-0 transition-opacity duration-300 group-hover:opacity-100 focus-within:opacity-100">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setPreview(template)}
                    >
                      Preview
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void createFromTemplate(template)}
                      disabled={creatingSlug !== null}
                    >
                      {creatingSlug === template.slug ? "Creating…" : "Use this template"}
                    </Button>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="font-display text-xl tracking-tight">{template.name}</h2>
                    <span className="shrink-0 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-ink-faint">
                      {template.category}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-muted text-pretty">
                    {template.description}
                  </p>
                </div>
              </motion.article>
            ))}
          </AnimatePresence>
        </motion.div>

        {templates !== null && visible.length === 0 && (
          <div className="mt-16 text-center">
            <p className="text-ink-muted">
              {profession && category
                ? `No ${category.toLowerCase()} templates for ${activeProfession?.name ?? "that profession"} yet.`
                : "No templates match that filter yet."}
            </p>
            <button
              onClick={() => {
                setCategory(null);
                chooseProfession(null);
              }}
              className="mt-3 text-sm text-accent underline underline-offset-4 hover:text-accent-hover"
            >
              Browse all templates
            </button>
          </div>
        )}
      </main>

      <TemplatePreview
        template={preview}
        creating={preview !== null && creatingSlug === preview.slug}
        disabled={creatingSlug !== null}
        onUse={() => preview && void createFromTemplate(preview)}
        onClose={() => setPreview(null)}
      />
    </>
  );
}

/**
 * Full-size live preview of a template before committing. Renders the real
 * renderer (not a screenshot) at readable scale, with the same "Use" action as
 * the card. Closes on backdrop click or Escape.
 */
function TemplatePreview({
  template,
  creating,
  disabled,
  onUse,
  onClose,
}: {
  template: TemplateDto | null;
  creating: boolean;
  disabled: boolean;
  onUse: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!template) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    // Lock scroll behind the modal.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [template, onClose]);

  return (
    <AnimatePresence>
      {template && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={`Preview of ${template.name}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm sm:p-8"
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-paper-raised shadow-lift ring-1 ring-rule md:flex-row"
          >
            {/* The document, scrollable if it overflows the viewport height. */}
            <div className="scrollbar-on-dark min-h-0 flex-1 overflow-auto bg-canvas p-4 sm:p-8">
              <div className="mx-auto w-full max-w-[26rem] overflow-hidden rounded-sm shadow-page ring-1 ring-black/5">
                <ResumeThumbnail
                  templateSlug={template.slug}
                  content={template.sampleContent}
                  theme={template.defaultTheme}
                />
              </div>
            </div>

            {/* Meta + commit. */}
            <div className="flex shrink-0 flex-col gap-4 border-t border-rule p-6 md:w-72 md:border-l md:border-t-0">
              <div>
                <span className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-ink-faint">
                  {template.category}
                </span>
                <h2 className="mt-1.5 font-display text-2xl tracking-tight">{template.name}</h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted text-pretty">
                  {template.description}
                </p>
              </div>

              <div className="mt-auto flex flex-col gap-2">
                <Button size="md" onClick={onUse} disabled={disabled} className="w-full">
                  {creating ? "Creating…" : "Use this template"}
                </Button>
                <Button size="md" variant="ghost" onClick={onClose} className="w-full">
                  Close
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Chip({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm transition-all duration-200 ${
        active
          ? "bg-ink text-paper"
          : "bg-paper-raised text-ink-muted ring-1 ring-inset ring-rule hover:text-ink hover:ring-rule-strong"
      }`}
    >
      {icon && <span className={active ? "text-paper/70" : "text-ink-faint"}>{icon}</span>}
      {children}
    </button>
  );
}

function SkeletonGrid() {
  return (
    <div className="mt-10 grid gap-x-7 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="rounded-lg bg-paper-sunken ring-1 ring-rule" style={{ aspectRatio: "215.9 / 279.4" }} />
          <div className="mt-4 h-5 w-1/2 rounded bg-paper-sunken" />
          <div className="mt-2 h-4 w-full rounded bg-paper-sunken" />
        </div>
      ))}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
