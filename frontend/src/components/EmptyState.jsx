export default function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-state-title">No signals yet</div>
      <div className="empty-state-body">
        Add a URL above to start watching it. Checks run every 60 seconds and history
        appears here as soon as the first ping lands.
      </div>
    </div>
  );
}
