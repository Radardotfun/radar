// OAuth 1.0a request signing for the X API (HMAC-SHA1, Web Crypto), so the bot can read its mentions and post
// replies as its own account. Works in Workers and Node. https://docs.x.com/resources/fundamentals/authentication

// RFC 3986 percent-encoding, as OAuth requires (encodeURIComponent leaves !'()* alone).
const pct = (s) => encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

// The Authorization header for one request. `extra` holds form-body parameters (signed too); a JSON body is not.
// `fixed` pins the nonce and timestamp, for the signing test only.
export async function oauthHeader(method, url, keys, { extra = {}, fixed = {} } = {}) {
  const oauth = {
    oauth_consumer_key: keys.apiKey,
    oauth_nonce: fixed.nonce || crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: fixed.timestamp || String(Math.floor(Date.now() / 1000)),
    oauth_token: keys.accessToken,
    oauth_version: '1.0',
  };
  const u = new URL(url);
  const params = [...Object.entries(oauth), ...u.searchParams.entries(), ...Object.entries(extra)]
    .map(([k, v]) => [pct(k), pct(v)])
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0));
  const base = [method.toUpperCase(), pct(`${u.origin}${u.pathname}`), pct(params.map(([k, v]) => `${k}=${v}`).join('&'))].join('&');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${pct(keys.apiSecret)}&${pct(keys.accessSecret)}`), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = b64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(base)));
  return `OAuth ${Object.entries({ ...oauth, oauth_signature: signature }).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(', ')}`;
}
