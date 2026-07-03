import Sparkline from './Sparkline.jsx';

function timeAgo(iso) {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  const secs = Math.max(0, Math.round(diffMs / 1000));
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

function formatDuration(seconds) {
  if (seconds == null) return null;
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

function sslTone(daysRemaining) {
  if (daysRemaining == null) return 'dim';
  if (daysRemaining <= 7) return 'red';
  if (daysRemaining <= 21) return 'amber';
  return 'green';
}

const STATE_LABEL = { up: 'up', down: 'down', pending: 'confirming' };

export default function MonitorCard({ monitor, onRemove, readOnly }) {
  const { url, latest, history, state, uptime24h, openIncident, recentIncidents, regions, ssl } = monitor;
  const label = latest ? STATE_LABEL[state] : 'checking';

  let host = url;
  try { host = new URL(url).host; } catch { /* keep raw url */ }

  const lastResolvedIncident = recentIncidents?.[0];
  const isHttps = url.startsWith('https://');

  return (
    <div className="monitor-card" data-state={state}>
      <div className="card-top">
        <div className="card-url" title={url}>{host}</div>
        {!readOnly && (
          <button
            className="card-remove"
            onClick={() => onRemove(monitor.id)}
            aria-label={`Stop monitoring ${host}`}
            title="Stop monitoring"
          >
            ✕
          </button>
        )}
      </div>

      <div className="status-row">
        <span className="status-dot" data-state={state} data-pulse={state !== 'down'} />
        <span className="status-label" data-state={state}>{label}</span>
        {latest?.statusCode && <span className="status-code">HTTP {latest.statusCode}</span>}
      </div>

      <div className="card-metrics">
        <div>
          <span className="metric-value" data-state={state}>
            {latest?.responseTimeMs != null ? latest.responseTimeMs : '—'}
          </span>
          {latest?.responseTimeMs != null && <span className="metric-unit">ms</span>}
        </div>
        <div className="card-meta">
          {uptime24h != null && <div>{uptime24h}% up · 24h</div>}
          <div>checked {timeAgo(latest?.checkedAt)}</div>
        </div>
      </div>

      <Sparkline history={history} />

      {latest?.error && <div className="card-error">{latest.error}</div>}

      {regions && regions.length > 0 && (
        <div className="card-regions">
          {regions.map((r) => (
            <span key={r.region} className="region-chip" data-down={r.confirmedDown}>
              {r.region}
            </span>
          ))}
        </div>
      )}

      {isHttps && (
        <div className="card-ssl" data-tone={sslTone(ssl?.daysRemaining)}>
          {ssl?.error && 'SSL: unable to verify'}
          {!ssl?.error && ssl?.daysRemaining != null && `SSL expires in ${ssl.daysRemaining}d`}
          {!ssl && 'SSL: checking…'}
        </div>
      )}

      {openIncident && (
        <div className="card-incident" data-ongoing="true">
          Ongoing incident · started {timeAgo(openIncident.startedAt)}
        </div>
      )}
      {!openIncident && lastResolvedIncident && (
        <div className="card-incident">
          Last incident: {timeAgo(lastResolvedIncident.resolvedAt)}, lasted{' '}
          {formatDuration(lastResolvedIncident.durationSeconds)}
        </div>
      )}
    </div>
  );
}
