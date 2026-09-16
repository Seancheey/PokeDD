import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { cachedQuery, putCachedValue } from "@/lib/cache";

async function primeShortLinkCache(link: {
  id: string;
  hash: string;
  payload: string;
}) {
  await Promise.all([
    putCachedValue("short-link:by-hash", { hash: link.hash }, { id: link.id }),
    putCachedValue(
      "short-link:by-id",
      { id: link.id },
      { payload: link.payload },
    ),
  ]);
}

// POST { payload } → { id }. Stores the gzip+base64url team-share string and
// returns a short id used for pokedd.com/l/<id>. Idempotent: the same payload
// (matched by sha256) always returns the same id, so QR generation on every
// Present-mode open doesn't create duplicate rows.
export async function POST(req: Request) {
  let payload: unknown;
  try {
    ({ payload } = await req.json());
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (typeof payload !== "string" || payload.length === 0 || payload.length > 8000) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const hash = crypto.createHash("sha256").update(payload).digest("hex");

  const existing = await cachedQuery("short-link:by-hash", { hash }, () =>
    prisma.shortLink.findUnique({
      where: { hash },
      select: { id: true },
    }),
  );
  if (existing) return NextResponse.json({ id: existing.id });

  // Generate a URL-safe id; retry on the (astronomically unlikely) id collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = crypto.randomBytes(12).toString("base64url");
    try {
      const created = await prisma.shortLink.create({ data: { id, hash, payload } });
      await primeShortLinkCache(created);
      return NextResponse.json({ id: created.id });
    } catch (e: unknown) {
      // P2002 = unique constraint. If the hash raced in from a concurrent
      // request, return the now-existing row; otherwise retry with a new id.
      const code = (e as { code?: string })?.code;
      if (code === "P2002") {
        const row = await prisma.shortLink.findUnique({ where: { hash } });
        if (row) {
          await primeShortLinkCache(row);
          return NextResponse.json({ id: row.id });
        }
        // else it was an id collision — loop and try a fresh id
      } else {
        throw e;
      }
    }
  }
  return NextResponse.json({ error: "could not allocate id" }, { status: 500 });
}
