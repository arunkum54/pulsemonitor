import tls from 'node:tls';
import { db } from './db.js';

const TIMEOUT_MS = 6000;

const upsertSslInfo = db.prepare(`
  INSERT INTO ssl_info (url_id, valid_to, days_remaining, checked_at, error)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(url_id) DO UPDATE SET
    valid_to = excluded.valid_to,
    days_remaining = excluded.days_remaining,
    checked_at = excluded.checked_at,
    error = excluded.error
`);

/**
 * Opens a raw TLS connection to a host and reads the peer certificate's
 * expiry date — no HTTP request needed, just the handshake. Resolves with
 * { validTo, daysRemaining } or rejects with an Error on failure/timeout.
 */
function fetchCertExpiry(hostname) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host: hostname, port: 443, servername: hostname, timeout: TIMEOUT_MS },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.valid_to) {
          reject(new Error('No certificate returned'));
          return;
        }
        const validTo = new Date(cert.valid_to);
        const daysRemaining = Math.ceil((validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        resolve({ validTo: validTo.toISOString(), daysRemaining });
      }
    );

    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('TIMEOUT'));
    });

    socket.on('error', (err) => reject(err));
  });
}

/**
 * Checks and stores SSL expiry for one URL row, if it's an https:// origin.
 * Silently no-ops for http:// URLs — there's no cert to check.
 */
export async function checkSslExpiry(urlRow) {
  let hostname;
  try {
    const parsed = new URL(urlRow.url);
    if (parsed.protocol !== 'https:') return;
    hostname = parsed.hostname;
  } catch {
    return;
  }

  const checkedAtIso = new Date().toISOString();

  try {
    const { validTo, daysRemaining } = await fetchCertExpiry(hostname);
    upsertSslInfo.run(urlRow.id, validTo, daysRemaining, checkedAtIso, null);
  } catch (err) {
    const reason = err.message === 'TIMEOUT' ? 'TIMEOUT' : (err.code || err.message || 'UNKNOWN_ERROR');
    upsertSslInfo.run(urlRow.id, null, null, checkedAtIso, reason);
  }
}

/**
 * Runs SSL expiry checks across every https:// URL. Certs don't change
 * minute to minute, so this runs on its own slower cadence (see index.js)
 * rather than piggybacking on every health check.
 */
export async function runSslCheckPass() {
  const urls = db.prepare('SELECT id, url FROM urls').all();
  const httpsUrls = urls.filter((u) => u.url.startsWith('https://'));
  if (httpsUrls.length === 0) return;

  const results = await Promise.allSettled(httpsUrls.map(checkSslExpiry));
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) {
    console.error(`[ssl] ${failed.length} check(s) threw unexpectedly`);
  }
}
