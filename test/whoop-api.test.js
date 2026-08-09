import assert from 'node:assert/strict';
import test from 'node:test';
import {
  exchangeAuthorizationCode,
  loadWhoopData,
  refreshWhoopTokens,
} from '../lib/whoop-api.js';

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const env = {
  WHOOP_CLIENT_ID: 'client-id',
  WHOOP_CLIENT_SECRET: 'client-secret',
};

test('exchanges an OAuth code with server-side credentials', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return response({
      access_token: 'access',
      refresh_token: 'refresh',
      expires_in: 3600,
    });
  };

  const result = await exchangeAuthorizationCode(
    'authorization-code',
    'https://shop-tv.example/callback.html',
    env,
    fetchImpl,
  );
  const body = new URLSearchParams(request.options.body);

  assert.equal(request.url, 'https://api.prod.whoop.com/oauth/oauth2/token');
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code'), 'authorization-code');
  assert.equal(body.get('client_id'), 'client-id');
  assert.equal(body.get('client_secret'), 'client-secret');
  assert.equal(result.refresh_token, 'refresh');
});

test('refreshes with the shared server-side refresh token', async () => {
  const fetchImpl = async (_url, options) => {
    const body = new URLSearchParams(options.body);
    assert.equal(body.get('grant_type'), 'refresh_token');
    assert.equal(body.get('refresh_token'), 'shared-refresh');
    return response({ access_token: 'new-access', refresh_token: 'new-refresh' });
  };

  const result = await refreshWhoopTokens('shared-refresh', env, fetchImpl);
  assert.equal(result.access_token, 'new-access');
});

test('loads current WHOOP values and seven-day baselines', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer shared-access');
    if (url.includes('/recovery')) {
      return response({
        records: [
          { score: { recovery_score: 80, hrv_rmssd_milli: 50, resting_heart_rate: 55 } },
          { score: { recovery_score: 60, hrv_rmssd_milli: 40, resting_heart_rate: 60 } },
          { score: { recovery_score: 70, hrv_rmssd_milli: 44, resting_heart_rate: 58 } },
        ],
      });
    }
    if (url.includes('/cycle')) {
      return response({ records: [{ score: { strain: 12 } }, { score: { strain: 10 } }] });
    }
    if (url.includes('/workout')) {
      return response({ records: [{ id: 'workout-1', sport_name: 'Weightlifting' }] });
    }
    return response({
      records: [
        { nap: true, score: { sleep_performance_percentage: 20 } },
        { nap: false, score: { sleep_performance_percentage: 90 } },
        { nap: false, score: { sleep_performance_percentage: 80 } },
      ],
    });
  };

  const data = await loadWhoopData('shared-access', fetchImpl);

  assert.equal(data.recovery.score.recovery_score, 80);
  assert.equal(data.sleep.score.sleep_performance_percentage, 90);
  assert.equal(data.trends.recovery.baseline, 65);
  assert.equal(data.trends.hrv.baseline, 42);
  assert.equal(data.trends.restingHr.baseline, 59);
  assert.equal(data.trends.strain.baseline, 10);
  assert.equal(data.trends.sleep.baseline, 80);
  assert.equal(data.workoutAccess, true);
  assert.equal(data.workouts[0].sport_name, 'Weightlifting');
});

test('keeps health metrics available when workout scope is unavailable', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/workout')) return response({ message: 'Forbidden' }, 403);
    if (url.includes('/recovery')) return response({ records: [] });
    if (url.includes('/cycle')) return response({ records: [] });
    return response({ records: [] });
  };

  const data = await loadWhoopData('shared-access', fetchImpl);

  assert.equal(data.workoutAccess, false);
  assert.deepEqual(data.workouts, []);
  assert.match(data.workoutError, /Forbidden/);
});

test('surfaces WHOOP OAuth errors with their status and details', async () => {
  const fetchImpl = async () => response(
    { error: 'invalid_grant', error_description: 'Refresh token expired' },
    400,
  );

  await assert.rejects(
    refreshWhoopTokens('expired', env, fetchImpl),
    (error) => error.status === 400
      && error.message === 'Refresh token expired'
      && error.data.error === 'invalid_grant',
  );
});
