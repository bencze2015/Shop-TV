(function () {
  var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var weekOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var realNow = new Date();
  var requestedDay = queryValue('day');
  var selectedDay = requestedDay;
  var data = { profiles: {} };
  var profileId = readStorage('shopProfile') || 'jordan';
  var profile = { name: 'Jordan', week: {} };
  var whoopData = null;
  var view = 'today';
  var selectedExercise = 0;
  var focusZone = 'workout';
  var toolbarIndex = 2;
  var restTimerEnd = 0;
  var restTimerDuration = 0;
  var restTimerExerciseId = null;
  var lastAction = null;
  var audioContext = null;
  var wakeLock = null;
  var toastTimeout = null;
  var WHOOP_AUTH = '/api/whoop-connect';

  var elements = {
    planName: byId('planName'),
    hello: byId('hello'),
    date: byId('date'),
    clock: byId('clock'),
    preview: byId('preview'),
    jordanBtn: byId('jordanBtn'),
    kelseyBtn: byId('kelseyBtn'),
    whoopLive: byId('whoopLive'),
    todayTab: byId('todayTab'),
    progressTab: byId('progressTab'),
    whoop: byId('whoop'),
    content: byId('content'),
    controlHint: byId('controlHint'),
    toast: byId('toast')
  };
  var toolbarElements = [elements.jordanBtn, elements.kelseyBtn, elements.todayTab, elements.progressTab];

  if (days.indexOf(selectedDay) < 0) selectedDay = days[realNow.getDay()];

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

  function todayKey() {
    return dateKey(realNow);
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
    if (days.indexOf(requestedDay) < 0 && days.indexOf(saved.selectedDay) >= 0) {
      selectedDay = saved.selectedDay;
    }
    if (typeof saved.selectedExercise === 'number' && saved.selectedExercise >= 0) {
      selectedExercise = saved.selectedExercise;
    }
    if (saved.view === 'today' || saved.view === 'progress') view = saved.view;
    if (saved.focusZone === 'workout' || saved.focusZone === 'day' || saved.focusZone === 'toolbar') {
      focusZone = saved.focusZone;
    }
    if (typeof saved.toolbarIndex === 'number' && saved.toolbarIndex >= 0 && saved.toolbarIndex < 4) {
      toolbarIndex = saved.toolbarIndex;
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

  function loadState() {
    return parseStoredJson(stateKey(), { sets: {}, completed: false });
  }

  function saveState(state) {
    var history;
    var plan;
    var found;
    var index;
    writeStorage(stateKey(), JSON.stringify(state));
    if (state.completed) {
      history = parseStoredJson(historyKey(), []);
      found = false;
      for (index = 0; index < history.length; index += 1) {
        if (history[index].date === todayKey()) found = true;
      }
      if (!found) {
        plan = planFor(days[realNow.getDay()]);
        history.unshift({ date: todayKey(), name: plan.name });
        writeStorage(historyKey(), JSON.stringify(history.slice(0, 60)));
      }
    }
    renderContent();
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
    var now = new Date();
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

  function setProfile(id) {
    if (!data.profiles[id]) return;
    saveUiState();
    profileId = id;
    profile = data.profiles[id];
    writeStorage('shopProfile', id);
    selectedExercise = 0;
    view = 'today';
    restTimerEnd = 0;
    restTimerDuration = 0;
    restTimerExerciseId = null;
    lastAction = null;
    restoreUiState();
    focusZone = 'toolbar';
    toolbarIndex = id === 'jordan' ? 0 : 1;
    whoopData = null;
    renderAll();
    loadWhoop();
  }

  function updateClock() {
    var now = new Date();
    var hours = now.getHours();
    var minutes = pad2(now.getMinutes());
    var suffix = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    elements.clock.textContent = hours + ':' + minutes + ' ' + suffix;
  }

  function applyToolbarFocus() {
    var index;
    for (index = 0; index < toolbarElements.length; index += 1) {
      setClass(toolbarElements[index], 'remote-focus', focusZone === 'toolbar' && index === toolbarIndex);
    }
  }

  function renderHeader() {
    var plan = planFor(selectedDay);
    var isToday = selectedDay === days[realNow.getDay()];
    elements.hello.textContent = 'HELLO, ' + profile.name.toUpperCase();
    elements.planName.textContent = plan.name.toUpperCase();
    setClass(elements.jordanBtn, 'active', profileId === 'jordan');
    setClass(elements.kelseyBtn, 'active', profileId === 'kelsey');
    setClass(elements.preview, 'visible', !isToday);
    applyToolbarFocus();
    elements.date.textContent = isToday
      ? realNow.toLocaleDateString('en-US', {
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
      html += '<div class="week-day ' +
        (day === selectedDay ? 'selected ' : '') +
        (focusZone === 'day' && day === selectedDay ? 'remote-focus ' : '') +
        (plan.exercises && plan.exercises.length ? 'training' : '') +
        '" onclick="setDay(\'' + day + '\')">' +
        '<span>' + day.slice(0, 3) + '</span><b>' +
        (plan.exercises && plan.exercises.length ? plan.name : 'Rest') +
        '</b></div>';
    }
    return html + '</div>';
  }

  function renderTraining(plan) {
    var state = loadState();
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
      rows += '<div class="' + className + '" onclick="selectExercise(' + index + ')">' +
        '<span class="exercise-num">' + pad2(index + 1) + '</span>' +
        '<div class="exercise-main"><div class="exercise-name">' + exercise.name + '</div>' +
        '<div class="exercise-meta">' + exercise.reps + ' reps · ' +
        exercise.restSeconds + 's rest</div></div>' +
        '<div class="set-dots">' + setDots(done, exercise.sets) + '</div>' +
        '<div class="set-count">' + done + '/' + exercise.sets + '</div></div>';
    }

    elements.content.innerHTML =
      '<div class="view training-view">' +
      '<div class="view-head"><div><div class="view-label">Today’s session</div>' +
      '<div class="view-title">' + plan.name.toUpperCase() + ' SESSION</div>' +
      '<div class="view-subtitle">Move with intent. Finish every clean rep.</div></div>' +
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

  function renderProgress() {
    var stats = weekStats();
    var percent = stats.scheduled ? Math.round(stats.completed / stats.scheduled * 100) : 100;
    var history = parseStoredJson(historyKey(), []);
    var trends = whoopData && whoopData.trends ? whoopData.trends : {};
    var historyHtml = '';
    var index;
    for (index = 0; index < history.length && index < 5; index += 1) {
      historyHtml += '<div class="history-row"><strong>' + history[index].name +
        '</strong><span>' + history[index].date + '</span></div>';
    }
    if (!historyHtml) {
      historyHtml = '<div class="empty">Complete a workout to begin your training history.</div>';
    }
    elements.content.innerHTML =
      '<div class="view progress-view">' +
      '<div class="view-head"><div><div class="view-label">' + profile.name + ' · This week</div>' +
      '<div class="view-title">TRAINING OVERVIEW</div>' +
      '<div class="view-subtitle">Consistency and recovery, without the noise.</div></div></div>' +
      '<div class="progress-layout"><div class="progress-kpis">' +
      '<div class="kpi"><div class="card-label">Weekly completion</div>' +
      '<div class="kpi-value">' + percent + '%</div><div class="bar"><i style="width:' +
      percent + '%"></i></div></div>' +
      '<div class="kpi"><div class="card-label">HRV vs baseline</div><div class="kpi-value">' +
      trendPercent(trends.hrv) + '</div></div>' +
      '<div class="kpi"><div class="card-label">Recovery vs baseline</div><div class="kpi-value">' +
      trendPercent(trends.recovery) + '</div></div></div>' +
      '<div class="history-panel"><div class="card-label">Recent sessions</div>' +
      '<div class="history">' + historyHtml + '</div></div></div></div>';
    elements.controlHint.innerHTML =
      '<span class="key">← →</span> Choose menu <span class="key">Enter</span> Open';
  }

  function renderContent() {
    var plan;
    renderHeader();
    setClass(elements.todayTab, 'active', view === 'today');
    setClass(elements.progressTab, 'active', view === 'progress');
    if (view === 'progress') {
      renderProgress();
      return;
    }
    plan = planFor(selectedDay);
    if (plan.exercises && plan.exercises.length) {
      renderTraining(plan);
    } else {
      renderRest();
    }
  }

  function completeSet() {
    var plan;
    var exercise;
    var state;
    var index;
    var complete = true;
    var previousDone;
    var newDone;
    if (view !== 'today') return;
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
    unlockAudio();
    requestWakeLock();
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

  function loadWhoop() {
    if (profileId === 'kelsey') {
      elements.whoop.className = 'status';
      elements.whoop.innerHTML = 'Kelsey WHOOP is not connected yet. Workout tracking remains available.';
      elements.whoopLive.textContent = 'WHOOP OFFLINE';
      return;
    }
    requestJson('/api/whoop-data?time=' + new Date().getTime(), function (error, response, status) {
      var recovery;
      var cycle;
      var sleep;
      var trends;
      if (error) {
        elements.whoop.className = 'status';
        elements.whoopLive.textContent = 'WHOOP OFFLINE';
        elements.whoop.innerHTML = status === 401
          ? 'WHOOP needs one authorization from a phone or computer.' +
            '<button class="connect" onclick="location.href=\'' + WHOOP_AUTH + '\'">Connect WHOOP</button>'
          : 'WHOOP data unavailable: ' + error;
        return;
      }
      whoopData = response;
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
      elements.whoopLive.textContent = 'WHOOP LIVE';
      renderContent();
    });
  }

  function setView(newView) {
    view = newView;
    focusZone = 'toolbar';
    toolbarIndex = newView === 'progress' ? 3 : 2;
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
    else if (toolbarIndex === 2) setView('today');
    else setView('progress');
  }

  function enterContentFocus() {
    var plan;
    if (view !== 'today') return;
    plan = planFor(selectedDay);
    focusZone = plan.exercises && plan.exercises.length ? 'workout' : 'day';
    saveUiState();
    renderContent();
  }

  function updateDayUrl(day) {
    var target = location.pathname + (day ? '?day=' + encodeURIComponent(day) : '');
    if (window.history && history.replaceState) history.replaceState({}, '', target);
  }

  function setDay(day) {
    selectedDay = day;
    selectedExercise = 0;
    focusZone = planFor(day).exercises && planFor(day).exercises.length ? 'workout' : 'day';
    updateDayUrl(day);
    saveUiState();
    renderContent();
  }

  function changeDay(amount) {
    var index = days.indexOf(selectedDay);
    setDay(days[(index + amount + 7) % 7]);
  }

  function useToday() {
    selectedDay = days[realNow.getDay()];
    selectedExercise = 0;
    focusZone = planFor(selectedDay).exercises && planFor(selectedDay).exercises.length ? 'workout' : 'day';
    updateDayUrl(null);
    saveUiState();
    renderContent();
  }

  function renderAll() {
    updateClock();
    renderContent();
  }

  function init() {
    requestJson('/workouts.json?time=' + new Date().getTime(), function (error, response) {
      var restoredPlan;
      if (error) {
        elements.whoop.textContent = 'Startup error';
        elements.content.textContent = 'Workout program unavailable: ' + error;
        return;
      }
      data = response;
      if (!data.profiles || !data.profiles[profileId]) profileId = 'jordan';
      profile = data.profiles[profileId];
      restoreUiState();
      restoredPlan = planFor(selectedDay);
      if (view === 'progress') {
        focusZone = 'toolbar';
        toolbarIndex = 3;
      } else if ((!restoredPlan.exercises || !restoredPlan.exercises.length) && focusZone === 'workout') {
        focusZone = 'day';
      }
      renderAll();
      updateRestTimer();
      loadWhoop();
      window.setInterval(loadWhoop, 15 * 60 * 1000);
      window.setInterval(updateClock, 30 * 1000);
      window.setInterval(updateRestTimer, 1000);
    });
  }

  window.setProfile = setProfile;
  window.setView = setView;
  window.setDay = setDay;
  window.changeDay = changeDay;
  window.useToday = useToday;
  window.renderContent = renderContent;
  window.completeSet = completeSet;
  window.undoLastSet = undoLastSet;
  window.selectExercise = selectExercise;

  function isBackKey(event) {
    return event.key === 'Escape' || event.key === 'Backspace' ||
      event.keyCode === 8 || event.keyCode === 27 || event.keyCode === 10009;
  }

  if (document.addEventListener) {
    document.addEventListener('keydown', function (event) {
      var items;
      if (isBackKey(event)) {
        if (lastAction && undoLastSet()) {
          event.preventDefault();
          return;
        }
        if (focusZone === 'toolbar') {
          event.preventDefault();
          enterContentFocus();
        }
        return;
      }
      if (event.key === 'ArrowLeft' || event.keyCode === 37) {
        event.preventDefault();
        if (focusZone === 'toolbar') moveToolbar(-1);
        else changeDay(-1);
        return;
      }
      if (event.key === 'ArrowRight' || event.keyCode === 39) {
        event.preventDefault();
        if (focusZone === 'toolbar') moveToolbar(1);
        else changeDay(1);
        return;
      }
      if (event.key === 'ArrowDown' || event.keyCode === 40) {
        event.preventDefault();
        if (focusZone === 'toolbar') {
          enterContentFocus();
          return;
        }
        if (view !== 'today' || focusZone === 'day') return;
        items = planFor(selectedDay).exercises || [];
        selectedExercise = Math.min(selectedExercise + 1, Math.max(items.length - 1, 0));
        saveUiState();
        renderContent();
        return;
      }
      if (event.key === 'ArrowUp' || event.keyCode === 38) {
        event.preventDefault();
        if (focusZone === 'toolbar') return;
        if (view !== 'today' || focusZone === 'day') {
          focusZone = 'toolbar';
          toolbarIndex = view === 'progress' ? 3 : 2;
          saveUiState();
          renderContent();
          return;
        }
        items = planFor(selectedDay).exercises || [];
        if (selectedExercise > 0) {
          selectedExercise -= 1;
        } else {
          focusZone = 'toolbar';
          toolbarIndex = 2;
        }
        saveUiState();
        renderContent();
        return;
      }
      if (event.key === 'Enter' || event.keyCode === 13) {
        event.preventDefault();
        if (focusZone === 'toolbar') activateToolbar();
        else if (focusZone === 'workout') completeSet();
      }
    });
  }

  init();
})();
