import MonitorCard from './MonitorCard.jsx';

function overallState(monitors) {
  if (monitors.length === 0) return { label: 'No monitors configured', tone: 'dim' };
  const downCount = monitors.filter((m) => m.state === 'down').length;
  if (downCount === 0) return { label: 'All systems operational', tone: 'up' };
  if (downCount < monitors.length) return { label: 'Partial system outage', tone: 'pending' };
  return { label: 'Major outage', tone: 'down' };
}

export default function StatusPage({ monitors }) {
  const overall = overallState(monitors);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">Pulse</span>
          <span className="brand-tagline">public status</span>
        </div>
        <a href="/" className="status-back-link">Manage monitors →</a>
      </header>

      <div className={`status-banner status-banner-${overall.tone}`}>
        <span className="status-banner-dot" />
        {overall.label}
      </div>

      {monitors.length > 0 && (
        <div className="monitor-grid">
          {monitors.map((m) => (
            <MonitorCard key={m.id} monitor={m} readOnly />
          ))}
        </div>
      )}

      <div className="footnote">
        <span className="live-dot" />
        updated automatically every few seconds
      </div>
    </div>
  );
}
