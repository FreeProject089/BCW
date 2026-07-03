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
  patch: (p, b) => req('PATCH', p, b),
  del: (p) => req('DELETE', p),
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

// PUT bytes to a pre-signed URL via XHR so the upload can report byte progress and
// be cancelled (fetch() can't do granular upload progress and only aborts awkwardly).
// opts: { signal, onProgress(loaded,total) }. Rejects with { aborted:true } on cancel.
function putWithProgress(url, file, contentType, { signal, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('aborted'), { aborted: true }));
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded, e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300)
      ? resolve()
      : reject(Object.assign(new Error('upload_failed'), { status: xhr.status }));
    xhr.onerror = () => reject(Object.assign(new Error('network_error'), { status: 0 }));
    xhr.onabort = () => reject(Object.assign(new Error('aborted'), { aborted: true }));
    if (signal) signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

// Upload a file into a hosted Server-Repo (quota-checked server-side). `relPath`
// overrides the logical path (used for folder uploads to keep sub-directories).
// opts: { signal, onProgress(loaded,total), dashboard } — cancel + live progress;
// `dashboard:true` routes through the dedicated-dashboard endpoints so authorized
// collaborators / password holders (not just the owner) can upload.
// SHA-256 of a file for the content checksum shown in the manager. Skipped for very
// large files (the digest needs the whole file in memory) or without SubtleCrypto.
async function fileSha256(file) {
  if (!file || file.size > 256 * 1024 * 1024 || !globalThis.crypto?.subtle) return undefined;
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
  } catch { return undefined; }
}

// POST that rides out a rate-limit (429): a big folder upload can momentarily exceed
// the bucket, so back off and retry instead of failing the file outright.
async function postRetry(path, body, tries = 5) {
  for (let i = 0; ; i++) {
    try { return await api.post(path, body); }
    catch (e) {
      if (e?.status === 429 && i < tries) { await new Promise((r) => setTimeout(r, 400 * (i + 1) + Math.random() * 300)); continue; }
      throw e;
    }
  }
}

export async function uploadRepoFile(repoId, file, relPath, opts = {}) {
  const contentType = file.type || 'application/octet-stream';
  const wantPath = relPath || file.webkitRelativePath || file.name;
  const b = opts.dashboard ? `/repos/${repoId}/dashboard/files` : `/repos/${repoId}/files`;
  const { key, url, path } = await postRetry(`${b}/presign`, { path: wantPath, size: file.size, contentType });
  await putWithProgress(url, file, contentType, opts);
  const sha256 = await fileSha256(file);
  await postRetry(b, { path, key, size: file.size, contentType, ...(sha256 ? { sha256 } : {}) });
}

// Upload an image (blog cover / avatar photo); returns a stable public media URL.
export async function uploadImage(file) {
  const contentType = file.type || 'image/png';
  const { url, mediaUrl } = await api.post('/uploads/presign', { kind: 'BLOG', filename: file.name, contentType, size: file.size });
  const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
  if (!put.ok) throw Object.assign(new Error('upload_failed'), { status: put.status });
  return mediaUrl;
}
export const uploadBlogImage = uploadImage; // back-compat alias
