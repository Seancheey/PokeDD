import { cn } from "@/lib/cn";
import { TYPE_COLORS, type PokemonType } from "@/lib/types";
import { TYPE_ICON_INNER } from "./type-icons";

/**
 * A type as a colored rounded-square badge with the white type symbol — the
 * VGC team-sheet style. Uniform size regardless of locale (no text), so chips
 * align into a clean column. The glyph is inlined SVG so PNG export (via
 * html-to-image) needs no per-icon network fetch.
 */
export function TypeIcon({
  type,
  size = 22,
  className,
}: {
  type: PokemonType;
  size?: number;
  className?: string;
}) {
  const c = TYPE_COLORS[type];
  const inset = Math.round(size * 0.18);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md",
        c.bg,
        className,
      )}
      style={{ width: size, height: size }}
      aria-label={`Type: ${type}`}
    >
      <svg
        viewBox="0 0 512 512"
        width={size - inset * 2}
        height={size - inset * 2}
        aria-hidden
        dangerouslySetInnerHTML={{ __html: TYPE_ICON_INNER[type] }}
      />
    </span>
  );
}
