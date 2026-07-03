export default function Sparkline({ history }) {
  const points = history.filter((h) => h.responseTimeMs != null);

  if (points.length < 2) {
    return <svg className="sparkline" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true" />;
  }

  const max = Math.max(...points.map((p) => p.responseTimeMs), 1);
  const min = Math.min(...points.map((p) => p.responseTimeMs), 0);
  const range = Math.max(max - min, 1);
  const stepX = 100 / (points.length - 1);

  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = 28 - ((p.responseTimeMs - min) / range) * 24;
    return [x, y, p.isUp];
  });

  const linePath = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const lastUp = coords[coords.length - 1][2];

  return (
    <svg className="sparkline" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <path
        d={linePath}
        fill="none"
        stroke={lastUp ? 'var(--signal-up)' : 'var(--signal-down)'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
      />
      {coords.map(([x, y, isUp], i) =>
        !isUp ? <circle key={i} cx={x} cy={y} r="1.6" fill="var(--signal-down)" /> : null
      )}
    </svg>
  );
}
