"use client";

import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";

type Sort = "name" | "type" | "category" | "power" | "accuracy" | "pp" | "priority" | "usage";
const NUMERIC: Sort[] = ["power", "accuracy", "pp", "priority", "usage"];

export function MovesSortHeader({
  sort,
  dir,
  field,
  label,
  align = "right",
}: {
  sort: Sort;
  dir: "asc" | "desc";
  field: Sort;
  label: string;
  align?: "left" | "right";
}) {
  const sp = useSearchParams();
  const isActive = sort === field;
  const defaultDir = NUMERIC.includes(field) ? "desc" : "asc";
  const nextDir = isActive ? (dir === "asc" ? "desc" : "asc") : defaultDir;

  const next = new URLSearchParams(sp.toString());
  next.set("sort", field);
  if (nextDir !== "desc") next.set("dir", nextDir);
  else next.delete("dir");

  return (
    <th className={cn("px-3 py-2", align === "left" ? "text-left" : "text-right")}>
      <Link
        scroll={false}
        href={`/pokemon-champions/moves?${next.toString()}`}
        className={cn(
          "inline-flex items-center gap-1 font-semibold transition-colors",
          isActive
            ? "text-zinc-950 dark:text-zinc-50"
            : "hover:text-zinc-900 dark:hover:text-zinc-200",
        )}
      >
        <span>{label}</span>
        <span aria-hidden className="text-[10px]">
          {isActive ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </Link>
    </th>
  );
}
