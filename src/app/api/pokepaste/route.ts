/**
 * Server-side proxy for fetching a PokePaste's raw text.
 *
 * Browsers can't reliably fetch `pokepast.es/<id>/raw` directly (CORS is
 * unverified on the public host), so the Import modal posts the user-supplied
 * URL here and we round-trip it server-side. Only `pokepast.es` hostnames are
 * permitted to avoid making this an open redirect / SSRF.
 */

import { NextResponse } from "next/server";
import { extractPokePasteId } from "@/lib/showdown-import";
import { cachedQuery, CACHE_TTL_SECONDS } from "@/lib/cache";

export const dynamic = "force-dynamic";

class PokePasteResponseError extends Error {
  constructor(readonly status: number) {
    super(`PokePaste returned ${status}.`);
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = url.searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "Missing ?url=" }, { status: 400 });
  }

  const id = extractPokePasteId(target);
  if (!id) {
    return NextResponse.json(
      { error: "URL must be a pokepast.es paste link." },
      { status: 400 },
    );
  }

  try {
    const text = await cachedQuery("pokepaste:raw", { id }, async () => {
      const upstream = await fetch(`https://pokepast.es/${id}/raw`, {
        headers: { "User-Agent": "pokedd.com/import" },
        cache: "no-store",
        // PokePaste serves text/plain; no body limit needed for typical pastes.
      });
      if (!upstream.ok) throw new PokePasteResponseError(upstream.status);
      return upstream.text();
    });
    return new NextResponse(text, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Network error." },
      { status: 502 },
    );
  }
}
