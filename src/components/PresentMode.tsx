"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import qrcode from "qrcode-generator";
import { toPng } from "html-to-image";
import { BarChart3, Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { TypeIcon } from "@/components/TypeIcon";
import { cn } from "@/lib/cn";
import type { PokemonType } from "@/lib/types";
import { encodeTeam, type ShareSlot, type TeamShare } from "@/lib/team-share";
import type {
  RefAbility,
  RefItem,
  RefMove,
  RefPokemon,
} from "@/app/[locale]/pokemon-champions/team-builder/TeamBuilderClient";

// ─── Background presets ──────────────────────────────────────────────────────
// Pure-CSS gradients only (no external image fetch) so the PNG export is always
// CORS-clean. Each preset themes the sheet background + the per-card header bar.
type BgPreset = {
  id: string;
  sheet: string; // layered CSS background for the whole sheet
  header: string; // CSS background for a card's name bar
  swatch: string; // small gradient shown on the picker button
};

// Layered diagonal stripes for a woven-fabric texture. Two passes: a soft wide
// band + a fine pinstripe, so the sheet reads as textured rather than flat.
const TEXTURE =
  "repeating-linear-gradient(135deg, rgba(255,255,255,0.07) 0 16px, rgba(0,0,0,0.06) 16px 32px)," +
  "repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 7px)";

// Soft highlight that gives the textured sheet a bit of depth.
const SHEEN = "radial-gradient(circle at 18% 10%, rgba(255,255,255,0.16), transparent 48%)";

// Sheet gradients run light → deep on a 135° diagonal but stop well short of
// near-black, so the bottom-right corner keeps the preset's hue instead of
// fading to mud. Mid stop sits at 60% to keep the transition long and gradual.
const BG_PRESETS: BgPreset[] = [
  {
    id: "crimson",
    sheet: `${TEXTURE}, ${SHEEN}, linear-gradient(135deg, #ef4444 0%, #b91c1c 60%, #7f1d1d 100%)`,
    header: "linear-gradient(90deg, #dc2626, #991b1b)",
    swatch: "linear-gradient(135deg, #ef4444, #7f1d1d)",
  },
  {
    id: "azure",
    sheet: `${TEXTURE}, ${SHEEN}, linear-gradient(135deg, #3b82f6 0%, #1d4ed8 60%, #1e3a8a 100%)`,
    header: "linear-gradient(90deg, #3b82f6, #1e40af)",
    swatch: "linear-gradient(135deg, #60a5fa, #1e3a8a)",
  },
  {
    id: "verdant",
    sheet: `${TEXTURE}, ${SHEEN}, linear-gradient(135deg, #22c55e 0%, #15803d 60%, #14532d 100%)`,
    header: "linear-gradient(90deg, #22c55e, #15803d)",
    swatch: "linear-gradient(135deg, #4ade80, #14532d)",
  },
  {
    id: "royal",
    sheet: `${TEXTURE}, ${SHEEN}, linear-gradient(135deg, #8b5cf6 0%, #6d28d9 60%, #4c1d95 100%)`,
    header: "linear-gradient(90deg, #8b5cf6, #5b21b6)",
    swatch: "linear-gradient(135deg, #a78bfa, #4c1d95)",
  },
  {
    id: "slate",
    sheet: `${TEXTURE}, ${SHEEN}, linear-gradient(135deg, #64748b 0%, #334155 60%, #1e293b 100%)`,
    header: "linear-gradient(90deg, #475569, #1e293b)",
    swatch: "linear-gradient(135deg, #64748b, #1e293b)",
  },
];

// PokeAPI item sprites live here; not every slug exists (newer / Champions-only
// stones 404), so <ItemSprite> hides itself on error.
const ITEM_SPRITE_BASE =
  "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/";

// Natural pixel width of the sheet. The view is scaled to fit the viewport, but
// the exported PNG is always rendered at this width × pixelRatio for consistency.
const SHEET_WIDTH = 1180;

// Shown faintly in the QR slot before the real short link resolves, so the slot
// always occupies its full size and the sheet layout doesn't reflow.
const QR_PLACEHOLDER = "https://www.pokedd.com";

export function PresentMode({
  team,
  pokemonBySlug,
  moveBySlug,
  abilityBySlug,
  itemBySlug,
  onClose,
}: {
  team: TeamShare;
  pokemonBySlug: Map<string, RefPokemon>;
  moveBySlug: Map<string, RefMove>;
  abilityBySlug: Map<string, RefAbility>;
  itemBySlug: Map<string, RefItem>;
  onClose: () => void;
}) {
  const t = useTranslations("TeamBuilder");

  const [title, setTitle] = useState(t("presentDefaultTitle"));
  const [bgIndex, setBgIndex] = useState(0);
  const [shareUrl, setShareUrl] = useState("");
  const [exporting, setExporting] = useState(false);
  // false = toolbar pinned (default); true = hover-to-show (toggled via the eye).
  const [autoHide, setAutoHide] = useState(false);
  // When on, each card gets a nature + EV-spread column on the right.
  const [showStats, setShowStats] = useState(false);
  // Wider sheet when the stats column is visible so the 3-up grid stays roomy.
  const sheetWidth = showStats ? 1440 : SHEET_WIDTH;
  const bg = BG_PRESETS[bgIndex];

  const stageRef = useRef<HTMLDivElement>(null);
  // Rendered into the contentEditable title ONCE. Never fed back from state, so
  // React won't rewrite the text node mid-edit (which would jump the caret).
  const initialTitle = useRef(t("presentDefaultTitle")).current;
  const initialByline = useRef(t("presentDefaultByline")).current;

  // Encode the current team, mint a short link, and point the QR at it.
  // Recomputed when the team changes. Falls back to the full ?share= URL if the
  // shortener is unreachable, so the QR always resolves to a working team.
  useEffect(() => {
    let alive = true;
    (async () => {
      const payload = await encodeTeam(team);
      const { origin, pathname } = window.location;
      const longUrl = `${origin}${pathname}?share=${payload}`;
      try {
        const res = await fetch("/api/shorten", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload }),
        });
        if (res.ok) {
          const { id } = (await res.json()) as { id?: string };
          if (alive && id) {
            setShareUrl(`${origin}/l/${id}`);
            return;
          }
        }
      } catch {
        /* network/DB error — fall through to the long URL */
      }
      if (alive) setShareUrl(longUrl);
    })();
    return () => {
      alive = false;
    };
  }, [team]);

  // Lock the page body's scroll while the overlay is open, so the page's
  // scrollbar doesn't show through behind the (already viewport-fitted) sheet.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Esc closes the overlay.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Scale the (fixed-width) sheet down to fit the viewport. offsetWidth/Height
  // are pre-transform, so we can measure the natural size and reserve the
  // scaled box for it without a layout flash.
  const [layout, setLayout] = useState({ scale: 1, w: SHEET_WIDTH, h: 0 });
  useLayoutEffect(() => {
    function fit() {
      const el = stageRef.current;
      if (!el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const scale = Math.min(
        1,
        (window.innerWidth - 48) / w,
        (window.innerHeight - 48) / h,
      );
      setLayout({ scale, w, h });
    }
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [team, title, bgIndex, shareUrl, showStats]);

  async function exportPng() {
    const node = stageRef.current;
    if (!node || exporting) return;
    setExporting(true);
    try {
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        cacheBust: true,
        // Capture at natural (unscaled) size regardless of the on-screen fit.
        width: node.offsetWidth,
        height: node.offsetHeight,
        style: { transform: "none" },
      });
      const a = document.createElement("a");
      const safe = (title || "team").replace(/[^\w.-]+/g, "_").slice(0, 60);
      a.download = `${safe || "team"}.png`;
      a.href = dataUrl;
      a.click();
    } catch {
      /* export failed (e.g. a sprite blocked the canvas) — silently abort */
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center overflow-hidden bg-zinc-950/85 p-6 backdrop-blur-sm">
      {/* Scaled, centered sheet (the only thing captured on export). */}
      <div style={{ width: layout.w * layout.scale, height: layout.h * layout.scale }}>
        <div style={{ transform: `scale(${layout.scale})`, transformOrigin: "top left" }}>
          <div
            ref={stageRef}
            style={{ width: sheetWidth, backgroundImage: bg.sheet }}
            className="present-stripe-anim relative overflow-hidden rounded-3xl p-6 shadow-2xl"
          >
            {/* Title banner + QR */}
            <div className="flex items-stretch gap-4">
              <div className="flex flex-1 items-center rounded-2xl bg-white/90 px-6 py-4 shadow">
                {/* Title + byline baseline-aligned to each other, the pair
                    vertically centered within the (taller) banner. */}
                <div className="flex min-w-0 flex-1 items-baseline gap-3">
                  <h2
                    contentEditable
                    suppressContentEditableWarning
                    spellCheck={false}
                    role="textbox"
                    aria-label={t("presentTitlePlaceholder")}
                    onInput={(e) => setTitle(e.currentTarget.textContent ?? "")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                    className="min-w-0 cursor-text break-words rounded-lg px-2 font-[family-name:var(--font-display)] text-[2.75rem] font-bold uppercase leading-tight tracking-tight text-zinc-900 outline-none transition-colors hover:bg-black/[0.04] focus:bg-black/[0.05]"
                  >
                    {initialTitle}
                  </h2>
                  <span
                    contentEditable
                    suppressContentEditableWarning
                    spellCheck={false}
                    role="textbox"
                    aria-label={t("presentBylinePlaceholder")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                    className="min-w-0 cursor-text whitespace-nowrap rounded-lg px-2 font-[family-name:var(--font-display)] text-xl font-medium tracking-tight text-zinc-500 outline-none transition-colors hover:bg-black/[0.04] focus:bg-black/[0.05]"
                  >
                    {initialByline}
                  </span>
                </div>
              </div>
              {/* Always rendered (even before the short link resolves) so the
                  title banner's width — and thus the whole sheet's fit/scale —
                  never shifts. Shows a faint placeholder QR until shareUrl is
                  ready, then swaps in the real one. */}
              <div className="flex flex-col items-center justify-center rounded-2xl bg-white/90 px-3 py-2 shadow">
                <div className={shareUrl ? undefined : "opacity-20"}>
                  <QrCode value={shareUrl || QR_PLACEHOLDER} size={84} />
                </div>
                <span className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  {t("presentScanHint")}
                </span>
              </div>
            </div>

            {/* 6 cards, horizontal 3-up grid */}
            <div className="mt-4 grid grid-cols-3 gap-3">
              {team.slots.map((slot, i) => (
                <PresentCard
                  key={i}
                  slot={slot}
                  header={bg.header}
                  showStats={showStats}
                  pokemonBySlug={pokemonBySlug}
                  moveBySlug={moveBySlug}
                  abilityBySlug={abilityBySlug}
                  itemBySlug={itemBySlug}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Toolbelt: backgrounds + export + close. Lives OUTSIDE the captured
           sheet and at natural size; revealed when the cursor enters the
           center-bottom zone (and stays while hovering the bar itself). ── */}
      <div className="group fixed bottom-0 left-1/2 z-[130] flex h-36 w-[760px] max-w-[94vw] -translate-x-1/2 items-end justify-center pb-6">
        <div
          className={cn(
            "flex items-center gap-2 rounded-full bg-zinc-900/90 px-3 py-2 shadow-2xl ring-1 ring-white/15 backdrop-blur transition-all duration-200",
            autoHide
              ? "translate-y-3 opacity-0 group-hover:translate-y-0 group-hover:opacity-100"
              : "translate-y-0 opacity-100",
          )}
        >
          <button
            type="button"
            onClick={() => setAutoHide((v) => !v)}
            aria-pressed={autoHide}
            title={autoHide ? t("presentToolbarPin") : t("presentToolbarHide")}
            aria-label={autoHide ? t("presentToolbarPin") : t("presentToolbarHide")}
            className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            {autoHide ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>

          <button
            type="button"
            onClick={() => setShowStats((v) => !v)}
            aria-pressed={showStats}
            title={t("presentShowStats")}
            aria-label={t("presentShowStats")}
            className={cn(
              "rounded-full p-2 transition-colors",
              showStats
                ? "bg-white/15 text-white"
                : "text-white/70 hover:bg-white/10 hover:text-white",
            )}
          >
            <BarChart3 size={16} />
          </button>

          <div className="mx-1 h-6 w-px bg-white/20" />

          <div className="flex items-center gap-1.5 px-1">
            {BG_PRESETS.map((preset, i) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setBgIndex(i)}
                aria-label={preset.id}
                aria-pressed={i === bgIndex}
                style={{ backgroundImage: preset.swatch }}
                className={cn(
                  "h-6 w-6 rounded-full ring-2 ring-offset-2 ring-offset-zinc-900 transition",
                  i === bgIndex ? "ring-white" : "ring-transparent hover:ring-white/50",
                )}
              />
            ))}
          </div>

          <div className="mx-1 h-6 w-px bg-white/20" />

          <button
            type="button"
            onClick={exportPng}
            disabled={exporting}
            className="rounded-full bg-white px-5 py-2 text-sm font-bold text-zinc-900 transition-colors hover:bg-zinc-100 disabled:opacity-60"
          >
            {exporting ? t("presentExporting") : t("presentExport")}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-sm font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            {t("presentClose")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function PresentCard({
  slot,
  header,
  showStats,
  pokemonBySlug,
  moveBySlug,
  abilityBySlug,
  itemBySlug,
}: {
  slot: ShareSlot;
  header: string;
  showStats: boolean;
  pokemonBySlug: Map<string, RefPokemon>;
  moveBySlug: Map<string, RefMove>;
  abilityBySlug: Map<string, RefAbility>;
  itemBySlug: Map<string, RefItem>;
}) {
  const t = useTranslations("TeamBuilder");
  const tNature = useTranslations("Natures");
  const tStat = useTranslations("TeamBuilder.evStat");
  const p = pokemonBySlug.get(slot.s);
  if (!p) return null;

  const abilityName = slot.a ? abilityBySlug.get(slot.a)?.name ?? slot.a : "—";
  const itemName = slot.i ? itemBySlug.get(slot.i)?.name ?? slot.i : null;
  let natureLabel = slot.n ?? "";
  if (slot.n) {
    try {
      natureLabel = tNature(slot.n as never);
    } catch {
      // unknown nature → fall back to the raw English value
    }
  }
  const moves = [0, 1, 2, 3].map((i) => {
    const slug = (slot.m ?? [])[i];
    return slug ? moveBySlug.get(slug) ?? null : null;
  });
  const ev = slot.v ?? [0, 0, 0, 0, 0, 0];
  const EV_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"] as const;
  const evRows = EV_KEYS.map((k, i) => ({ k, v: ev[i] ?? 0 })).filter((r) => r.v > 0);

  return (
    <div className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-md">
      {/* Name bar */}
      <div
        style={{ backgroundImage: header }}
        className="flex items-center justify-between gap-2 px-3 py-1.5"
      >
        <span className="truncate font-[family-name:var(--font-display)] text-lg font-bold uppercase tracking-wide text-white drop-shadow">
          {p.name}
        </span>
        <span className="flex shrink-0 gap-1">
          <TypeIcon type={p.type1 as PokemonType} size={24} />
          {p.type2 ? <TypeIcon type={p.type2 as PokemonType} size={24} /> : null}
        </span>
      </div>

      <div className="flex items-stretch gap-2.5 p-3">
        {/* LEFT: sprite (large) + ability + item. Stretches to the card height
            so the moves column can spread evenly against it — no dead space. */}
        <div className="flex w-[140px] shrink-0 flex-col gap-1.5">
          <div className="flex aspect-square w-full flex-1 items-center justify-center rounded-xl bg-black/[0.04]">
            {/* Plain <img> with crossOrigin so html-to-image can read pixels. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.spriteUrl}
              alt={p.name}
              crossOrigin="anonymous"
              width={128}
              height={128}
              className="h-[88%] w-[88%] object-contain"
            />
          </div>
          <span className="w-full rounded-md bg-zinc-100 px-2 py-1 text-center text-[12px] font-semibold leading-tight text-zinc-700">
            {abilityName}
          </span>
          {itemName ? (
            <span className="flex w-full items-center justify-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-center text-[12px] font-semibold leading-tight text-amber-800">
              {slot.i ? <ItemSprite slug={slot.i} /> : null}
              <span className="min-w-0">{itemName}</span>
            </span>
          ) : null}
        </div>

        {/* MIDDLE: moves, spread to fill the full card height. */}
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-1.5">
          {moves.map((m, i) => (
            <div
              key={i}
              className="flex flex-1 items-center gap-2 rounded-md bg-zinc-50 px-2"
            >
              {m ? (
                <>
                  <TypeIcon type={m.type as PokemonType} size={24} />
                  <span className="min-w-0 flex-1 truncate font-[family-name:var(--font-display)] text-[15px] font-medium tracking-wide text-zinc-800">
                    {m.name}
                  </span>
                </>
              ) : (
                <span className="ml-[32px] flex-1 text-[15px] text-zinc-300">—</span>
              )}
            </div>
          ))}
        </div>

        {/* RIGHT: nature + EVs (only when "show stats" is on) */}
        {showStats ? (
          <div className="w-[116px] shrink-0 space-y-1 border-l border-black/10 pl-2.5">
            {natureLabel ? (
              <div className="rounded-md bg-zinc-100 px-2 py-0.5 text-center text-[11px] font-bold uppercase tracking-wider text-zinc-700">
                {natureLabel}
              </div>
            ) : null}
            <div className="space-y-0.5">
              {evRows.length > 0 ? (
                evRows.map(({ k, v }) => (
                  <div key={k} className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold uppercase tracking-wider text-zinc-500">
                      {tStat(k)}
                    </span>
                    <span className="font-mono font-semibold tabular-nums text-zinc-800">
                      {v}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-center text-[11px] text-zinc-400">—</div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Small held-item icon next to the item pill. PokeAPI sprite URL is derived
// from the slug; if it 404s (newer / Champions-only stones), we hide it so the
// pill falls back to text-only.
function ItemSprite({ slug }: { slug: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${ITEM_SPRITE_BASE}${slug}.png`}
      alt=""
      crossOrigin="anonymous"
      width={18}
      height={18}
      className="h-[18px] w-[18px] shrink-0 object-contain"
      onError={() => setFailed(true)}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// QR code rendered as a crisp SVG (one <path> of all dark modules). Error
// correction "L" keeps long share URLs at a lower, more scannable density.

function QrCode({ value, size }: { value: string; size: number }) {
  const { count, d } = useMemo(() => {
    const qr = qrcode(0, "L");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let path = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
      }
    }
    return { count: n, d: path };
  }, [value]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${count} ${count}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code"
    >
      <rect width={count} height={count} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  );
}
