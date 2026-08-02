"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import type { TemplateDto } from "@repo/types";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { Button } from "../../components/button";
import { SiteHeader } from "../../components/site-header";
import { ResumeThumbnail } from "../../components/resume-thumbnail";

export default function TemplatesPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [templates, setTemplates] = useState<TemplateDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [creatingSlug, setCreatingSlug] = useState<string | null>(null);

  useEffect(() => {
    api
      .templates()
      .then(({ templates: list }) => setTemplates(list))
      .catch((caught) =>
        setError(caught instanceof ApiError ? caught.message : "Could not load templates."),
      );
  }, []);

  const categories = useMemo(() => {
    if (!templates) return [];
    return [...new Set(templates.map((t) => t.category))].sort();
  }, [templates]);

  const visible = useMemo(() => {
    if (!templates) return [];
    return category ? templates.filter((t) => t.category === category) : templates;
  }, [templates, category]);

  async function useTemplate(template: TemplateDto) {
    // Creating a resume requires auth; send guests to signup and return them here.
    if (!user) {
      router.push(`/signup?next=${encodeURIComponent("/templates")}`);
      return;
    }

    setCreatingSlug(template.slug);
    try {
      const { resume } = await api.createResume({ templateId: template.id });
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
            Five formats worth starting from.
          </h1>
          <p className="mt-5 leading-relaxed text-ink-muted text-pretty">
            Each is a rebuild of a resume layout that hiring teams already read
            comfortably. Every preview below is the live renderer — not a
            screenshot — so what you see is what exports.
          </p>
        </header>

        {categories.length > 0 && (
          <div className="mt-10 flex flex-wrap gap-2">
            <Chip active={category === null} onClick={() => setCategory(null)}>
              All
            </Chip>
            {categories.map((c) => (
              <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
                {c}
              </Chip>
            ))}
          </div>
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
          <AnimatePresence mode="popLayout">
            {visible.map((template, index) => (
              <motion.article
                key={template.id}
                layout
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
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
                  <div className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-ink/70 via-ink/25 to-transparent p-4 pt-12 opacity-0 transition-opacity duration-300 group-hover:opacity-100 focus-within:opacity-100">
                    <Button
                      size="sm"
                      onClick={() => void useTemplate(template)}
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
          <p className="mt-16 text-center text-ink-muted">No templates in that category yet.</p>
        )}
      </main>
    </>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`h-9 rounded-full px-4 text-sm transition-all duration-200 ${
        active
          ? "bg-ink text-paper"
          : "bg-paper-raised text-ink-muted ring-1 ring-inset ring-rule hover:text-ink hover:ring-rule-strong"
      }`}
    >
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
