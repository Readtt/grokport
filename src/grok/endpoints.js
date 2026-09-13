// Grok Bot runs on Cursor's backend, and this is the one place that knows its address.
const DEFAULT_API_URL = 'https://api2.cursor.sh';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * GROKPORT_API_URL can point grokport at a local test server (the tests use one). Any other host is
 * ignored, so a stray environment variable can never send your sign-in token somewhere else.
 */
export function resolveApiUrl(value) {
  if (!value) return DEFAULT_API_URL;
  try {
    const url = new URL(value);
    return LOCAL_HOSTS.has(url.hostname) ? url.origin : DEFAULT_API_URL;
  } catch {
    return DEFAULT_API_URL;
  }
}

export const API_URL = resolveApiUrl(process.env.GROKPORT_API_URL);
