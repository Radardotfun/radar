// fetch() over the userscript manager's GM.xmlHttpRequest. x.com's page security blocks requests to
// DexScreener, RugCheck, Solana and our server; the manager makes them for us (see @connect).
// The build injects this as the bundle's `fetch`, so the shared code runs unchanged.
const xhr = (typeof GM !== 'undefined' && GM.xmlHttpRequest) || (typeof GM_xmlhttpRequest !== 'undefined' && GM_xmlhttpRequest);

function headerMap(raw) {
  const map = new Map();
  for (const line of String(raw || '').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) map.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
  }
  return map;
}

function toResponse(r) {
  const headers = headerMap(r.responseHeaders);
  const buf = r.response instanceof ArrayBuffer ? r.response : null;
  const text = () => Promise.resolve(buf ? new TextDecoder().decode(buf) : String(r.responseText ?? r.response ?? ''));
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    headers: { get: (name) => headers.get(String(name).toLowerCase()) ?? null },
    text,
    json: () => text().then(JSON.parse),
    arrayBuffer: () => Promise.resolve(buf || new TextEncoder().encode(String(r.responseText ?? '')).buffer),
  };
}

export function gmFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input.url;
  const abortError = () => new DOMException('The operation was aborted.', 'AbortError');
  return new Promise((resolve, reject) => {
    if (init.signal?.aborted) return reject(abortError());
    const req = xhr({
      method: init.method || 'GET',
      url,
      headers: init.headers || {},
      data: init.body,
      responseType: 'arraybuffer',
      anonymous: true,
      onload: (r) => resolve(toResponse(r)),
      onerror: () => reject(new TypeError(`Network request failed: ${url}`)),
      ontimeout: () => reject(new TypeError(`Request timed out: ${url}`)),
      onabort: () => reject(abortError()),
    });
    init.signal?.addEventListener('abort', () => {
      try { req?.abort?.(); } catch {}
      reject(abortError());
    }, { once: true });
  });
}
