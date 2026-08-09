export const DEFAULT_REDIRECT_URI = 'https://shop-tv-gamma.vercel.app/callback.html';

export function getWhoopRedirectUri(env = process.env) {
  return env.WHOOP_REDIRECT_URI || DEFAULT_REDIRECT_URI;
}
