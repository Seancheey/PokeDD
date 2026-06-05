/**
 * Share-codec for Team Builder.
 *
 * Encodes a team into a URL-safe string using gzip + base64url. Keys are intentionally
 * short to keep typical 6-mon teams under ~250 chars after encoding.
 *
 * Versioned (`v: 1`) so we can evolve the shape without breaking old links.
 */

export type ShareSlot = {
  /** species slug */
  s: string;
  /** ability slug */
  a?: string;
  /** item slug */
  i?: string;
  /** move slugs (up to 4) */
  m?: string[];
  /** Effort Values spread, 6 stats in HP/Atk/Def/SpA/SpD/Spe order */
  v?: [number, number, number, number, number, number];
  /** nature name (e.g. "Adamant"). Added 2026-05; absent in older links. */
  n?: string;
};

export type TeamShare = {
  v: 1;
  reg: string;
  fmt: "singles" | "doubles";
  slots: ShareSlot[];
};

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // btoa is browser-native; node has it globally on 16+.
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const blob = new Blob([new Uint8Array(bytes)]);
  const stream = blob.stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const blob = new Blob([new Uint8Array(bytes)]);
  const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeTeam(team: TeamShare): Promise<string> {
  const json = JSON.stringify(team);
  const bytes = new TextEncoder().encode(json);
  const zipped = await gzip(bytes);
  return toBase64Url(zipped);
}

export async function decodeTeam(payload: string): Promise<TeamShare | null> {
  try {
    const bytes = fromBase64Url(payload);
    const unzipped = await gunzip(bytes);
    const json = new TextDecoder().decode(unzipped);
    const parsed = JSON.parse(json) as TeamShare;
    if (parsed?.v !== 1 || !Array.isArray(parsed.slots)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const EMPTY_TEAM: TeamShare = {
  v: 1,
  reg: "M-A",
  fmt: "doubles",
  slots: [],
};
