const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_API_URL = 'https://api.prod.whoop.com/developer';

function credentials(env = process.env) {
  const clientId = env.WHOOP_CLIENT_ID;
  const clientSecret = env.WHOOP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('WHOOP credentials are not configured on the server.');
  }
  return { clientId, clientSecret };
}

async function jsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function whoopError(message, response, data) {
  return Object.assign(
    new Error(data?.error_description || data?.message || message),
    { status: response.status, data },
  );
}

async function tokenRequest(params, env = process.env, fetchImpl = fetch) {
  const { clientId, clientSecret } = credentials(env);
  const body = new URLSearchParams({
    ...params,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const response = await fetchImpl(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await jsonResponse(response);
  if (!response.ok) {
    throw whoopError(`WHOOP token request failed (${response.status})`, response, data);
  }
  return data;
}

export function exchangeAuthorizationCode(code, redirectUri, env, fetchImpl) {
  return tokenRequest(
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    },
    env,
    fetchImpl,
  );
}

export function refreshWhoopTokens(refreshToken, env, fetchImpl) {
  return tokenRequest(
    { grant_type: 'refresh_token', refresh_token: refreshToken },
    env,
    fetchImpl,
  );
}

async function whoopGet(path, accessToken, fetchImpl = fetch) {
  const response = await fetchImpl(`${WHOOP_API_URL}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await jsonResponse(response);
  if (!response.ok) {
    throw whoopError(`WHOOP request failed (${response.status})`, response, data);
  }
  return data;
}

function average(values) {
  const finiteValues = values.filter(Number.isFinite);
  return finiteValues.length
    ? finiteValues.reduce((total, value) => total + value, 0) / finiteValues.length
    : null;
}

export async function loadWhoopData(accessToken, fetchImpl = fetch) {
  const [recovery, cycle, sleep] = await Promise.all([
    whoopGet('/v2/recovery?limit=7', accessToken, fetchImpl),
    whoopGet('/v2/cycle?limit=7', accessToken, fetchImpl),
    whoopGet('/v2/activity/sleep?limit=10', accessToken, fetchImpl),
  ]);
  let workout;
  let workoutAccess = true;
  let workoutError = null;
  try {
    workout = await whoopGet('/v2/activity/workout?limit=10', accessToken, fetchImpl);
  } catch (error) {
    workoutAccess = error.status !== 401 && error.status !== 403 ? null : false;
    workoutError = error.message;
    workout = { records: [] };
  }
  const recoveries = recovery.records || [];
  const cycles = cycle.records || [];
  const sleeps = (sleep.records || []).filter((record) => !record.nap).slice(0, 7);
  const recoveryScores = recoveries.map((record) => record?.score?.recovery_score);
  const hrv = recoveries.map((record) => record?.score?.hrv_rmssd_milli);
  const restingHeartRate = recoveries.map((record) => record?.score?.resting_heart_rate);
  const strain = cycles.map((record) => record?.score?.strain);
  const sleepPerformance = sleeps.map(
    (record) => record?.score?.sleep_performance_percentage,
  );

  return {
    recovery: recoveries[0] || null,
    cycle: cycles[0] || null,
    sleep: sleeps[0] || null,
    workouts: workout.records || [],
    workoutAccess,
    workoutError,
    trends: {
      recovery: {
        current: recoveryScores[0] ?? null,
        baseline: average(recoveryScores.slice(1)),
      },
      hrv: { current: hrv[0] ?? null, baseline: average(hrv.slice(1)) },
      restingHr: {
        current: restingHeartRate[0] ?? null,
        baseline: average(restingHeartRate.slice(1)),
      },
      strain: { current: strain[0] ?? null, baseline: average(strain.slice(1)) },
      sleep: {
        current: sleepPerformance[0] ?? null,
        baseline: average(sleepPerformance.slice(1)),
      },
    },
  };
}
