// Shared access-token cache to avoid hitting Zoho's OAuth rate limit.
// Zoho access tokens are valid for 1 hour — we cache ours for 55 minutes
// so repeated API calls (dashboard loads, debug requests, etc.) during
// the same server session reuse one token instead of requesting a new
// one every time, which is what was tripping "too many requests".

let cachedToken = null;
let cachedAt = 0;
const TTL_MS = 55 * 60 * 1000; // 55 minutes

export async function getAccessToken(env) {
  const now = Date.now();
  if (cachedToken && (now - cachedAt) < TTL_MS) {
    return { access_token: cachedToken, cached: true };
  }

  const tokenRes = await fetch('https://accounts.zoho.in/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: env.VITE_ZB_REFRESH_TOKEN,
      client_id:     env.VITE_ZB_CLIENT_ID,
      client_secret: env.VITE_ZB_CLIENT_SECRET,
      grant_type:    'refresh_token',
    }),
  });
  const tokenData = await tokenRes.json();

  if (!tokenData.access_token) {
    return { access_token: null, error: tokenData };
  }

  cachedToken = tokenData.access_token;
  cachedAt = now;
  return { access_token: cachedToken, cached: false };
}
