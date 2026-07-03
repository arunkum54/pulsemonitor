import { useState } from 'react';

export default function AddUrlForm({ onAdd }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!value.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await onAdd(value.trim());
      setValue('');
    } catch (err) {
      setError(err.message || 'Could not add that URL');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <form className="add-form" onSubmit={handleSubmit}>
        <input
          type="text"
          inputMode="url"
          placeholder="https://your-service.com/health"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="URL to monitor"
        />
        <button type="submit" disabled={submitting || !value.trim()}>
          {submitting ? 'Adding…' : 'Add signal'}
        </button>
      </form>
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}
