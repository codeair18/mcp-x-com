const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const X_HOSTS = new Set([
  'x.com',
  'www.x.com',
  'mobile.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
]);

export interface StatusRef {
  statusId: string;
  handle?: string;
}

/**
 * Accepts a full status URL (x.com or twitter.com) or a bare numeric ID
 * and returns the normalized reference, or null when unrecognizable.
 */
export function extractStatusRef(input: string): StatusRef | null {
  const trimmed = input.trim();
  if (/^\d{5,25}$/.test(trimmed)) {
    return { statusId: trimmed };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!X_HOSTS.has(url.hostname)) {
    return null;
  }
  const match = url.pathname.match(/^\/([A-Za-z0-9_]+)(?:\/web)?\/status(?:es)?\/(\d+)/);
  if (!match) {
    return null;
  }
  const segment = match[1];
  const statusId = match[2];
  if (statusId === undefined || segment === undefined) {
    return null;
  }
  if (segment === 'i' || !HANDLE_RE.test(segment)) {
    return { statusId };
  }
  return { statusId, handle: segment };
}

export function canonicalStatusUrl(statusId: string, handle?: string): string {
  return handle
    ? `https://x.com/${handle}/status/${statusId}`
    : `https://x.com/i/web/status/${statusId}`;
}

/**
 * Accepts "@handle", "handle" or a profile URL and returns the bare handle,
 * or null when the input is not a valid profile reference.
 */
export function normalizeHandle(input: string): string | null {
  const trimmed = input.trim();
  const bare = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  if (HANDLE_RE.test(bare)) {
    return bare;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!X_HOSTS.has(url.hostname)) {
    return null;
  }
  const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
  return match?.[1] ?? null;
}

export function profileUrl(handle: string): string {
  return `https://x.com/${handle}`;
}

export function searchUrl(query: string, sort: 'latest' | 'top'): string {
  const params = new URLSearchParams({ q: query, src: 'typed_query' });
  if (sort === 'latest') {
    params.set('f', 'live');
  }
  // URLSearchParams encodes spaces as '+'; X accepts both, but %20 is safer
  // to assert against and unambiguous in logs.
  return `https://x.com/search?${params.toString().replaceAll('+', '%20')}`;
}
