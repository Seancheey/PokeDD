import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Next.js 16 renamed the file convention from `middleware` to `proxy`.
// next-intl still exports `createMiddleware` (same function, new file name).
export const proxy = createMiddleware(routing);
export default proxy;

export const config = {
  // Match all routes except API, the /l/ short-link redirector, _next, _vercel
  // internals, and static files.
  matcher: ["/((?!api|l/|_next|_vercel|.*\\..*).*)"],
};
