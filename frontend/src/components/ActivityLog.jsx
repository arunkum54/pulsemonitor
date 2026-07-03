import { useEffect, useRef, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const MAX_LINES = 60;

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour12: false });
  } catch {
    return '--:--:--';
  }
}

function describeEvent(evt) {
  let host = evt.url;
  try { host = new URL(evt.url).host; } catch { /* keep raw */ }

  switch (evt.type) {
    case 'url_added':
      return { text: `+ now watching ${host}`, tone: 'cyan' };
    case 'check':
      return {
        text: `${evt.region ? `[${evt.region}] ` : ''}${host} → ${evt.isUp ? 'ok' : 'failed'}`,
        tone: evt.isUp ? 'dim' : 'amber',
      };
    case 'incident_open':
      return { text: `⚠ outage confirmed: ${host}`, tone: 'red' };
    case 'incident_resolve':
      return { text: `✓ recovered: ${host} (down ${evt.durationSeconds ?? '?'}s)`, tone: 'green' };
    default:
      return null;
  }
}

export default function ActivityLog() {
  const [lines, setLines] = useState([]);
  const [connected, setConnected] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    const source = new EventSource(`${API_BASE}/api/events`);

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    source.onmessage = (msg) => {
      try {
        const evt = JSON.parse(msg.data);
        if (evt.type === 'connected') return;
        const described = describeEvent(evt);
        if (!described) return;

        setLines((prev) => {
          const next = [...prev, { id: `${Date.now()}-${Math.random()}`, time: formatTime(evt.checkedAt || evt.startedAt || evt.resolvedAt || new Date().toISOString()), ...described }];
          return next.slice(-MAX_LINES);
        });
      } catch {
        /* ignore malformed event */
      }
    };

    return () => source.close();
  }, []);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div className="activity-log">
      <div className="activity-log-header">
        <span>Live activity</span>
        <span className={`activity-log-status ${connected ? 'is-connected' : ''}`}>
          {connected ? 'streaming' : 'connecting…'}
        </span>
      </div>
      <div className="activity-log-body" ref={listRef}>
        {lines.length === 0 && <div className="activity-log-empty">Waiting for events…</div>}
        {lines.map((line) => (
          <div key={line.id} className="activity-log-line" data-tone={line.tone}>
            <span className="activity-log-time">{line.time}</span>
            <span>{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
