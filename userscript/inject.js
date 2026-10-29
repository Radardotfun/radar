// Injected by the build: every `fetch` in the bundle goes through the script manager instead of the
// page, so x.com's page security doesn't block it. The page's own fetch is left untouched.
export { gmFetch as fetch } from './gm-fetch.js';
