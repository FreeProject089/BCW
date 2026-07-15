// Append a resize width to a /media image URL so list cards fetch a downscaled webp
// thumbnail instead of the full-size original — the API's /media proxy resizes on demand
// (`?w=`) and caches the result immutably. External URLs (http…) and data: URIs are left
// untouched. `w` must be one of the server's allowed widths (64/128/256/384/512/768),
// otherwise the proxy just serves the original.
export const thumb = (url, w) =>
  (typeof url === 'string' && /^\/(api\/)?media\//.test(url))
    ? `${url}${url.includes('?') ? '&' : '?'}w=${w}`
    : url;
