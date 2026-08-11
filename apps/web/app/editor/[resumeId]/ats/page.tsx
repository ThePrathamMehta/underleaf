import { redirect } from "next/navigation";

/**
 * `/editor/:id/ats` is an address, not a screen.
 *
 * The panel has to sit beside the canvas — every issue it raises is a button
 * that scrolls the document to the section at fault, which a standalone page
 * couldn't do. So the route exists to be linkable and immediately hands off to
 * the editor with the dock already open.
 */
export default async function AtsRoute({ params }: { params: Promise<{ resumeId: string }> }) {
  const { resumeId } = await params;
  redirect(`/editor/${resumeId}?panel=ats`);
}
