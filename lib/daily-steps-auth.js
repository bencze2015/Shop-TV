import { tokenMatchesHash } from './workout-admin-auth.js';

const PROFILE_TOKEN_HASHES = {
  jordan: 'de26fa6154c41658b3184fa4db0ebeae1bb05676a7a6dbcbb316a5372a160d08',
  kelsey: '10213ee3571f9db1121bc74c81a6e9605020992f7a61a8a0fe970390688fcd0b',
};

export function stepSyncTokenFromRequest(req) {
  const authorization = String(req.headers?.authorization || '');
  if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, '');
  return String(req.headers?.['x-step-sync-token'] || '');
}

export function stepSyncProfile(req, profileTokenHashes = PROFILE_TOKEN_HASHES) {
  const token = stepSyncTokenFromRequest(req);
  for (const [profile, expectedHash] of Object.entries(profileTokenHashes)) {
    if (tokenMatchesHash(token, expectedHash)) return profile;
  }
  return null;
}
