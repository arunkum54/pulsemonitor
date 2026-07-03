import { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';
import AddUrlForm from './components/AddUrlForm.jsx';
import MonitorCard from './components/MonitorCard.jsx';
import EmptyState from './components/EmptyState.jsx';
import ActivityLog from './components/ActivityLog.jsx';
import StatusPage from './components/StatusPage.jsx';

const POLL_INTERVAL_MS = 5000;

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <circle cx="13" cy="13" r="12" stroke="var(--line-500)" strokeWidth="1.5" />
      <path
        d="M4 14h4l2-6 3 11 3-8 2 3h4"
        stroke="var(--signal-up)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export default function App() {
  const [monitors, setMonitors] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const isPublicStatusView = window.location.pathname.replace(/\/+$/, '') === '/status';

  const refresh = useCallback(async () => {
    try {
      const data = await api.listUrls();
      setMonitors(data);
    } catch (err) {
      console.error('Failed to refresh monitors', err);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  if (isPublicStatusView) {
    return <StatusPage monitors={monitors} />;
  }

  async function handleAdd(url) {
    await api.addUrl(url);
    await refresh();
  }

  async function handleRemove(id) {
    setMonitors((prev) => prev.filter((m) => m.id !== id));
    try {
      await api.removeUrl(id);
    } catch (err) {
      console.error('Failed to remove monitor', err);
      refresh();
    }
  }

  const upCount = monitors.filter((m) => m.state === 'up').length;
  const downCount = monitors.filter((m) => m.state === 'down').length;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <span className="brand-name">Pulse</span>
          <span className="brand-tagline">uptime monitor</span>
        </div>
        {monitors.length > 0 && (
          <div className="fleet-summary">
            <span className="summary-up"><strong>{upCount}</strong> up</span>
            <span className="summary-down"><strong>{downCount}</strong> down</span>
            <span><strong>{monitors.length}</strong> watched</span>
          </div>
        )}
      </header>

      <AddUrlForm onAdd={handleAdd} />

      {loaded && monitors.length === 0 && <EmptyState />}

      {monitors.length > 0 && (
        <>
          <div className="monitor-grid">
            {monitors.map((m) => (
              <MonitorCard key={m.id} monitor={m} onRemove={handleRemove} />
            ))}
          </div>
          <ActivityLog />
        </>
      )}

      <div className="footnote">
        <span className="live-dot" />
        checking every 60s · refreshing view every 5s ·{' '}
        <a className="status-page-link" href="/status">view public status page</a>
      </div>
    </div>
  );
}
