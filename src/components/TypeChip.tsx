import { useTranslations } from "next-intl";
import { TYPE_COLORS, type PokemonType } from "@/lib/types";
import { cn } from "@/lib/cn";

export function TypeChip({
  type,
  size = "md",
  className,
}: {
  type: PokemonType;
  size?: "sm" | "md";
  /** Extra classes — e.g. a fixed width to align chips into a column. */
  className?: string;
}) {
  const t = useTranslations("Types");
  const c = TYPE_COLORS[type];
  const label = t(type);
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-semibold uppercase tracking-wider border",
        c.bg,
        c.text,
        c.border,
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
        className,
      )}
      aria-label={`Type: ${label}`}
    >
      {label}
    </span>
  );
}
