// Thin API client. All calls hit /api/* (same origin via Caddy / Vite proxy),
// sending the session cookie. Throws { error } on non-2xx.
const BASE = '/api';

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw Object.assign(new Error('api_error'), { status: res.status, data });
  return data;
}

export const api = {
  get: (p) => req('GET', p),
  post: (p, b) => req('POST', p, b),
  put: (p, b) => req('PUT', p, b),
};

// Upload a payload directly to object storage via a pre-signed PUT, then return
// the storage key to attach to a catalog submission. Bytes never go through the API.
export async function uploadPayload(kind, file) {
  const contentType = file.type || 'application/octet-stream';
  const { key, url } = await api.post('/uploads/presign', { kind, filename: file.name, contentType, size: file.size });
  const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
  if (!put.ok) throw Object.assign(new Error('upload_failed'), { status: put.status });
  return key;
}
