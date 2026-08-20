(function () {
  var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var weekOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var TRAINING_DAY_START_HOUR = 7;
  var WHOOP_POLL_MS = 5 * 60 * 1000;
  var PLAN_POLL_MS = 30 * 1000;
  var STEPS_POLL_MS = 5 * 60 * 1000;
  var AUTOPILOT_POLL_MS = 30 * 1000;
  var AUTOPILOT_IDLE_MS = 90 * 1000;
  var WHOOP_RETRY_MS = 60 * 1000;
  var CELEBRATION_MS = 45 * 1000;
  var DRIFT_STEP_MS = 90 * 1000;
  var DRIFT_OFFSETS = [[0, 0], [2, 1], [3, -1], [1, -2], [-1, -2], [-3, -1], [-2, 1], [0, 2]];
  var requestedDay = queryValue('preview') === '1' ? queryValue('day') : null;
  var selectedDay = requestedDay;
  var data = { profiles: {} };
  var baseData = { profiles: {} };
  var livePlanRevision = -1;
  var livePlanConfig = {
    schemaVersion: 1,
    profileWeeks: {},
    dateOverrides: {},
    rescheduleEvents: []
  };
  var sharedHistoryByProfile = { jordan: [], kelsey: [] };
  var sharedStepsByProfile = { jordan: [], kelsey: [] };
  var sharedStepGoal = 12500;
  var workoutHistoryReady = false;
  var lastInteractionAt = 0;
  var driftIndex = 0;
  var profileId = readStorage('shopProfile') || 'jordan';
  var profile = { name: 'Jordan', week: {} };
  var whoopData = null;
  var whoopDataByProfile = { jordan: null, kelsey: null };
  var whoopUpdatedAtByProfile = { jordan: 0, kelsey: 0 };
  var whoopRetryTimeoutByProfile = { jordan: null, kelsey: null };
  var view = 'today';
  var selectedExercise = 0;
  var focusZone = 'ambient';
  var trackingMode = 'ambient';
  var ambientAction = 0;
  var toolbarIndex = 0;
  var restTimerEnd = 0;
  var restTimerDuration = 0;
  var restTimerExerciseId = null;
  var lastAction = null;
  var audioContext = null;
  var wakeLock = null;
  var toastTimeout = null;
  var celebrationTimeout = null;
  var celebrationVisible = false;
  var remoteCompleteArmed = false;
  var activeTrainingDateKey = null;

  var elements = {
    screen: byId('screen'),
    planName: byId('planName'),
    hello: byId('hello'),
    date: byId('date'),
    clock: byId('clock'),
    preview: byId('preview'),
    householdStatus: byId('householdStatus'),
    jordanBtn: byId('jordanBtn'),
    kelseyBtn: byId('kelseyBtn'),
    whoopLive: byId('whoopLive'),
    progressTab: byId('progressTab'),
    whoop: byId('whoop'),
    content: byId('content'),
    controlHint: byId('controlHint'),
    toast: byId('toast'),
    remoteConfirm: byId('remoteConfirm'),
    remoteConfirmTitle: byId('remoteConfirmTitle'),
    celebration: byId('celebration'),
    celebrationSource: byId('celebrationSource'),
    celebrationTitle: byId('celebrationTitle'),
    celebrationMeta: byId('celebrationMeta')
  };
  var toolbarElements = [elements.jordanBtn, elements.kelseyBtn, elements.progressTab];

  if (days.indexOf(selectedDay) < 0) selectedDay = trainingDayName();

  function byId(id) {
    return document.getElementById(id);
  }

  function queryValue(name) {
    var match = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search || '');
    return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : null;
  }

  function readStorage(key) {
    try {
      return window.localStorage ? localStorage.getItem(key) : null;
    } catch (storageError) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      if (window.localStorage) localStorage.setItem(key, value);
    } catch (storageError) {
      return;
    }
  }

  function parseStoredJson(key, fallback) {
    try {
      return JSON.parse(readStorage(key)) || fallback;
    } catch (parseError) {
      return fallback;
    }
  }

  function pad2(value) {
    return value < 10 ? '0' + value : String(value);
  }

  function dateKey(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function trainingDate(now) {
    var value = now ? new Date(now.getTime()) : new Date();
    value.setHours(value.getHours() - TRAINING_DAY_START_HOUR);
    return value;
  }

  function trainingDayName() {
    return days[trainingDate().getDay()];
  }

  function todayKey() {
    return dateKey(trainingDate());
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function dateFromKey(key) {
    var parts = String(key || '').split('-');
    if (parts.length !== 3) return null;
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0, 0);
  }

  function addDateDays(date, amount) {
    var result = new Date(date.getTime());
    result.setDate(result.getDate() + amount);
    return result;
  }

  function mondayFor(date) {
    var monday = new Date(date.getTime());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    monday.setHours(12, 0, 0, 0);
    return monday;
  }

  function applyAccessoryRotation(referenceDate) {
    var rotation = data.accessoryRotation;
    var startsOn;
    var weekNumber;
    var cycle;
    var targetProfileId;
    var day;
    var plan;
    var accessory;
    if (!rotation || !rotation.cycleWeeks || !rotation.cycleWeeks.length) return;
    startsOn = dateFromKey(rotation.startsOn);
    if (!startsOn) return;
    weekNumber = Math.floor((mondayFor(referenceDate).getTime() - mondayFor(startsOn).getTime()) / (7 * 24 * 60 * 60 * 1000));
    if (weekNumber < 0) return;
    cycle = rotation.cycleWeeks[weekNumber % rotation.cycleWeeks.length];
    for (targetProfileId in data.profiles) {
      if (!data.profiles.hasOwnProperty(targetProfileId)) continue;
      for (day in data.profiles[targetProfileId].week) {
        if (!data.profiles[targetProfileId].week.hasOwnProperty(day)) continue;
        plan = data.profiles[targetProfileId].week[day];
        accessory = cycle[plan.name];
        if (accessory && plan.exercises && plan.exercises.length >= 3) {
          plan.exercises[2] = cloneJson(accessory);
        }
      }
    }
  }

  function applyWorkoutPlanConfig(config) {
    var current;
    var monday;
    var sunday;
    var overrides;
    var keys;
    var index;
    var key;
    var overrideDate;
    var entry;
    var targetProfileId;
    var day;
    if (!baseData.profiles || !config || config.schemaVersion !== 1) return;
    livePlanConfig = cloneJson(config);
    if (!livePlanConfig.profileWeeks) livePlanConfig.profileWeeks = {};
    if (!livePlanConfig.dateOverrides) livePlanConfig.dateOverrides = {};
    if (!livePlanConfig.rescheduleEvents) livePlanConfig.rescheduleEvents = [];
    data = cloneJson(baseData);
    if (config.profileWeeks) {
      for (targetProfileId in config.profileWeeks) {
        if (config.profileWeeks.hasOwnProperty(targetProfileId) && data.profiles[targetProfileId]) {
          data.profiles[targetProfileId].week = cloneJson(config.profileWeeks[targetProfileId]);
        }
      }
    }
    current = trainingDate();
    current.setHours(12, 0, 0, 0);
    applyAccessoryRotation(current);
    monday = addDateDays(current, -((current.getDay() + 6) % 7));
    sunday = addDateDays(monday, 6);
    overrides = config.dateOverrides || {};
    keys = Object.keys(overrides);
    for (index = 0; index < keys.length; index += 1) {
      key = keys[index];
      overrideDate = dateFromKey(key);
      if (!overrideDate || overrideDate.getTime() < monday.getTime() || overrideDate.getTime() > sunday.getTime()) continue;
      entry = overrides[key] || {};
      day = days[overrideDate.getDay()];
      for (targetProfileId in entry) {
        if (entry.hasOwnProperty(targetProfileId) && data.profiles[targetProfileId]) {
          data.profiles[targetProfileId].week[day] = cloneJson(entry[targetProfileId]);
        }
      }
    }
    if (!data.profiles[profileId]) profileId = 'jordan';
    profile = data.profiles[profileId];
    if (selectedExercise >= (planFor(selectedDay).exercises || []).length) selectedExercise = 0;
    renderAll();
    for (targetProfileId in whoopDataByProfile) {
      if (whoopDataByProfile.hasOwnProperty(targetProfileId) && whoopDataByProfile[targetProfileId]) {
        applyWhoopWorkoutCompletion(targetProfileId, whoopDataByProfile[targetProfileId]);
      }
    }
    runTvAutopilot(false);
  }

  function loadWorkoutPlan() {
    requestJson('/api/workout-plan?time=' + new Date().getTime(), function (error, response) {
      if (error || !response || response.schemaVersion !== 1) return;
      if (response.revision === livePlanRevision) return;
      livePlanRevision = response.revision;
      applyWorkoutPlanConfig(response);
    });
  }

  function stateKey() {
    return 'shopWorkout:' + profileId + ':' + todayKey();
  }

  function historyKey() {
    return 'shopHistory:' + profileId;
  }

  function uiStateKey() {
    return 'shopSessionUI:' + profileId + ':' + todayKey();
  }

  function saveUiState() {
    writeStorage(uiStateKey(), JSON.stringify({
      selectedDay: selectedDay,
      selectedExercise: selectedExercise,
      trackingMode: trackingMode,
      ambientAction: ambientAction,
      view: view,
      focusZone: focusZone,
      toolbarIndex: toolbarIndex,
      restTimerEnd: restTimerEnd,
      restTimerDuration: restTimerDuration,
      restTimerExerciseId: restTimerExerciseId,
      lastAction: lastAction
    }));
  }

  function restoreUiState() {
    var saved = parseStoredJson(uiStateKey(), null);
    if (!saved) return;
    if (typeof saved.selectedExercise === 'number' && saved.selectedExercise >= 0) {
      selectedExercise = saved.selectedExercise;
    }
    if (saved.view === 'today' || saved.view === 'progress') view = saved.view;
    if (saved.trackingMode === 'ambient' || saved.trackingMode === 'sets') {
      trackingMode = saved.trackingMode;
    }
    if (saved.ambientAction === 0 || saved.ambientAction === 1) ambientAction = saved.ambientAction;
    if (saved.focusZone === 'ambient' || saved.focusZone === 'workout' || saved.focusZone === 'day' || saved.focusZone === 'toolbar') {
      focusZone = saved.focusZone;
    }
    if (saved.view === 'progress') {
      toolbarIndex = 2;
    } else if (typeof saved.toolbarIndex === 'number' && saved.toolbarIndex >= 0 && saved.toolbarIndex < 2) {
      toolbarIndex = saved.toolbarIndex;
    } else {
      toolbarIndex = profileId === 'jordan' ? 0 : 1;
    }
    if (finiteNumber(saved.restTimerEnd) && saved.restTimerEnd > new Date().getTime()) {
      restTimerEnd = saved.restTimerEnd;
      restTimerDuration = saved.restTimerDuration || 0;
      restTimerExerciseId = saved.restTimerExerciseId || null;
    }
    if (saved.lastAction && saved.lastAction.exerciseId) lastAction = saved.lastAction;
  }

  function setClass(element, className, enabled) {
    var expression = new RegExp('(^|\\s)' + className + '(?=\\s|$)', 'g');
    var current = element.className || '';
    if (enabled && !expression.test(current)) current += ' ' + className;
    if (!enabled) current = current.replace(expression, ' ');
    element.className = current.replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' ');
  }

  function requestJson(url, callback) {
    var request = new XMLHttpRequest();
    var completed = false;
    function finish(error, response, status) {
      if (completed) return;
      completed = true;
      callback(error, response, status);
    }
    request.open('GET', url, true);
    request.onreadystatechange = function () {
      var response;
      if (request.readyState !== 4) return;
      try {
        response = JSON.parse(request.responseText || '{}');
      } catch (parseError) {
        response = {};
      }
      if (request.status >= 200 && request.status < 300) {
        finish(null, response, request.status);
      } else {
        finish(response.error || 'Request failed', response, request.status);
      }
    };
    request.onerror = function () {
      finish('Network request failed', {}, 0);
    };
    request.send(null);
  }

  function sendJson(method, url, payload, callback) {
    var request = new XMLHttpRequest();
    var completed = false;
    function finish(error, response, status) {
      if (completed) return;
      completed = true;
      if (callback) callback(error, response, status);
    }
    request.open(method, url, true);
    if (request.setRequestHeader) request.setRequestHeader('Content-Type', 'application/json');
    request.onreadystatechange = function () {
      var response;
      if (request.readyState !== 4) return;
      try {
        response = JSON.parse(request.responseText || '{}');
      } catch (parseError) {
        response = {};
      }
      if (request.status >= 200 && request.status < 300) finish(null, response, request.status);
      else finish(response.error || 'Request failed', response, request.status);
    };
    request.onerror = function () { finish('Network request failed', {}, 0); };
    request.send(JSON.stringify(payload || {}));
  }

  function showToast(message) {
    elements.toast.textContent = message;
    setClass(elements.toast, 'visible', true);
    if (toastTimeout && window.clearTimeout) window.clearTimeout(toastTimeout);
    if (window.setTimeout) {
      toastTimeout = window.setTimeout(function () {
        setClass(elements.toast, 'visible', false);
      }, 5000);
    }
  }

  function unlockAudio() {
    var AudioContextClass;
    try {
      AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!audioContext) audioContext = new AudioContextClass();
      if (audioContext.resume) audioContext.resume();
    } catch (audioError) {
      audioContext = null;
    }
  }

  function playChime() {
    var oscillator;
    var gain;
    try {
      if (!audioContext) return;
      oscillator = audioContext.createOscillator();
      gain = audioContext.createGain();
      oscillator.frequency.value = 880;
      gain.gain.value = 0.045;
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      if (oscillator.start) oscillator.start();
      else oscillator.noteOn(0);
      if (oscillator.stop) oscillator.stop(audioContext.currentTime + 0.16);
      else oscillator.noteOff(audioContext.currentTime + 0.16);
    } catch (audioError) {
      return;
    }
  }

  function requestWakeLock() {
    var request;
    try {
      if (typeof navigator === 'undefined' || !navigator.wakeLock || !navigator.wakeLock.request) return;
      request = navigator.wakeLock.request('screen');
      if (request && request.then) {
        request.then(function (lock) {
          wakeLock = lock;
        }, function () {
          wakeLock = null;
        });
      }
    } catch (wakeError) {
      wakeLock = null;
    }
  }

  function timerRemaining() {
    return restTimerEnd ? Math.max(0, Math.ceil((restTimerEnd - new Date().getTime()) / 1000)) : 0;
  }

  function timerActive() {
    return timerRemaining() > 0;
  }

  function formatTimer(seconds) {
    return Math.floor(seconds / 60) + ':' + pad2(seconds % 60);
  }

  function clearRestTimer() {
    restTimerEnd = 0;
    restTimerDuration = 0;
    restTimerExerciseId = null;
    saveUiState();
  }

  function startRestTimer(seconds, exerciseId) {
    restTimerDuration = seconds;
    restTimerEnd = new Date().getTime() + seconds * 1000;
    restTimerExerciseId = exerciseId;
    saveUiState();
  }

  function updateRestTimer() {
    var remaining;
    var value;
    var fill;
    var percent;
    if (!restTimerEnd) return;
    remaining = timerRemaining();
    if (remaining <= 0) {
      clearRestTimer();
      playChime();
      showToast('Rest complete · Next set ready');
      renderContent();
      return;
    }
    value = byId('restTimerValue');
    fill = byId('restTimerFill');
    if (value) value.textContent = formatTimer(remaining);
    if (fill) {
      percent = restTimerDuration ? Math.round(remaining / restTimerDuration * 100) : 0;
      fill.style.width = percent + '%';
    }
  }

  function stateForPlan(state, plan) {
    if (state.completed && state.planName && plan && state.planName !== plan.name) {
      return { sets: {}, completed: false };
    }
    if (!state.sets) state.sets = {};
    return state;
  }

  function loadState() {
    return stateWithSharedCompletion(profileId, stateForPlan(
      parseStoredJson(stateKey(), { sets: {}, completed: false }),
      profilePlan(profileId, trainingDayName())
    ));
  }

  function profileState(id) {
    return stateWithSharedCompletion(id, stateForPlan(
      parseStoredJson('shopWorkout:' + id + ':' + todayKey(), { sets: {}, completed: false }),
      profilePlan(id, trainingDayName())
    ));
  }

  function profilePlan(id, day) {
    var target = data.profiles[id];
    return target && target.week && target.week[day]
      ? target.week[day]
      : { name: 'Rest', exercises: [] };
  }

  function historyHasDate(history, key) {
    var index;
    for (index = 0; index < history.length; index += 1) {
      if (history[index].date === key) return true;
    }
    return false;
  }

  function completionOn(id, key) {
    var history = historyFor(id);
    var index;
    for (index = 0; index < history.length; index += 1) {
      if (history[index].date === key) return history[index];
    }
    return null;
  }

  function stateWithSharedCompletion(id, state) {
    var completion = completionOn(id, todayKey());
    var plan;
    var completionPlan;
    var index;
    if (!completion || state.completed) return state;
    plan = profilePlan(id, trainingDayName());
    completionPlan = completion.planName || completion.name;
    if (completion.completionSource !== 'whoop' && completionPlan && completionPlan !== plan.name) {
      return state;
    }
    state.completed = true;
    state.planName = plan.name;
    state.completionSource = completion.completionSource || 'legacy';
    state.completedAt = completion.completedAt || null;
    state.whoopWorkoutId = completion.whoopWorkoutId || null;
    if (!state.sets) state.sets = {};
    for (index = 0; index < (plan.exercises || []).length; index += 1) {
      state.sets[plan.exercises[index].id] = plan.exercises[index].sets;
    }
    return state;
  }

  function historyFor(id) {
    var shared = sharedHistoryByProfile[id] || [];
    var local = parseStoredJson('shopHistory:' + id, []);
    var merged = [];
    var index;
    for (index = 0; index < shared.length; index += 1) merged.push(shared[index]);
    for (index = 0; index < local.length; index += 1) {
      if (!historyHasDate(merged, local[index].date)) merged.push(local[index]);
    }
    merged.sort(function (left, right) {
      return left.date < right.date ? 1 : (left.date > right.date ? -1 : 0);
    });
    return merged;
  }

  function upsertSharedHistory(id, entry) {
    var history = sharedHistoryByProfile[id] || [];
    var updated = [];
    var index;
    for (index = 0; index < history.length; index += 1) {
      if (history[index].date !== entry.date) updated.push(history[index]);
    }
    updated.push(entry);
    updated.sort(function (left, right) {
      return left.date < right.date ? 1 : (left.date > right.date ? -1 : 0);
    });
    sharedHistoryByProfile[id] = updated;
  }

  function recordSharedCompletion(id, entry) {
    var payload = {
      profile: id,
      date: entry.date,
      planName: entry.name || entry.planName || 'Workout',
      completionSource: entry.completionSource || 'legacy',
      completedAt: entry.completedAt || new Date().toISOString(),
      whoopWorkoutId: entry.whoopWorkoutId || null
    };
    upsertSharedHistory(id, payload);
    sendJson('POST', '/api/workout-history', payload, function (error, response) {
      if (!error && response && response.completion) upsertSharedHistory(id, response.completion);
      if (view === 'progress') renderContent();
    });
  }

  function removeSharedCompletion(id, key) {
    var history = sharedHistoryByProfile[id] || [];
    var filtered = [];
    var index;
    for (index = 0; index < history.length; index += 1) {
      if (history[index].date !== key) filtered.push(history[index]);
    }
    sharedHistoryByProfile[id] = filtered;
    sendJson('DELETE', '/api/workout-history', { profile: id, date: key });
  }

  function migrateLocalHistory() {
    var ids = ['jordan', 'kelsey'];
    var idIndex;
    var local;
    var index;
    for (idIndex = 0; idIndex < ids.length; idIndex += 1) {
      local = parseStoredJson('shopHistory:' + ids[idIndex], []);
      for (index = 0; index < local.length; index += 1) {
        if (!historyHasDate(sharedHistoryByProfile[ids[idIndex]] || [], local[index].date)) {
          recordSharedCompletion(ids[idIndex], local[index]);
        }
      }
    }
  }

  function loadWorkoutHistory(force) {
    requestJson('/api/workout-history?time=' + new Date().getTime(), function (error, response) {
      if (error || !response || !response.profiles) return;
      sharedHistoryByProfile.jordan = response.profiles.jordan || [];
      sharedHistoryByProfile.kelsey = response.profiles.kelsey || [];
      workoutHistoryReady = true;
      migrateLocalHistory();
      renderContent();
      runTvAutopilot(!!force);
    });
  }

  function loadDailySteps() {
    requestJson('/api/daily-steps?time=' + new Date().getTime(), function (error, response) {
      if (error || !response || !response.profiles) return;
      sharedStepsByProfile.jordan = response.profiles.jordan || [];
      sharedStepsByProfile.kelsey = response.profiles.kelsey || [];
      if (typeof response.goal === 'number') sharedStepGoal = response.goal;
      if (view === 'progress') renderContent();
    });
  }

  function stepsOn(id, key) {
    var entries = sharedStepsByProfile[id] || [];
    var index;
    for (index = 0; index < entries.length; index += 1) {
      if (entries[index].date === key) return entries[index];
    }
    return null;
  }

  function formatStepCount(value) {
    var rounded;
    if (typeof value !== 'number' || !isFinite(value)) return '—';
    if (value < 1000) return String(value);
    rounded = Math.round(value / 100) / 10;
    return String(rounded).replace(/\.0$/, '') + 'k';
  }

  function stepGoalLabel(id, key) {
    var entry = stepsOn(id, key);
    if (!entry) return 'steps unavailable';
    return entry.steps + ' steps' + (entry.met ? ' · goal met' : ' · below goal');
  }

  function stepGoalMarker(id, key) {
    var entry = stepsOn(id, key);
    if (!entry) return '';
    return '<span class="step-goal-marker ' + id + '-step ' + (entry.met ? 'met' : 'under') + '"></span>';
  }

  function completedOn(id, key) {
    var history = historyFor(id);
    var index;
    for (index = 0; index < history.length; index += 1) {
      if (history[index].date === key) return true;
    }
    return false;
  }

  function rescheduleFrom(id, key) {
    var events = livePlanConfig.rescheduleEvents || [];
    var index;
    for (index = 0; index < events.length; index += 1) {
      if (events[index].profile === id && events[index].fromDate === key) return events[index];
    }
    return null;
  }

  function rotatedPlanForDate(plan, date) {
    var rotation = baseData.accessoryRotation;
    var startsOn;
    var weekNumber;
    var cycle;
    var result = cloneJson(plan || { name: 'Rest', exercises: [] });
    if (!rotation || !rotation.cycleWeeks || !rotation.cycleWeeks.length ||
        !result.exercises || result.exercises.length < 3) return result;
    startsOn = dateFromKey(rotation.startsOn);
    if (!startsOn) return result;
    weekNumber = Math.floor((mondayFor(date).getTime() - mondayFor(startsOn).getTime()) /
      (7 * 24 * 60 * 60 * 1000));
    if (weekNumber < 0) return result;
    cycle = rotation.cycleWeeks[weekNumber % rotation.cycleWeeks.length];
    if (cycle[result.name]) result.exercises[2] = cloneJson(cycle[result.name]);
    return result;
  }

  function profilePlanForDate(id, date) {
    var key = dateKey(date);
    var override = livePlanConfig.dateOverrides && livePlanConfig.dateOverrides[key];
    var target = baseData.profiles && baseData.profiles[id];
    var week;
    var day;
    if (override && override[id]) return cloneJson(override[id]);
    if (!target) return { name: 'Rest', exercises: [] };
    week = livePlanConfig.profileWeeks && livePlanConfig.profileWeeks[id]
      ? livePlanConfig.profileWeeks[id]
      : target.week;
    day = days[date.getDay()];
    return rotatedPlanForDate(week[day] || { name: 'Rest', exercises: [] }, date);
  }

  function calendarStatus(id, date) {
    var key = dateKey(date);
    var plan;
    var today = trainingDate();
    today.setHours(12, 0, 0, 0);
    if (completedOn(id, key)) return 'done';
    if (rescheduleFrom(id, key)) return 'pushed';
    plan = profilePlanForDate(id, date);
    if (!plan.exercises || !plan.exercises.length) return 'rest';
    if (date.getTime() < today.getTime()) return 'missed';
    return 'scheduled';
  }

  function calendarStatusLabel(status) {
    if (status === 'done') return 'completed';
    if (status === 'pushed') return 'pushed';
    if (status === 'missed') return 'missed';
    if (status === 'scheduled') return 'scheduled';
    return 'rest';
  }

  function calendarStatusColor(status) {
    if (status === 'done') return '#65d995';
    if (status === 'pushed') return '#8064d9';
    if (status === 'missed') return '#713a43';
    if (status === 'scheduled') return '#292e2b';
    return '#131715';
  }

  function monthStats(id, firstDate, lastDate) {
    var today = trainingDate();
    var cursor = new Date(firstDate.getTime());
    var planned = 0;
    var completed = 0;
    var status;
    var plan;
    var streak = 0;
    var streakCursor;
    var considered;
    today.setHours(12, 0, 0, 0);
    while (cursor.getTime() <= lastDate.getTime() && cursor.getTime() <= today.getTime()) {
      status = calendarStatus(id, cursor);
      plan = profilePlanForDate(id, cursor);
      if ((plan.exercises && plan.exercises.length) || status === 'pushed' || status === 'done') {
        planned += 1;
        if (status === 'done') completed += 1;
      }
      cursor = addDateDays(cursor, 1);
    }
    streakCursor = new Date(today.getTime());
    considered = 0;
    while (considered < 120) {
      status = calendarStatus(id, streakCursor);
      plan = profilePlanForDate(id, streakCursor);
      if (streakCursor.getTime() === today.getTime() && status === 'scheduled') {
        streakCursor = addDateDays(streakCursor, -1);
        considered += 1;
        continue;
      }
      if ((plan.exercises && plan.exercises.length) || status === 'pushed' || status === 'done') {
        if (status === 'done') streak += 1;
        else break;
      }
      streakCursor = addDateDays(streakCursor, -1);
      considered += 1;
    }
    return {
      planned: planned,
      completed: completed,
      percent: planned ? Math.round(completed / planned * 100) : 100,
      streak: streak
    };
  }

  function latestHistory(id) {
    var history = historyFor(id);
    var latest = null;
    var index;
    for (index = 0; index < history.length; index += 1) {
      if (!latest || history[index].date > latest.date) latest = history[index];
    }
    return latest;
  }

  function shortDate(key) {
    var date = dateFromKey(key);
    var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return date ? monthNames[date.getMonth()] + ' ' + date.getDate() : key;
  }

  function loadDisplayState() {
    return selectedDay === trainingDayName()
      ? loadState()
      : { sets: {}, completed: false };
  }

  function saveProfileState(id, state) {
    var history;
    var plan;
    var found;
    var index;
    plan = profilePlan(id, trainingDayName());
    if (state.completed) state.planName = plan.name;
    writeStorage('shopWorkout:' + id + ':' + todayKey(), JSON.stringify(state));
    if (state.completed) {
      history = parseStoredJson('shopHistory:' + id, []);
      found = false;
      for (index = 0; index < history.length; index += 1) {
        if (history[index].date === todayKey()) found = true;
      }
      if (!found) {
        history.unshift({
          date: todayKey(),
          name: plan.name,
          completionSource: state.completionSource || 'manual',
          completedAt: state.completedAt || new Date().toISOString(),
          whoopWorkoutId: state.whoopWorkoutId || null
        });
        writeStorage('shopHistory:' + id, JSON.stringify(history.slice(0, 60)));
      }
      recordSharedCompletion(id, {
        date: todayKey(),
        name: plan.name,
        completionSource: state.completionSource || 'manual',
        completedAt: state.completedAt || new Date().toISOString(),
        whoopWorkoutId: state.whoopWorkoutId || null
      });
    }
    if (id === profileId) renderContent();
    else renderHouseholdStatus();
  }

  function saveState(state) {
    saveProfileState(profileId, state);
  }

  function planFor(day) {
    return profile.week && profile.week[day]
      ? profile.week[day]
      : { name: 'Rest', exercises: [] };
  }

  function sessionSummary(plan) {
    var items = plan.exercises || [];
    var sets = 0;
    var seconds = 0;
    var index;
    var exercise;
    for (index = 0; index < items.length; index += 1) {
      exercise = items[index];
      sets += exercise.sets;
      seconds += exercise.sets * 40;
      seconds += Math.max(exercise.sets - 1, 0) * exercise.restSeconds;
      if (index < items.length - 1) seconds += 45;
    }
    return {
      moves: items.length,
      sets: sets,
      minutes: Math.max(10, Math.round(seconds / 60))
    };
  }

  function completedSets(plan, state) {
    var total = 0;
    var items = plan.exercises || [];
    var index;
    for (index = 0; index < items.length; index += 1) {
      total += Math.min(state.sets[items[index].id] || 0, items[index].sets);
    }
    return total;
  }

  function nextWorkout() {
    var start = days.indexOf(selectedDay);
    var offset;
    var day;
    var plan;
    for (offset = 1; offset <= 7; offset += 1) {
      day = days[(start + offset) % 7];
      plan = planFor(day);
      if (plan.exercises && plan.exercises.length) {
        return { day: day, plan: plan, offset: offset };
      }
    }
    return null;
  }

  function weekStats() {
    var history = parseStoredJson(historyKey(), []);
    var now = trainingDate();
    var monday = new Date(now.getTime());
    var scheduled = 0;
    var completed = 0;
    var dayOffset;
    var day;
    var dayName;
    var plan;
    var historyIndex;
    var wasCompleted;
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    for (dayOffset = 0; dayOffset < 7; dayOffset += 1) {
      day = new Date(monday.getTime());
      day.setDate(monday.getDate() + dayOffset);
      dayName = days[day.getDay()];
      plan = planFor(dayName);
      if (plan.exercises && plan.exercises.length) {
        scheduled += 1;
        wasCompleted = false;
        for (historyIndex = 0; historyIndex < history.length; historyIndex += 1) {
          if (history[historyIndex].date === dateKey(day)) wasCompleted = true;
        }
        if (wasCompleted) completed += 1;
      }
    }
    return { scheduled: scheduled, completed: completed };
  }

  function noteInteraction() {
    lastInteractionAt = new Date().getTime();
  }

  function driftScreen() {
    var offset;
    if (!elements.screen || !elements.screen.style) return;
    driftIndex = (driftIndex + 1) % DRIFT_OFFSETS.length;
    offset = DRIFT_OFFSETS[driftIndex];
    elements.screen.style.transform = 'translate(' + offset[0] + 'px,' + offset[1] + 'px)';
  }

  function activeSetSession() {
    var state;
    var key;
    if (trackingMode !== 'sets' || selectedDay !== trainingDayName()) return false;
    state = loadState();
    if (state.completed || !state.sets) return false;
    for (key in state.sets) {
      if (state.sets.hasOwnProperty(key) && state.sets[key] > 0) return true;
    }
    return false;
  }

  function pendingWorkoutProfiles() {
    var ids = ['jordan', 'kelsey'];
    var pending = [];
    var index;
    var plan;
    for (index = 0; index < ids.length; index += 1) {
      plan = profilePlan(ids[index], trainingDayName());
      if (plan.exercises && plan.exercises.length && !profileState(ids[index]).completed) {
        pending.push(ids[index]);
      }
    }
    return pending;
  }

  function runTvAutopilot(force) {
    var now = new Date().getTime();
    var pending;
    var nextProfile;
    var nextView;
    var changed = false;
    if (!workoutHistoryReady || celebrationVisible || activeSetSession()) return;
    if (!force && lastInteractionAt && now - lastInteractionAt < AUTOPILOT_IDLE_MS) return;
    pending = pendingWorkoutProfiles();
    nextView = pending.length ? 'today' : 'progress';
    nextProfile = pending.length ? pending[0] : profileId;

    if (selectedDay !== trainingDayName()) {
      selectedDay = trainingDayName();
      changed = true;
    }
    if (profileId !== nextProfile && data.profiles[nextProfile]) {
      profileId = nextProfile;
      profile = data.profiles[nextProfile];
      whoopData = whoopDataByProfile[nextProfile];
      writeStorage('shopProfile', nextProfile);
      changed = true;
    }
    if (view !== nextView) {
      view = nextView;
      changed = true;
    }
    if (!changed) return;

    selectedExercise = 0;
    trackingMode = 'ambient';
    ambientAction = 0;
    restTimerEnd = 0;
    restTimerDuration = 0;
    restTimerExerciseId = null;
    lastAction = null;
    focusZone = nextView === 'progress'
      ? 'toolbar'
      : (profilePlan(nextProfile, trainingDayName()).exercises.length ? 'ambient' : 'day');
    toolbarIndex = nextView === 'progress' ? 2 : (nextProfile === 'jordan' ? 0 : 1);
    updateDayUrl(null);
    saveUiState();
    renderContent();
    if (nextView === 'today') {
      if (whoopDataByProfile[nextProfile]) renderWhoopMetrics(nextProfile, whoopDataByProfile[nextProfile]);
      else {
        elements.whoop.className = 'status';
        elements.whoop.textContent = profile.name + ' WHOOP is updating…';
      }
    }
  }

  function refreshDashboardData() {
    loadWorkoutPlan();
    loadWorkoutHistory();
    loadDailySteps();
    loadAllWhoop();
  }

  function setProfile(id) {
    if (!data.profiles[id]) return;
    noteInteraction();
    dismissRemoteCompletion();
    saveUiState();
    profileId = id;
    profile = data.profiles[id];
    writeStorage('shopProfile', id);
    selectedDay = trainingDayName();
    updateDayUrl(null);
    selectedExercise = 0;
    trackingMode = 'ambient';
    ambientAction = 0;
    restTimerEnd = 0;
    restTimerDuration = 0;
    restTimerExerciseId = null;
    lastAction = null;
    restoreUiState();
    view = 'today';
    focusZone = 'toolbar';
    toolbarIndex = id === 'jordan' ? 0 : 1;
    whoopData = whoopDataByProfile[id];
    elements.whoop.className = 'status';
    elements.whoop.textContent = profile.name + ' WHOOP is updating…';
    elements.whoopLive.textContent = profile.name.toUpperCase() + ' WHOOP · UPDATING';
    renderAll();
    if (whoopData) renderWhoopMetrics(id, whoopData);
    loadWhoop(id);
  }

  function updateClock() {
    var now = new Date();
    var hours = now.getHours();
    var minutes = pad2(now.getMinutes());
    var suffix = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    elements.clock.textContent = hours + ':' + minutes + ' ' + suffix;
    updateWhoopFreshness();
  }

  function householdPerson(id) {
    var householdProfile = data.profiles[id];
    var plan;
    var state;
    var status;
    var className;
    if (!householdProfile) return '';
    plan = householdProfile.week && householdProfile.week[trainingDayName()];
    state = profileState(id);
    if (!plan || !plan.exercises || !plan.exercises.length) {
      status = 'Rest';
      className = 'rest';
    } else if (state.completed) {
      status = 'Done';
      className = 'done';
    } else {
      status = 'Ready';
      className = 'ready';
    }
    return '<span class="household-person ' + className + '"><i></i>' +
      householdProfile.name + '<strong>' + status + '</strong></span>';
  }

  function renderHouseholdStatus() {
    elements.householdStatus.innerHTML = '<span class="household-label">Today</span>' +
      householdPerson('jordan') + householdPerson('kelsey');
  }

  function applyToolbarFocus() {
    var index;
    for (index = 0; index < toolbarElements.length; index += 1) {
      setClass(toolbarElements[index], 'remote-focus', focusZone === 'toolbar' && index === toolbarIndex);
    }
  }

  function renderHeader() {
    var plan = planFor(selectedDay);
    var currentTrainingDate = trainingDate();
    var isToday = selectedDay === trainingDayName();
    elements.hello.textContent = 'HELLO, ' + profile.name.toUpperCase();
    elements.planName.textContent = plan.name.toUpperCase();
    setClass(elements.jordanBtn, 'active', view === 'today' && profileId === 'jordan');
    setClass(elements.kelseyBtn, 'active', view === 'today' && profileId === 'kelsey');
    setClass(elements.preview, 'visible', !isToday);
    renderHouseholdStatus();
    applyToolbarFocus();
    elements.date.textContent = isToday
      ? currentTrainingDate.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        })
      : selectedDay + ' · Preview';
  }

  function summaryItem(label, value) {
    return '<div class="summary-item"><span>' + label + '</span><b>' + value + '</b></div>';
  }

  function setSegments(done, total) {
    var html = '';
    var index;
    for (index = 0; index < total; index += 1) {
      html += '<i class="set-segment ' + (index < done ? 'done' : '') + '"></i>';
    }
    return html;
  }

  function setDots(done, total) {
    var html = '';
    var index;
    for (index = 0; index < total; index += 1) {
      html += '<i class="set-dot ' + (index < done ? 'done' : '') + '"></i>';
    }
    return html;
  }

  function weekStrip() {
    var html = '<div class="week-strip">';
    var index;
    var day;
    var plan;
    for (index = 0; index < weekOrder.length; index += 1) {
      day = weekOrder[index];
      plan = planFor(day);
      html += '<button type="button" class="week-day ' +
        (day === selectedDay ? 'selected ' : '') +
        (focusZone === 'day' && day === selectedDay ? 'remote-focus ' : '') +
        (plan.exercises && plan.exercises.length ? 'training' : '') +
        '" onclick="setDay(\'' + day + '\')">' +
        '<span>' + day.slice(0, 3) + '</span><b>' +
        (plan.exercises && plan.exercises.length ? plan.name : 'Rest') +
        '</b></button>';
    }
    return html + '</div>';
  }

  function completionSourceLabel(state) {
    if (state.completionSource === 'whoop') {
      return 'Confirmed by WHOOP' + (state.whoopSportName ? ' · ' + state.whoopSportName : '');
    }
    if (state.completionSource === 'sets') return 'Completed with set tracking';
    return 'Marked complete on this screen';
  }

  function renderAmbientTraining(plan) {
    var state = loadDisplayState();
    var summary = sessionSummary(plan);
    var items = plan.exercises || [];
    var rows = '';
    var index;
    var exercise;
    var done;
    var isToday = selectedDay === trainingDayName();
    var complete = !!state.completed;
    var primaryLabel = isToday ? 'Complete workout' : 'Return to today';
    for (index = 0; index < items.length; index += 1) {
      exercise = items[index];
      done = Math.min(state.sets[exercise.id] || 0, exercise.sets);
      rows += '<div class="ambient-move ' + (done >= exercise.sets ? 'complete' : '') + '">' +
        '<span class="ambient-number">' + pad2(index + 1) + '</span>' +
        '<span class="ambient-name">' + exercise.name + '</span>' +
        '<span class="ambient-prescription">' + exercise.sets + ' × ' + exercise.reps + '</span>' +
        '<span class="ambient-check">' + (done >= exercise.sets ? '✓' : '') + '</span></div>';
    }
    elements.content.innerHTML =
      '<div class="view training-view ambient-view">' +
      '<div class="view-head"><div><div class="view-label">Today’s plan</div>' +
      '<div class="view-title">' + plan.name.toUpperCase() + ' DAY</div>' +
      '<div class="view-subtitle">Everything you need. Nothing to manage.</div></div>' +
      '<div class="session-summary">' +
      summaryItem('Movements', summary.moves) + summaryItem('Sets', summary.sets) +
      summaryItem('Est. time', summary.minutes + ' min') + '</div></div>' +
      '<div class="ambient-layout"><div class="ambient-plan">' + rows + '</div>' +
      '<div class="ambient-panel ' + (complete ? 'complete' : '') + '">' +
      '<div class="ambient-status"><div class="ambient-eyebrow">' + profile.name + ' · ' + (isToday ? 'Live plan' : 'Preview') + '</div>' +
      '<div class="ambient-state ' + (complete ? 'done' : '') + '">' +
      (complete ? 'WORKOUT COMPLETE' : 'READY WHEN YOU ARE') + '</div>' +
      '<div class="ambient-copy">' + (complete
        ? summary.moves + ' movements · ' + summary.sets + ' sets · finished for this training day.'
        : (profileId === 'jordan'
          ? (whoopData && whoopData.workoutAccess === false
            ? 'WHOOP health data is live. Reconnect once to enable automatic workout completion.'
            : 'Train normally. An eligible WHOOP strength workout will check this off automatically.')
          : 'Kelsey’s progress is separate. Mark the workout complete here when finished.')) + '</div>' +
      (complete ? '<div class="ambient-source">' + completionSourceLabel(state) + '</div>' : '') + '</div>' +
      '<div class="ambient-actions">' +
      (!complete ? '<button class="ambient-action primary ' +
        (focusZone === 'ambient' && ambientAction === 0 ? 'remote-focus' : '') +
        '" onclick="activateAmbientAction(0)">' + primaryLabel + '<span>✓</span></button>' : '') +
      (!complete && profileId === 'jordan' ? '<div class="ambient-auto">' +
        (whoopData && whoopData.workoutAccess === false
          ? 'Manual completion always remains available.'
          : 'WHOOP checks every 5 minutes. Manual WHOOP entries count too.') + '</div>' : '') +
      '</div></div></div></div>';
    elements.controlHint.innerHTML = complete
      ? '<span class="key">Enter</span> Review sets <span class="key">← →</span> Day <span class="key">↑</span> Menu'
      : '<span class="key">↑ ↓</span> Action <span class="key">Enter</span> Select <span class="key">← →</span> Day';
  }

  function renderSetTracking(plan) {
    var state = loadDisplayState();
    var summary = sessionSummary(plan);
    var doneTotal = completedSets(plan, state);
    var items = plan.exercises || [];
    var selected;
    var selectedDone;
    var rows = '';
    var index;
    var exercise;
    var done;
    var className;
    var remaining;
    var middleHtml;
    var nextSet;
    if (selectedExercise >= items.length) selectedExercise = Math.max(items.length - 1, 0);
    selected = items[selectedExercise];
    selectedDone = Math.min(state.sets[selected.id] || 0, selected.sets);
    remaining = timerRemaining();
    if (remaining > 0) {
      middleHtml = '<div class="focus-middle timer-block"><div class="timer-label">Rest timer</div>' +
        '<div class="timer-value" id="restTimerValue">' + formatTimer(remaining) + '</div>' +
        '<div class="timer-next">Next: ' + selected.name + '</div>' +
        '<div class="timer-track"><i id="restTimerFill" style="width:' +
        (restTimerDuration ? Math.round(remaining / restTimerDuration * 100) : 0) + '%"></i></div></div>';
    } else {
      nextSet = Math.min(selectedDone + 1, selected.sets);
      middleHtml = '<div class="focus-middle"><div class="stage-label">' +
        (selectedDone >= selected.sets ? 'Movement' : 'Next set') + '</div>' +
        '<div class="stage-value">' + (selectedDone >= selected.sets ? 'DONE' : pad2(nextSet)) + '</div></div>';
    }

    for (index = 0; index < items.length; index += 1) {
      exercise = items[index];
      done = Math.min(state.sets[exercise.id] || 0, exercise.sets);
      className = 'exercise';
      if (index === selectedExercise) className += ' selected';
      if (focusZone === 'workout' && index === selectedExercise) className += ' remote-focus';
      if (done >= exercise.sets) className += ' complete';
      rows += '<button type="button" class="' + className + '" onclick="selectExercise(' + index + ')">' +
        '<span class="exercise-num">' + pad2(index + 1) + '</span>' +
        '<div class="exercise-main"><div class="exercise-name">' + exercise.name + '</div>' +
        '<div class="exercise-meta">' + exercise.reps + ' reps · ' +
        exercise.restSeconds + 's rest</div></div>' +
        '<div class="set-dots">' + setDots(done, exercise.sets) + '</div>' +
        '<div class="set-count">' + done + '/' + exercise.sets + '</div></button>';
    }

    elements.content.innerHTML =
      '<div class="view training-view">' +
      '<div class="view-head"><div><div class="view-label">Today’s session</div>' +
      '<div class="view-title">' + plan.name.toUpperCase() + ' SESSION</div>' +
      '<div class="view-subtitle">Optional set tracker · Back returns to the daily plan.</div></div>' +
      '<div class="session-summary">' +
      summaryItem('Progress', doneTotal + ' / ' + summary.sets) +
      summaryItem('Movements', summary.moves) +
      summaryItem('Est. time', summary.minutes + ' min') +
      '</div></div>' +
      '<div class="training-layout">' +
      '<div class="focus-card ' + (focusZone === 'workout' ? 'remote-focus' : '') + '"><div class="focus-top"><span class="focus-index">NOW · ' +
      pad2(selectedExercise + 1) + '</span><span class="focus-state">' +
      (selectedDone >= selected.sets ? 'Complete' : 'In progress') + '</span></div>' +
      '<div class="focus-name">' + selected.name + '</div>' +
      '<div class="focus-prescription">' + selected.sets + ' sets · ' +
      selected.reps + ' reps · ' + selected.restSeconds + ' sec rest</div>' +
      middleHtml +
      '<div class="set-section"><div class="set-readout"><strong>' + selectedDone +
      '</strong><span>of ' + selected.sets + ' sets complete</span></div>' +
      '<div class="set-track">' + setSegments(selectedDone, selected.sets) + '</div>' +
      '<div class="focus-hint">' + (remaining > 0 ? 'Enter skips rest · Back undoes the last set' : 'Enter marks the next set complete') + '</div></div></div>' +
      '<div class="session-list">' + rows + '</div></div></div>';

    elements.controlHint.innerHTML =
      '<span class="key">↑ ↓</span> Movement <span class="key">← →</span> Day ' +
      '<span class="key">Enter</span> Complete / skip <span class="key">Back</span> Undo';
  }

  function renderTraining(plan) {
    if (trackingMode === 'sets') renderSetTracking(plan);
    else renderAmbientTraining(plan);
  }

  function readinessInfo() {
    var score = null;
    var recovery;
    if (whoopData && whoopData.recovery && whoopData.recovery.score) {
      recovery = whoopData.recovery.score.recovery_score;
      if (finiteNumber(recovery)) score = Math.round(recovery);
    }
    if (score === null) {
      return { score: '—', title: 'Recovery day', detail: 'Easy movement, mobility, and consistent sleep.' };
    }
    if (score >= 67) {
      return { score: score + '%', title: 'Well recovered', detail: 'Use the spare capacity for a walk or light mobility.' };
    }
    if (score >= 34) {
      return { score: score + '%', title: 'Rebuild steadily', detail: 'Keep activity easy and protect tonight’s sleep.' };
    }
    return { score: score + '%', title: 'Prioritize recovery', detail: 'Reduce load, hydrate, and keep the day genuinely easy.' };
  }

  function renderRest() {
    var next = nextWorkout();
    var nextSummary = next ? sessionSummary(next.plan) : { moves: 0, sets: 0, minutes: 0 };
    var readiness = readinessInfo();
    elements.content.innerHTML =
      '<div class="view rest-view">' +
      '<div class="view-head"><div><div class="view-label">Today’s intent</div>' +
      '<div class="view-title">RECOVERY DAY</div>' +
      '<div class="view-subtitle">Training improves when recovery is part of the plan.</div></div></div>' +
      '<div class="rest-layout">' +
      '<div class="rest-hero"><div><div class="rest-word">REST.</div>' +
      '<div class="rest-copy">Reset the system today so the next session can be performed with quality—not just completed.</div></div>' +
      '<div class="readiness"><div class="readiness-score">' + readiness.score + '</div>' +
      '<div class="readiness-copy"><b>' + readiness.title + '</b><span>' + readiness.detail + '</span></div></div></div>' +
      '<div class="rest-side"><div class="next-card"><div><div class="card-label">Up next</div>' +
      '<div class="next-day">' + (next ? next.day : 'No session') + '</div>' +
      '<div class="next-name">' + (next ? next.plan.name + ' Session' : 'Schedule clear') + '</div>' +
      '<div class="next-meta"><span>' + nextSummary.moves + ' movements</span><span>' +
      nextSummary.sets + ' sets</span><span>~' + nextSummary.minutes + ' min</span></div></div>' +
      '<div class="next-arrow">→</div></div>' +
      '<div class="recovery-card"><div class="recovery-line"><strong>Today’s recovery recipe</strong>' +
      '<div class="recovery-actions">Easy movement · Mobility · Hydration · Sleep on schedule</div></div></div></div></div>' +
      weekStrip() + '</div>';
    elements.controlHint.innerHTML =
      '<span class="key">↑</span> Menu <span class="key">← →</span> Change day ' +
      '<span class="key">Today</span> Return to live';
  }

  function progressWhoopValues(id) {
    var response = whoopDataByProfile[id] || {};
    var recovery = response.recovery && response.recovery.score ? response.recovery.score : {};
    var sleep = response.sleep && response.sleep.score ? response.sleep.score : {};
    return {
      recovery: recovery.recovery_score != null ? Math.round(recovery.recovery_score) + '%' : '—',
      hrv: recovery.hrv_rmssd_milli != null ? Math.round(recovery.hrv_rmssd_milli) + ' ms' : '—',
      sleep: sleep.sleep_performance_percentage != null ? Math.round(sleep.sleep_performance_percentage) + '%' : '—'
    };
  }

  function progressWhoopMetric(id, label, value) {
    var name = baseData.profiles && baseData.profiles[id] ? baseData.profiles[id].name : id;
    return '<div class="metric household-metric ' + id + '"><span class="metric-person">' +
      name + '</span><span class="metric-label">' + label + '</span><b>' + value + '</b></div>';
  }

  function renderProgressWhoop() {
    var jordan = progressWhoopValues('jordan');
    var kelsey = progressWhoopValues('kelsey');
    elements.whoop.className = 'whoop household-whoop';
    elements.whoop.innerHTML =
      progressWhoopMetric('jordan', 'Recovery', jordan.recovery) +
      progressWhoopMetric('jordan', 'HRV', jordan.hrv) +
      progressWhoopMetric('kelsey', 'Recovery', kelsey.recovery) +
      progressWhoopMetric('kelsey', 'HRV', kelsey.hrv);
  }

  function renderProgressHeader() {
    var now = trainingDate();
    var monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    elements.hello.textContent = 'HOUSEHOLD PROGRESS';
    setClass(elements.hello, 'progress-welcome', true);
    elements.planName.textContent = 'SHARED';
    elements.date.textContent = monthNames[now.getMonth()] + ' ' + now.getFullYear();
    elements.whoopLive.textContent = 'HOUSEHOLD WHOOP · LIVE';
    setClass(elements.preview, 'visible', false);
    setClass(elements.jordanBtn, 'active', false);
    setClass(elements.kelseyBtn, 'active', false);
    renderProgressWhoop();
  }

  function progressPersonPanel(id, firstDate, lastDate) {
    var target = baseData.profiles && baseData.profiles[id] ? baseData.profiles[id] : { name: id };
    var stats = monthStats(id, firstDate, lastDate);
    var latest = latestHistory(id);
    var whoop = progressWhoopValues(id);
    var initial = target.name.slice(0, 1).toUpperCase();
    var dailySteps = stepsOn(id, todayKey());
    var stepPercent = dailySteps ? Math.min(100, Math.round(dailySteps.steps / dailySteps.goal * 100)) : 0;
    return '<section class="person-progress ' + id + '-progress">' +
      '<div class="person-progress-head"><div class="person-avatar">' + initial + '</div>' +
      '<div><span>Monthly rhythm</span><strong>' + target.name + '</strong></div></div>' +
      '<div class="person-recovery"><span>WHOOP recovery</span><strong>' + whoop.recovery + '</strong>' +
      '<small>Sleep ' + whoop.sleep + '</small></div>' +
      '<div class="person-stat-grid"><div><span>Sessions</span><strong>' + stats.completed +
      ' <small>/ ' + stats.planned + '</small></strong></div><div><span>Consistency</span><strong>' +
      stats.percent + '%</strong></div></div>' +
      '<div class="person-streak"><span>Current streak</span><strong>' + stats.streak +
      '</strong><small>session' + (stats.streak === 1 ? '' : 's') + '</small></div>' +
      '<div class="person-steps ' + (dailySteps ? '' : 'unavailable') + '"><div class="person-steps-head"><div><span>Steps today</span><strong>' +
      (dailySteps ? formatStepCount(dailySteps.steps) : 'NOT CONNECTED') + '</strong></div><small>' +
      (dailySteps ? formatStepCount(dailySteps.goal) + ' goal' : 'iPhone sync') + '</small></div>' +
      '<div class="step-track"><i style="width:' + stepPercent + '%"></i></div></div>' +
      '<div class="person-latest"><span>Latest session</span><strong>' +
      (latest ? (latest.planName || latest.name || 'Workout') : 'Nothing logged yet') + '</strong><small>' +
      (latest ? shortDate(latest.date) : 'Your first green day starts here') + '</small></div></section>';
  }

  function renderMonthCalendar(firstDate, lastDate) {
    var dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    var monthNames = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
      'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
    var offset = (firstDate.getDay() + 6) % 7;
    var today = todayKey();
    var html = '';
    var index;
    var dayNumber;
    var date;
    var key;
    var jordanStatus;
    var kelseyStatus;
    for (index = 0; index < dayLabels.length; index += 1) {
      html += '<div class="calendar-weekday">' + dayLabels[index] + '</div>';
    }
    for (index = 0; index < 42; index += 1) {
      dayNumber = index - offset + 1;
      if (dayNumber < 1 || dayNumber > lastDate.getDate()) {
        html += '<div class="calendar-day empty-day"></div>';
      } else {
        date = new Date(firstDate.getFullYear(), firstDate.getMonth(), dayNumber, 12, 0, 0, 0);
        key = dateKey(date);
        jordanStatus = calendarStatus('jordan', date);
        kelseyStatus = calendarStatus('kelsey', date);
        html += '<div class="calendar-day filled j-' + jordanStatus + ' k-' + kelseyStatus +
          (key === today ? ' today' : '') + '" data-date="' + key + '" title="Jordan: ' +
          calendarStatusLabel(jordanStatus) + ' · ' + stepGoalLabel('jordan', key) +
          ' · Kelsey: ' + calendarStatusLabel(kelseyStatus) + ' · ' + stepGoalLabel('kelsey', key) +
          '" style="background:linear-gradient(135deg,' + calendarStatusColor(jordanStatus) +
          ' 0%,' + calendarStatusColor(jordanStatus) + ' 48%,#090c0a 49%,#090c0a 51%,' +
          calendarStatusColor(kelseyStatus) + ' 52%,' + calendarStatusColor(kelseyStatus) +
          ' 100%)"><span class="calendar-initial jordan-initial">J</span>' + stepGoalMarker('jordan', key) +
          '<b>' + dayNumber + '</b><span class="calendar-initial kelsey-initial">K</span>' +
          stepGoalMarker('kelsey', key) + '</div>';
      }
    }
    return '<section class="calendar-panel"><div class="calendar-head"><div><span>Together this month</span>' +
      '<strong>' + monthNames[firstDate.getMonth()] + ' ' + firstDate.getFullYear() + '</strong></div>' +
      '<div class="calendar-key"><i class="done"></i>Completed <i class="pushed"></i>Pushed ' +
      '<i class="rest"></i>Rest <i class="scheduled"></i>Scheduled <i class="missed"></i>Missed ' +
      '<i class="steps"></i>12.5k goal</div></div>' +
      '<div class="month-grid">' + html + '</div>' +
      '<div class="calendar-foot"><span><b>J</b> Jordan · upper left</span>' +
      '<span><b>K</b> Kelsey · lower right</span></div></section>';
  }

  function renderProgress() {
    var now = trainingDate();
    var firstDate = new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0, 0);
    var lastDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 12, 0, 0, 0);
    renderProgressHeader();
    elements.content.innerHTML =
      '<div class="view progress-view household-progress">' +
      '<div class="household-progress-layout">' +
      progressPersonPanel('jordan', firstDate, lastDate) +
      renderMonthCalendar(firstDate, lastDate) +
      progressPersonPanel('kelsey', firstDate, lastDate) + '</div></div>';
    elements.controlHint.innerHTML =
      '<span class="key">↑</span> Menu <span class="key">Today</span> Daily plan';
  }

  function renderRemoteHint() {
    elements.controlHint.className = 'control-hint remote-dock';
    elements.controlHint.innerHTML =
      '<button class="remote-command' + (view === 'today' && profileId === 'jordan' ? ' active' : '') + '" onclick="setProfile(\'jordan\')">' +
      '<span class="remote-color red"></span><strong>1</strong>Jordan</button>' +
      '<button class="remote-command' + (view === 'today' && profileId === 'kelsey' ? ' active' : '') + '" onclick="setProfile(\'kelsey\')">' +
      '<span class="remote-color green"></span><strong>2</strong>Kelsey</button>' +
      '<button class="remote-command' + (view === 'progress' ? ' active' : '') + '" onclick="setView(\'progress\')">' +
      '<span class="remote-color yellow"></span><strong>3</strong>Progress</button>' +
      '<button class="remote-command complete" onclick="armRemoteCompletion()">' +
      '<span class="remote-color blue"></span><strong>0</strong>Workout complete</button>';
  }

  function renderContent() {
    var plan;
    setClass(elements.hello, 'progress-welcome', view === 'progress');
    renderHeader();
    setClass(elements.progressTab, 'active', view === 'progress');
    if (view === 'progress') {
      renderProgress();
      renderRemoteHint();
      return;
    }
    plan = planFor(selectedDay);
    if (plan.exercises && plan.exercises.length) {
      renderTraining(plan);
    } else {
      renderRest();
    }
    renderRemoteHint();
  }

  function setTrackingMode(mode) {
    noteInteraction();
    trackingMode = mode === 'sets' ? 'sets' : 'ambient';
    ambientAction = 0;
    focusZone = trackingMode === 'sets' ? 'workout' : 'ambient';
    saveUiState();
    renderContent();
  }

  function dismissCelebration() {
    celebrationVisible = false;
    setClass(elements.celebration, 'visible', false);
    if (celebrationTimeout && window.clearTimeout) window.clearTimeout(celebrationTimeout);
    celebrationTimeout = null;
  }

  function dismissRemoteCompletion() {
    remoteCompleteArmed = false;
    setClass(elements.remoteConfirm, 'visible', false);
  }

  function armRemoteCompletion() {
    var plan;
    var state;
    noteInteraction();
    if (view !== 'today' || selectedDay !== trainingDayName()) {
      view = 'today';
      selectedDay = trainingDayName();
      selectedExercise = 0;
      trackingMode = 'ambient';
      ambientAction = 0;
      focusZone = 'ambient';
      updateDayUrl(null);
      saveUiState();
      renderContent();
    }
    plan = planFor(selectedDay);
    state = loadState();
    if (!plan.exercises || !plan.exercises.length) {
      showToast(profile.name + ' has no workout today');
      return;
    }
    if (state.completed) {
      showToast(profile.name + ' is already complete today');
      return;
    }
    remoteCompleteArmed = true;
    elements.remoteConfirmTitle.textContent = 'Complete ' + profile.name + '’s ' + plan.name + ' workout?';
    setClass(elements.remoteConfirm, 'visible', true);
  }

  function confirmRemoteCompletion() {
    if (!remoteCompleteArmed) return false;
    dismissRemoteCompletion();
    return completeWorkout('manual');
  }

  function inlineCompletionMode() {
    var userAgent = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
    return !!(window.innerWidth && window.innerWidth <= 900) ||
      /iPhone|iPad|iPod|Android|SMART-TV|SmartTV|Tizen|SamsungBrowser|Maple/i.test(userAgent);
  }

  function showCelebration(plan, state) {
    var summary = sessionSummary(plan);
    if (inlineCompletionMode()) {
      dismissCelebration();
      showToast(plan.name + ' workout complete · Saved');
      return;
    }
    elements.celebrationSource.textContent = state.completionSource === 'whoop'
      ? 'Confirmed automatically by WHOOP'
      : 'Workout complete';
    elements.celebrationTitle.textContent = plan.name.toUpperCase() + ' COMPLETE';
    elements.celebrationMeta.textContent = profile.name + ' · ' + summary.moves +
      ' movements · ' + summary.sets + ' sets';
    celebrationVisible = true;
    setClass(elements.celebration, 'visible', true);
    playChime();
    if (celebrationTimeout && window.clearTimeout) window.clearTimeout(celebrationTimeout);
    if (window.setTimeout) {
      celebrationTimeout = window.setTimeout(dismissCelebration, CELEBRATION_MS);
    }
  }

  function completeWorkout(source, workout) {
    var plan;
    var state;
    var wasComplete;
    var index;
    var exercise;
    if (selectedDay !== trainingDayName()) return false;
    dismissRemoteCompletion();
    plan = planFor(selectedDay);
    if (!plan.exercises || !plan.exercises.length) return false;
    state = loadState();
    wasComplete = !!state.completed;
    for (index = 0; index < plan.exercises.length; index += 1) {
      exercise = plan.exercises[index];
      state.sets[exercise.id] = exercise.sets;
    }
    state.completed = true;
    state.planName = plan.name;
    state.completionSource = source || 'manual';
    state.completedAt = new Date().toISOString();
    if (workout) {
      state.whoopWorkoutId = workout.id || workout.uuid || null;
      state.whoopSportName = workout.sport_name || workout.sport_id || '';
    }
    clearRestTimer();
    lastAction = null;
    trackingMode = 'ambient';
    ambientAction = 0;
    focusZone = 'ambient';
    if (!inlineCompletionMode()) {
      unlockAudio();
      requestWakeLock();
    }
    saveUiState();
    saveState(state);
    if (!wasComplete) {
      try {
        showCelebration(plan, state);
      } catch (celebrationError) {
        dismissCelebration();
        showToast(plan.name + ' workout complete · Saved');
      }
    }
    return !wasComplete;
  }

  function activateAmbientAction(index) {
    var state;
    noteInteraction();
    if (index === 1) {
      setTrackingMode('sets');
      return;
    }
    if (selectedDay !== trainingDayName()) {
      useToday();
      return;
    }
    state = loadState();
    if (state.completed) setTrackingMode('sets');
    else completeWorkout('manual');
  }

  function completeSet() {
    var plan;
    var exercise;
    var state;
    var index;
    var complete = true;
    var previousDone;
    var newDone;
    noteInteraction();
    if (view !== 'today') return;
    if (selectedDay !== trainingDayName()) {
      useToday();
      showToast('Returned to today · Preview sessions cannot change progress');
      return;
    }
    if (timerActive()) {
      clearRestTimer();
      showToast('Rest skipped · Next set ready');
      renderContent();
      return;
    }
    plan = planFor(selectedDay);
    exercise = plan.exercises && plan.exercises[selectedExercise];
    if (!exercise) return;
    state = loadState();
    previousDone = state.sets[exercise.id] || 0;
    if (previousDone >= exercise.sets) return;
    if (!inlineCompletionMode()) {
      unlockAudio();
      requestWakeLock();
    }
    lastAction = {
      exerciseId: exercise.id,
      previousDone: previousDone,
      previousCompleted: !!state.completed,
      previousSelectedExercise: selectedExercise,
      selectedDay: selectedDay
    };
    newDone = Math.min(previousDone + 1, exercise.sets);
    state.sets[exercise.id] = newDone;
    for (index = 0; index < plan.exercises.length; index += 1) {
      if ((state.sets[plan.exercises[index].id] || 0) < plan.exercises[index].sets) complete = false;
    }
    state.completed = complete;
    if (complete) {
      state.planName = plan.name;
      state.completionSource = 'sets';
      state.completedAt = new Date().toISOString();
    }
    if (newDone >= exercise.sets && selectedExercise < plan.exercises.length - 1) {
      selectedExercise += 1;
    }
    if (complete) {
      clearRestTimer();
    } else {
      startRestTimer(exercise.restSeconds, exercise.id);
    }
    saveUiState();
    saveState(state);
    if (complete) showCelebration(plan, state);
    showToast(complete
      ? 'Workout complete · Excellent work'
      : (newDone >= exercise.sets ? 'Movement complete · Advanced to next' : 'Set ' + newDone + ' complete · Back to undo'));
  }

  function removeTodayFromHistory() {
    var history = parseStoredJson(historyKey(), []);
    var filtered = [];
    var index;
    for (index = 0; index < history.length; index += 1) {
      if (history[index].date !== todayKey()) filtered.push(history[index]);
    }
    writeStorage(historyKey(), JSON.stringify(filtered));
    removeSharedCompletion(profileId, todayKey());
  }

  function undoLastSet() {
    var action = lastAction;
    var state;
    if (!action || !action.exerciseId) return false;
    selectedDay = action.selectedDay;
    selectedExercise = action.previousSelectedExercise;
    state = loadState();
    state.sets[action.exerciseId] = action.previousDone;
    state.completed = action.previousCompleted;
    if (!state.completed) {
      state.completionSource = null;
      state.completedAt = null;
      state.whoopWorkoutId = null;
      state.whoopSportName = null;
    }
    writeStorage(stateKey(), JSON.stringify(state));
    if (!state.completed) removeTodayFromHistory();
    restTimerEnd = 0;
    restTimerDuration = 0;
    restTimerExerciseId = null;
    lastAction = null;
    focusZone = 'workout';
    saveUiState();
    updateDayUrl(selectedDay);
    renderContent();
    showToast('Last set undone');
    return true;
  }

  function selectExercise(index) {
    noteInteraction();
    selectedExercise = index;
    focusZone = 'workout';
    saveUiState();
    renderContent();
  }

  function finiteNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function trendPercent(trend) {
    var percent;
    if (!trend || !finiteNumber(trend.current) || !finiteNumber(trend.baseline) || !trend.baseline) return '—';
    percent = (trend.current - trend.baseline) / trend.baseline * 100;
    return (percent >= 0 ? '+' : '') + Math.round(percent) + '%';
  }

  function metric(label, value, trend, type) {
    var extra = '';
    var difference;
    var good;
    var metricClass = label === 'Recovery' ? 'metric recovery' : 'metric';
    if (trend && finiteNumber(trend.current) && finiteNumber(trend.baseline)) {
      difference = trend.current - trend.baseline;
      good = type === 'rhr' ? difference <= 0 : difference >= 0;
      extra = '<div class="trend ' + (good ? 'up' : 'down') + '">' +
        (difference >= 0 ? '↑' : '↓') + ' ' + Math.abs(Math.round(difference)) + ' vs avg</div>';
    }
    return '<div class="' + metricClass + '"><span class="metric-label">' + label +
      '</span><b>' + (value === null || typeof value === 'undefined' ? '—' : value) +
      '</b>' + extra + '</div>';
  }

  function strengthWorkout(workout) {
    var name = String(workout && (workout.sport_name || workout.sport_id) || '').toLowerCase();
    var strengthNames = [
      'weightlifting', 'weight lifting', 'strength', 'powerlifting',
      'functional fitness', 'crossfit', 'bodybuilding', 'barre', 'pilates'
    ];
    var index;
    for (index = 0; index < strengthNames.length; index += 1) {
      if (name.indexOf(strengthNames[index]) >= 0) return true;
    }
    return false;
  }

  function currentTrainingWindow() {
    var now = new Date();
    var start = new Date(now.getTime());
    var end;
    start.setHours(TRAINING_DAY_START_HOUR, 0, 0, 0);
    if (now.getTime() < start.getTime()) start.setDate(start.getDate() - 1);
    end = new Date(start.getTime());
    end.setDate(end.getDate() + 1);
    return { start: start, end: end };
  }

  function eligibleWhoopWorkout(workout) {
    var start;
    var end;
    var duration;
    var windowRange = currentTrainingWindow();
    if (!strengthWorkout(workout)) return false;
    start = new Date(workout.start || workout.created_at || 0);
    end = new Date(workout.end || workout.updated_at || 0);
    if (!isFinite(start.getTime()) || !isFinite(end.getTime())) return false;
    duration = end.getTime() - start.getTime();
    if (duration < 10 * 60 * 1000) return false;
    return end.getTime() >= windowRange.start.getTime() &&
      end.getTime() < windowRange.end.getTime() &&
      end.getTime() <= new Date().getTime();
  }

  function applyWhoopWorkoutCompletion(targetProfileId, response) {
    var workouts;
    var plan;
    var state;
    var matching = null;
    var index;
    var exercise;
    plan = profilePlan(targetProfileId, trainingDayName());
    if (!plan.exercises || !plan.exercises.length) return;
    state = profileState(targetProfileId);
    if (state.completed) return;
    workouts = response && response.workouts ? response.workouts : [];
    for (index = 0; index < workouts.length; index += 1) {
      if (eligibleWhoopWorkout(workouts[index])) {
        if (!matching || new Date(workouts[index].end).getTime() > new Date(matching.end).getTime()) {
          matching = workouts[index];
        }
      }
    }
    if (!matching) return;
    if (!state.sets) state.sets = {};
    for (index = 0; index < plan.exercises.length; index += 1) {
      exercise = plan.exercises[index];
      state.sets[exercise.id] = exercise.sets;
    }
    state.completed = true;
    state.planName = plan.name;
    state.completionSource = 'whoop';
    state.completedAt = new Date().toISOString();
    state.whoopWorkoutId = matching.id || matching.uuid || null;
    state.whoopSportName = matching.sport_name || matching.sport_id || '';
    saveProfileState(targetProfileId, state);
    if (targetProfileId === profileId && selectedDay === trainingDayName()) {
      clearRestTimer();
      lastAction = null;
      trackingMode = 'ambient';
      ambientAction = 0;
      focusZone = 'ambient';
      saveUiState();
      showCelebration(plan, state);
    }
  }

  function updateWhoopFreshness() {
    var minutes;
    var updatedAt = whoopUpdatedAtByProfile[profileId];
    if (view === 'progress') {
      elements.whoopLive.textContent = 'HOUSEHOLD WHOOP · LIVE';
      return;
    }
    if (!updatedAt) return;
    minutes = Math.max(0, Math.floor((new Date().getTime() - updatedAt) / 60000));
    elements.whoopLive.textContent = profile.name.toUpperCase() + ' WHOOP · ' +
      (minutes < 1 ? 'JUST UPDATED' : minutes + 'M AGO');
  }

  function scheduleWhoopRetry(targetProfileId) {
    if (whoopRetryTimeoutByProfile[targetProfileId] || !window.setTimeout) return;
    whoopRetryTimeoutByProfile[targetProfileId] = window.setTimeout(function () {
      whoopRetryTimeoutByProfile[targetProfileId] = null;
      loadWhoop(targetProfileId);
    }, WHOOP_RETRY_MS);
  }

  function renderWhoopMetrics(targetProfileId, response) {
    var recovery;
    var cycle;
    var sleep;
    var trends;
    if (targetProfileId === profileId) whoopData = response;
    if (view === 'progress') {
      renderContent();
      return;
    }
    if (targetProfileId !== profileId) return;
    recovery = response.recovery && response.recovery.score ? response.recovery.score : {};
    cycle = response.cycle && response.cycle.score ? response.cycle.score : {};
    sleep = response.sleep && response.sleep.score ? response.sleep.score : {};
    trends = response.trends || {};
    elements.whoop.className = 'whoop';
    elements.whoop.innerHTML =
      metric('Recovery', recovery.recovery_score != null ? recovery.recovery_score + '%' : '—', trends.recovery) +
      metric('HRV', recovery.hrv_rmssd_milli != null ? Math.round(recovery.hrv_rmssd_milli) + ' ms' : '—', trends.hrv) +
      metric('Resting HR', recovery.resting_heart_rate != null ? recovery.resting_heart_rate + ' bpm' : '—', trends.restingHr, 'rhr') +
      metric('Day Strain', cycle.strain != null ? Number(cycle.strain).toFixed(1) : '—', trends.strain) +
      metric('Sleep', sleep.sleep_performance_percentage != null ? sleep.sleep_performance_percentage + '%' : '—', trends.sleep);
    updateWhoopFreshness();
    renderContent();
  }

  function loadWhoop(targetProfileId) {
    var target = targetProfileId || profileId;
    var targetName = data.profiles[target] ? data.profiles[target].name : target;
    requestJson('/api/whoop-data?profile=' + encodeURIComponent(target) +
      '&time=' + new Date().getTime(), function (error, response, status) {
      if (error) {
        scheduleWhoopRetry(target);
        if (view === 'progress') {
          if (status === 401) {
            whoopDataByProfile[target] = null;
            whoopUpdatedAtByProfile[target] = 0;
          }
          renderContent();
          return;
        }
        if (target !== profileId) return;
        if (status === 401) {
          whoopData = null;
          whoopDataByProfile[target] = null;
          whoopUpdatedAtByProfile[target] = 0;
          elements.whoop.className = 'status reconnect';
          elements.whoopLive.textContent = targetName.toUpperCase() + ' WHOOP · CONNECT';
          elements.whoop.innerHTML = '<img class="whoop-qr" src="/api/whoop-qr?profile=' + target +
            '" alt="' + targetName + ' WHOOP connection QR code">' +
            '<div class="status-copy"><b>Connect ' + targetName + ' WHOOP from ' +
            (target === 'kelsey' ? 'her' : 'your') + ' phone</b>' +
            '<span>Scan once and approve WHOOP. The TV will update automatically.</span></div>';
        } else if (whoopData) {
          elements.whoopLive.textContent = targetName.toUpperCase() + ' WHOOP · RETRYING';
        } else {
          elements.whoop.className = 'status';
          elements.whoopLive.textContent = targetName.toUpperCase() + ' WHOOP · RETRYING';
          elements.whoop.innerHTML = '<div class="status-copy"><b>' + targetName +
            ' WHOOP is temporarily unavailable</b>' +
            '<span>No action needed. Retrying automatically.</span></div>';
        }
        return;
      }
      if (whoopRetryTimeoutByProfile[target] && window.clearTimeout) {
        window.clearTimeout(whoopRetryTimeoutByProfile[target]);
      }
      whoopRetryTimeoutByProfile[target] = null;
      whoopDataByProfile[target] = response;
      whoopUpdatedAtByProfile[target] = new Date().getTime();
      renderWhoopMetrics(target, response);
      applyWhoopWorkoutCompletion(target, response);
      loadWorkoutHistory();
    });
  }

  function loadAllWhoop() {
    loadWhoop('jordan');
    loadWhoop('kelsey');
  }

  function setView(newView) {
    noteInteraction();
    dismissRemoteCompletion();
    view = newView === 'progress' ? 'progress' : 'today';
    focusZone = 'toolbar';
    toolbarIndex = view === 'progress' ? 2 : (profileId === 'jordan' ? 0 : 1);
    saveUiState();
    renderContent();
  }

  function moveToolbar(amount) {
    toolbarIndex = (toolbarIndex + amount + toolbarElements.length) % toolbarElements.length;
    saveUiState();
    applyToolbarFocus();
  }

  function activateToolbar() {
    if (toolbarIndex === 0) setProfile('jordan');
    else if (toolbarIndex === 1) setProfile('kelsey');
    else setView('progress');
  }

  function enterContentFocus() {
    var plan;
    if (view !== 'today') return;
    plan = planFor(selectedDay);
    focusZone = plan.exercises && plan.exercises.length
      ? (trackingMode === 'sets' ? 'workout' : 'ambient')
      : 'day';
    saveUiState();
    renderContent();
  }

  function updateDayUrl(day) {
    var target = location.pathname;
    if (window.history && history.replaceState) history.replaceState({}, '', target);
  }

  function setDay(day) {
    noteInteraction();
    selectedDay = day;
    selectedExercise = 0;
    trackingMode = 'ambient';
    ambientAction = 0;
    focusZone = planFor(day).exercises && planFor(day).exercises.length ? 'ambient' : 'day';
    updateDayUrl(day);
    saveUiState();
    renderContent();
  }

  function changeDay(amount) {
    var index = days.indexOf(selectedDay);
    noteInteraction();
    setDay(days[(index + amount + 7) % 7]);
  }

  function useToday() {
    noteInteraction();
    selectedDay = trainingDayName();
    selectedExercise = 0;
    trackingMode = 'ambient';
    ambientAction = 0;
    focusZone = planFor(selectedDay).exercises && planFor(selectedDay).exercises.length ? 'ambient' : 'day';
    updateDayUrl(null);
    saveUiState();
    renderContent();
  }

  function renderAll() {
    updateClock();
    renderContent();
  }

  function checkTrainingDayReset() {
    var key = todayKey();
    if (!activeTrainingDateKey) {
      activeTrainingDateKey = key;
      return;
    }
    if (key === activeTrainingDateKey) return;
    activeTrainingDateKey = key;
    selectedDay = trainingDayName();
    selectedExercise = 0;
    trackingMode = 'ambient';
    ambientAction = 0;
    view = 'today';
    focusZone = planFor(selectedDay).exercises && planFor(selectedDay).exercises.length ? 'ambient' : 'day';
    restTimerEnd = 0;
    restTimerDuration = 0;
    restTimerExerciseId = null;
    lastAction = null;
    dismissCelebration();
    updateDayUrl(null);
    saveUiState();
    renderAll();
    livePlanRevision = -1;
    loadWorkoutPlan();
    loadWorkoutHistory();
    loadAllWhoop();
  }

  function init() {
    requestJson('/workouts.json?time=' + new Date().getTime(), function (error, response) {
      var restoredPlan;
      if (error) {
        elements.whoop.textContent = 'Startup error';
        elements.content.textContent = 'Workout program unavailable: ' + error;
        return;
      }
      baseData = response;
      data = cloneJson(baseData);
      applyAccessoryRotation(trainingDate());
      if (!data.profiles || !data.profiles[profileId]) profileId = 'jordan';
      profile = data.profiles[profileId];
      activeTrainingDateKey = todayKey();
      restoreUiState();
      restoredPlan = planFor(selectedDay);
      if (view === 'progress') {
        focusZone = 'toolbar';
        toolbarIndex = 2;
      } else if ((!restoredPlan.exercises || !restoredPlan.exercises.length) &&
          (focusZone === 'workout' || focusZone === 'ambient')) {
        focusZone = 'day';
      } else if (restoredPlan.exercises && restoredPlan.exercises.length &&
          focusZone !== 'toolbar') {
        focusZone = trackingMode === 'sets' ? 'workout' : 'ambient';
      }
      renderAll();
      loadWorkoutPlan();
      loadWorkoutHistory(true);
      loadDailySteps();
      updateRestTimer();
      loadAllWhoop();
      window.setInterval(loadAllWhoop, WHOOP_POLL_MS);
      window.setInterval(loadWorkoutPlan, PLAN_POLL_MS);
      window.setInterval(loadWorkoutHistory, PLAN_POLL_MS);
      window.setInterval(loadDailySteps, STEPS_POLL_MS);
      window.setInterval(runTvAutopilot, AUTOPILOT_POLL_MS);
      window.setInterval(updateClock, 30 * 1000);
      window.setInterval(checkTrainingDayReset, 30 * 1000);
      window.setInterval(updateRestTimer, 1000);
      window.setInterval(driftScreen, DRIFT_STEP_MS);
    });
  }

  window.setProfile = setProfile;
  window.setView = setView;
  window.setDay = setDay;
  window.changeDay = changeDay;
  window.useToday = useToday;
  window.renderContent = renderContent;
  window.completeSet = completeSet;
  window.completeWorkout = completeWorkout;
  window.activateAmbientAction = activateAmbientAction;
  window.setTrackingMode = setTrackingMode;
  window.dismissCelebration = dismissCelebration;
  window.dismissRemoteCompletion = dismissRemoteCompletion;
  window.armRemoteCompletion = armRemoteCompletion;
  window.confirmRemoteCompletion = confirmRemoteCompletion;
  window.undoLastSet = undoLastSet;
  window.selectExercise = selectExercise;
  window.loadWorkoutPlan = loadWorkoutPlan;
  window.loadWorkoutHistory = loadWorkoutHistory;
  window.runTvAutopilot = runTvAutopilot;
  window.driftScreen = driftScreen;

  function isBackKey(event) {
    return event.key === 'Escape' || event.key === 'Backspace' ||
      event.keyCode === 8 || event.keyCode === 27 || event.keyCode === 10009;
  }

  function consumeRemoteEvent(event) {
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    event.returnValue = false;
  }

  function isRemoteShortcut(event, key, keyCode, colorName, colorCode) {
    return event.key === key || event.keyCode === keyCode ||
      event.key === colorName || event.keyCode === colorCode;
  }

  if (document.addEventListener) {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refreshDashboardData();
    });
    document.addEventListener('keydown', function (event) {
      var items;
      noteInteraction();
      if (isBackKey(event)) {
        if (remoteCompleteArmed) {
          dismissRemoteCompletion();
          consumeRemoteEvent(event);
          return;
        }
        if (celebrationVisible) {
          dismissCelebration();
          consumeRemoteEvent(event);
          return;
        }
        if (lastAction && undoLastSet()) {
          consumeRemoteEvent(event);
          return;
        }
        if (trackingMode === 'sets' && focusZone === 'workout') {
          setTrackingMode('ambient');
          consumeRemoteEvent(event);
          return;
        }
        if (focusZone === 'toolbar') {
          consumeRemoteEvent(event);
          enterContentFocus();
        }
        return;
      }
      if (remoteCompleteArmed) {
        if (event.key === 'Enter' || event.keyCode === 13 ||
            isRemoteShortcut(event, '0', 48, 'ColorF3Blue', 406)) {
          confirmRemoteCompletion();
        }
        consumeRemoteEvent(event);
        return;
      }
      if (isRemoteShortcut(event, '1', 49, 'ColorF0Red', 403)) {
        consumeRemoteEvent(event);
        setProfile('jordan');
        return;
      }
      if (isRemoteShortcut(event, '2', 50, 'ColorF1Green', 404)) {
        consumeRemoteEvent(event);
        setProfile('kelsey');
        return;
      }
      if (isRemoteShortcut(event, '3', 51, 'ColorF2Yellow', 405)) {
        consumeRemoteEvent(event);
        setView('progress');
        return;
      }
      if (isRemoteShortcut(event, '0', 48, 'ColorF3Blue', 406)) {
        consumeRemoteEvent(event);
        armRemoteCompletion();
        return;
      }
      if (trackingMode !== 'sets' || view !== 'today') {
        if (event.key === 'ArrowLeft' || event.keyCode === 37) {
          consumeRemoteEvent(event);
          setProfile('jordan');
          return;
        }
        if (event.key === 'ArrowRight' || event.keyCode === 39) {
          consumeRemoteEvent(event);
          setProfile('kelsey');
          return;
        }
        if (event.key === 'ArrowUp' || event.keyCode === 38) {
          consumeRemoteEvent(event);
          setView('progress');
          return;
        }
        if (event.key === 'ArrowDown' || event.keyCode === 40) {
          consumeRemoteEvent(event);
          armRemoteCompletion();
          return;
        }
        if (event.key === 'Enter' || event.keyCode === 13) {
          consumeRemoteEvent(event);
          return;
        }
      }
      if (event.key === 'ArrowLeft' || event.keyCode === 37) {
        consumeRemoteEvent(event);
        if (focusZone === 'toolbar') moveToolbar(-1);
        else changeDay(-1);
        return;
      }
      if (event.key === 'ArrowRight' || event.keyCode === 39) {
        consumeRemoteEvent(event);
        if (focusZone === 'toolbar') moveToolbar(1);
        else changeDay(1);
        return;
      }
      if (event.key === 'ArrowDown' || event.keyCode === 40) {
        consumeRemoteEvent(event);
        if (focusZone === 'toolbar') {
          enterContentFocus();
          return;
        }
        if (view !== 'today' || focusZone === 'day') return;
        if (focusZone === 'ambient') {
          if (!loadState().completed) ambientAction = ambientAction === 0 ? 1 : 0;
          saveUiState();
          renderContent();
          return;
        }
        items = planFor(selectedDay).exercises || [];
        selectedExercise = Math.min(selectedExercise + 1, Math.max(items.length - 1, 0));
        saveUiState();
        renderContent();
        return;
      }
      if (event.key === 'ArrowUp' || event.keyCode === 38) {
        consumeRemoteEvent(event);
        if (focusZone === 'toolbar') return;
        if (view !== 'today' || focusZone === 'day' || focusZone === 'ambient') {
          focusZone = 'toolbar';
          toolbarIndex = view === 'progress' ? 2 : (profileId === 'jordan' ? 0 : 1);
          saveUiState();
          renderContent();
          return;
        }
        items = planFor(selectedDay).exercises || [];
        if (selectedExercise > 0) {
          selectedExercise -= 1;
        } else {
          focusZone = 'toolbar';
          toolbarIndex = profileId === 'jordan' ? 0 : 1;
        }
        saveUiState();
        renderContent();
        return;
      }
      if (event.key === 'Enter' || event.keyCode === 13) {
        consumeRemoteEvent(event);
        if (celebrationVisible) {
          dismissCelebration();
          return;
        }
        if (focusZone === 'toolbar') activateToolbar();
        else if (focusZone === 'workout') completeSet();
        else if (focusZone === 'ambient') activateAmbientAction(ambientAction);
      }
    }, true);
  }

  if (window.addEventListener) {
    window.addEventListener('focus', refreshDashboardData);
  }

  init();
})();
