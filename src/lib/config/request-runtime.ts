/**
 * Request-scoped runtime configuration.
 *
 * Replaces unsafe process.env mutation (RULE-8).
 * Only regenerate is product-relevant today; extras catch unknown debug headers.
 */

export interface RequestRuntimeConfig {
  /** Explicit regenerate request — must never be honored by GET projection. */
  regenerate?: boolean;
  /** Opaque key/value pairs from unrecognized debug headers/query. */
  extras: Record<string, string>;
}

/**
 * Parse debug/runtime options from a Request (headers + query).
 * Pure — does not touch process.env.
 */
export function parseRequestRuntimeConfig(request: {
  url: string;
  headers: { get(name: string): string | null };
}): RequestRuntimeConfig {
  const url = new URL(request.url);
  const config: RequestRuntimeConfig = { extras: {} };

  const regenHeader = request.headers.get('x-regenerate');
  const regenQuery = url.searchParams.get('regenerate');
  if (regenHeader === 'true' || regenQuery === 'true') {
    config.regenerate = true;
  }

  // Collect leftover x-* / query debug keys without acting on them.
  for (const [key, value] of url.searchParams.entries()) {
    if (key === 'regenerate' || key === 'demo') continue;
    if (value !== '') config.extras[key] = value;
  }

  return config;
}

/**
 * Empty default for call sites that do not have an HTTP request.
 */
export function defaultRequestRuntimeConfig(): RequestRuntimeConfig {
  return { extras: {} };
}
