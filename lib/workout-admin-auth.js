import { createHash, timingSafeEqual } from 'node:crypto';

// The secret itself is never committed. The phone manager receives it once in
// the URL fragment, which browsers do not send to the server or access logs.
const ADMIN_TOKEN_SHA256 = 'e0f4662b2d2b654ee13785579952ccf9b60f66e509ab05ecccf602bd45d5b023';

export function adminTokenFromRequest(req) {
  const authorization = String(req.headers?.authorization || '');
  if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, '');
  return String(req.headers?.['x-workout-admin-token'] || '');
}

export function tokenMatchesHash(token, expectedHash) {
  if (!token || !expectedHash) return false;
  const actual = Buffer.from(createHash('sha256').update(token).digest('hex'));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function workoutAdminAuthorized(req) {
  return tokenMatchesHash(adminTokenFromRequest(req), ADMIN_TOKEN_SHA256);
}
