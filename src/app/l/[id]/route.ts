import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// pokedd.com/l/<id> → 302 to the team builder with the decoded ?share= payload.
// Lives outside [locale] (and is excluded from the i18n proxy matcher) so the
// short path stays clean. Unknown ids fall back to an empty team builder.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const base = "/pokemon-champions/team-builder";

  const link = await prisma.shortLink.findUnique({ where: { id } });
  if (!link) {
    return NextResponse.redirect(new URL(base, _req.url));
  }

  // Fire-and-forget hit counter — never block the redirect on it.
  prisma.shortLink
    .update({ where: { id }, data: { hits: { increment: 1 } } })
    .catch(() => {});

  const target = new URL(base, _req.url);
  target.searchParams.set("share", link.payload);
  return NextResponse.redirect(target);
}
