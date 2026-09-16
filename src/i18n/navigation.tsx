import { forwardRef, type ComponentProps, type ComponentRef } from "react";
import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Locale-aware drop-in replacements for next/link, useRouter, redirect, usePathname.
const {
  Link: IntlLink,
  redirect,
  usePathname,
  useRouter,
  getPathname,
} = createNavigation(routing);

export { redirect, usePathname, useRouter, getPathname };

type LinkProps = ComponentProps<typeof IntlLink>;

/**
 * App-wide Link with prefetching OFF by default.
 *
 * next/link prefetches every link that enters the viewport. Our entity pages
 * render hundreds of links (a Pokémon's ~100-move learnset, a move's list of
 * learners, ...), so the default turned a single page view into hundreds of
 * server round-trips. Every route is `force-dynamic` with no `loading.tsx`, so a prefetch only
 * returns the shared layout shell and the client discards it — pure waste.
 * Opt a link back in with `prefetch={null}` only if its route becomes static
 * or gains a loading boundary.
 */
export const Link = forwardRef<ComponentRef<typeof IntlLink>, LinkProps>(
  function Link({ prefetch = false, ...props }, ref) {
    return <IntlLink ref={ref} prefetch={prefetch} {...props} />;
  },
);
