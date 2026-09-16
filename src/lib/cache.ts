import "server-only";

import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";

/** All application data caches expire after one day. */
export const CACHE_TTL_SECONDS = 86_400;

const CACHE_PREFIX = "pokedd:cache:v1";

type CacheEnvelope<T> = {
  value: T;
};

let client: Redis | null | undefined;
let didWarnAboutConfig = false;

function getRedis(): Redis | null {
  if (client !== undefined) return client;

  // UPSTASH_* is the current Upstash/Vercel integration convention. The
  // KV_REST_* fallback keeps projects created through the older Vercel KV
  // integration working too.
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    client = null;
    if (process.env.NODE_ENV === "production" && !didWarnAboutConfig) {
      didWarnAboutConfig = true;
      console.warn(
        "[cache] Upstash credentials are missing; falling back to the source database.",
      );
    }
    return client;
  }

  client = new Redis({ url, token });
  return client;
}

function cacheKey(namespace: string, parameters: unknown): string {
  const serialized = JSON.stringify(parameters ?? null);
  const digest = createHash("sha256")
    .update(serialized)
    .digest("base64url");
  return `${CACHE_PREFIX}:${namespace}:${digest}`;
}

function reportCacheError(operation: "read" | "write", error: unknown) {
  // Cache failures must never take the public site down. Avoid logging the
  // request URL or client object because both contain Redis credentials.
  console.error(
    `[cache] Upstash ${operation} failed; using the source instead.`,
    error instanceof Error ? error.message : "Unknown error",
  );
}

/**
 * Read through Upstash and cache successful loader results for one day.
 *
 * The envelope lets us cache `null` (for not-found lookups) without confusing
 * it with Redis' own missing-key response.
 */
export async function cachedQuery<T>(
  namespace: string,
  parameters: unknown,
  loader: () => Promise<T>,
): Promise<T> {
  const redis = getRedis();
  if (!redis) return loader();

  const key = cacheKey(namespace, parameters);
  try {
    const hit = await redis.get<CacheEnvelope<T>>(key);
    if (hit !== null && Object.hasOwn(hit, "value")) return hit.value;
  } catch (error) {
    reportCacheError("read", error);
    return loader();
  }

  const value = await loader();
  try {
    await redis.set(key, { value } satisfies CacheEnvelope<T>, {
      ex: CACHE_TTL_SECONDS,
    });
  } catch (error) {
    reportCacheError("write", error);
  }
  return value;
}

/** Prime immutable records immediately after they are created. */
export async function putCachedValue<T>(
  namespace: string,
  parameters: unknown,
  value: T,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.set(
      cacheKey(namespace, parameters),
      { value } satisfies CacheEnvelope<T>,
      { ex: CACHE_TTL_SECONDS },
    );
  } catch (error) {
    reportCacheError("write", error);
  }
}
