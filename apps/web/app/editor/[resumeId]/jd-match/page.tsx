import { redirect } from "next/navigation";

/**
 * `/editor/:id/jd-match` — an address for the job-match panel.
 *
 * The panel itself has to live beside the canvas: every suggestion can scroll
 * the document to the section it would change, and "Apply with AI" edits that
 * document live. So the route exists to be linkable and immediately hands off
 * to the editor with the panel open.
 */
export default async function JdMatchRoute({
  params,
}: {
  params: Promise<{ resumeId: string }>;
}) {
  const { resumeId } = await params;
  redirect(`/editor/${resumeId}?panel=jd`);
}
