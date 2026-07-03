/**
 * Validates and normalizes a user-submitted URL. Returns the normalized
 * URL string, or null if it isn't a usable http(s) URL.
 */
export function normalizeUrl(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
