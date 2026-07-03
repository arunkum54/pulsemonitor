const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* response had no JSON body */
    }
    throw new Error(message);
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  listUrls: () => request('/api/urls'),
  addUrl: (url) => request('/api/urls', { method: 'POST', body: JSON.stringify({ url }) }),
  removeUrl: (id) => request(`/api/urls/${id}`, { method: 'DELETE' }),
};
