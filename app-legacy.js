(function () {
  var supportsModernSyntax = false;
  try {
    supportsModernSyntax = new Function(
      'var value={nested:{ok:true}};return value?.nested?.ok??false;'
    )();
  } catch (syntaxError) {
    supportsModernSyntax = false;
  }
  if (supportsModernSyntax) return;

  var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var realNow = new Date();
  var selectedDay = queryValue('day');
  var data = { profiles: {} };
  var profileId = readStorage('shopProfile') || 'jordan';
  var profile = { name: 'Jordan', week: {} };
  var whoopData = null;
  var view = 'today';
  var selectedExercise = 0;
  var WHOOP_AUTH = '/api/whoop-connect';

  var elements = {
    programName: byId('programName'),
    hello: byId('hello'),
    date: byId('date'),
    jordanBtn: byId('jordanBtn'),
    kelseyBtn: byId('kelseyBtn'),
    whoopLive: byId('whoopLive'),
    todayTab: byId('todayTab'),
    progressTab: byId('progressTab'),
    whoop: byId('whoop'),
    content: byId('content'),
    preview: byId('preview')
  };

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

  function dateKey(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function pad2(value) {
    return value < 10 ? '0' + value : String(value);
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

  function nextWorkout() {
    var start = days.indexOf(selectedDay);
    var offset;
    var day;
    var plan;
    for (offset = 1; offset <= 7; offset += 1) {
      day = days[(start + offset) % 7];
      plan = planFor(day);
      if (plan.exercises && plan.exercises.length) return { day: day, name: plan.name };
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
    profileId = id;
    profile = data.profiles[id];
    writeStorage('shopProfile', id);
    selectedExercise = 0;
    whoopData = null;
    renderAll();
    loadWhoop();
  }

  function renderHeader() {
    var isToday = selectedDay === days[realNow.getDay()];
    elements.hello.textContent = 'HELLO, ' + profile.name.toUpperCase();
    elements.programName.textContent =
      (data.programName || 'Shop Training') + ' · ' + (planFor(selectedDay).name || 'Rest');
    setClass(elements.jordanBtn, 'active', profileId === 'jordan');
    setClass(elements.kelseyBtn, 'active', profileId === 'kelsey');
    elements.date.textContent = isToday
      ? realNow.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        })
      : selectedDay + ' — PREVIEW';
    elements.preview.textContent = isToday ? '' : 'TEST MODE';
  }

  function renderContent() {
    var plan;
    var items;
    var next;
    var stats;
    var percent;
    var state;
    var itemHtml;
    var index;
    var exercise;
    var done;
    renderHeader();
    setClass(elements.todayTab, 'active', view === 'today');
    setClass(elements.progressTab, 'active', view === 'progress');
    if (view === 'progress') {
      renderProgress();
      return;
    }
    plan = planFor(selectedDay);
    items = plan.exercises || [];
    if (!items.length) {
      next = nextWorkout();
      stats = weekStats();
      percent = stats.scheduled ? Math.round(stats.completed / stats.scheduled * 100) : 100;
      elements.content.innerHTML =
        '<div class="workout-label">Today’s Plan</div>' +
        '<div class="rest">REST DAY</div>' +
        '<div class="rest-sub">Recover. Reset. Come back ready.</div>' +
        '<div class="idle-grid"><div class="panel"><div class="panel-label">Next Workout</div>' +
        '<div class="panel-value">' + (next ? next.day + ' · ' + next.name : 'None') + '</div></div>' +
        '<div class="panel"><div class="panel-label">This Week</div>' +
        '<div class="panel-value">' + stats.completed + '/' + stats.scheduled + '</div>' +
        '<div class="bar"><i style="width:' + percent + '%"></i></div></div></div>';
      return;
    }
    state = loadState();
    itemHtml = '';
    for (index = 0; index < items.length; index += 1) {
      exercise = items[index];
      done = Math.min(state.sets[exercise.id] || 0, exercise.sets);
      itemHtml +=
        '<div class="exercise ' + (index === selectedExercise ? 'selected' : '') +
        '" onclick="selectExercise(' + index + ')">' +
        '<span class="exercise-num">' + pad2(index + 1) + '</span><div>' +
        '<div class="exercise-name">' + exercise.name + '</div>' +
        '<div class="exercise-meta">' + exercise.sets + ' × ' + exercise.reps + ' · ' +
        exercise.restSeconds + 's rest</div></div>' +
        '<div class="set-count ' + (done >= exercise.sets ? 'done' : '') + '">' +
        done + '/' + exercise.sets + '</div></div>';
    }
    elements.content.innerHTML =
      '<div class="workout-label">' + plan.name + '</div>' +
      '<div class="title">TRAINING DAY</div><div class="exercise-list">' + itemHtml + '</div>' +
      '<div class="controls"><span class="kbd">↑ ↓</span> Select ' +
      '<span class="kbd">ENTER</span> Complete set</div>';
  }

  function completeSet() {
    var plan;
    var exercise;
    var state;
    var index;
    var complete = true;
    if (view !== 'today') return;
    plan = planFor(selectedDay);
    exercise = plan.exercises && plan.exercises[selectedExercise];
    if (!exercise) return;
    state = loadState();
    state.sets[exercise.id] = Math.min((state.sets[exercise.id] || 0) + 1, exercise.sets);
    for (index = 0; index < plan.exercises.length; index += 1) {
      if ((state.sets[plan.exercises[index].id] || 0) < plan.exercises[index].sets) complete = false;
    }
    state.completed = complete;
    saveState(state);
  }

  function selectExercise(index) {
    selectedExercise = index;
    renderContent();
  }

  function renderProgress() {
    var stats = weekStats();
    var percent = stats.scheduled ? Math.round(stats.completed / stats.scheduled * 100) : 100;
    var history = parseStoredJson(historyKey(), []);
    var trends = whoopData && whoopData.trends ? whoopData.trends : {};
    var historyHtml = '';
    var index;
    for (index = 0; index < history.length && index < 6; index += 1) {
      historyHtml += '<div class="history-row"><strong>' + history[index].name +
        '</strong><span>' + history[index].date + '</span></div>';
    }
    if (!historyHtml) historyHtml = '<div class="panel-sub">Complete a workout to build history.</div>';
    elements.content.innerHTML =
      '<div class="workout-label">' + profile.name + ' · Training Overview</div>' +
      '<div class="title">PROGRESS</div><div class="progress-grid">' +
      '<div class="panel"><div class="panel-label">Weekly Completion</div>' +
      '<div class="progress-big">' + percent + '%</div><div class="bar"><i style="width:' +
      percent + '%"></i></div></div>' +
      '<div class="panel"><div class="panel-label">HRV vs Baseline</div>' +
      '<div class="progress-big">' + trendPercent(trends.hrv) + '</div></div>' +
      '<div class="panel"><div class="panel-label">Recovery vs Baseline</div>' +
      '<div class="progress-big">' + trendPercent(trends.recovery) + '</div></div></div>' +
      '<div class="history">' + historyHtml + '</div>';
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
    if (trend && finiteNumber(trend.current) && finiteNumber(trend.baseline)) {
      difference = trend.current - trend.baseline;
      good = type === 'rhr' ? difference <= 0 : difference >= 0;
      extra = '<div class="trend ' + (good ? 'up' : 'down') + '">' +
        (difference >= 0 ? '↑' : '↓') + ' ' + Math.abs(Math.round(difference)) + ' vs avg</div>';
    }
    return '<div class="metric"><span>' + label + '</span><b>' +
      (value === null || typeof value === 'undefined' ? '—' : value) + '</b>' + extra + '</div>';
  }

  function loadWhoop() {
    if (profileId === 'kelsey') {
      elements.whoop.className = 'status';
      elements.whoop.innerHTML = 'Kelsey WHOOP is not connected yet. Her workout tracking works independently.';
      elements.whoopLive.textContent = 'WHOOP NOT CONNECTED';
      return;
    }
    requestJson('/api/whoop-data?time=' + new Date().getTime(), function (error, response, status) {
      var recovery;
      var cycle;
      var sleep;
      var trends;
      if (error) {
        elements.whoop.className = 'status';
        elements.whoopLive.textContent = 'WHOOP NOT CONNECTED';
        elements.whoop.innerHTML = status === 401
          ? 'WHOOP needs to be connected from a phone or computer.<br>' +
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
      if (view === 'progress') renderContent();
    });
  }

  function setView(newView) {
    view = newView;
    renderContent();
  }

  function updateDayUrl(day) {
    var target = location.pathname + (day ? '?day=' + encodeURIComponent(day) : '');
    if (window.history && history.replaceState) history.replaceState({}, '', target);
  }

  function setDay(day) {
    selectedDay = day;
    selectedExercise = 0;
    updateDayUrl(day);
    renderContent();
  }

  function changeDay(amount) {
    var index = days.indexOf(selectedDay);
    setDay(days[(index + amount + 7) % 7]);
  }

  function useToday() {
    selectedDay = days[realNow.getDay()];
    updateDayUrl(null);
    renderContent();
  }

  function renderAll() {
    renderContent();
  }

  function init() {
    requestJson('/workouts.json?time=' + new Date().getTime(), function (error, response) {
      if (error) {
        elements.whoop.textContent = 'Startup error';
        elements.content.textContent = 'Workout program unavailable: ' + error;
        return;
      }
      data = response;
      if (!data.profiles || !data.profiles[profileId]) profileId = 'jordan';
      profile = data.profiles[profileId];
      renderAll();
      loadWhoop();
      window.setInterval(loadWhoop, 15 * 60 * 1000);
    });
  }

  window.setProfile = setProfile;
  window.setView = setView;
  window.changeDay = changeDay;
  window.useToday = useToday;
  window.renderContent = renderContent;
  window.completeSet = completeSet;
  window.selectExercise = selectExercise;

  if (document.addEventListener) {
    document.addEventListener('keydown', function (event) {
      var items;
      if (view !== 'today') return;
      items = planFor(selectedDay).exercises || [];
      if (event.key === 'ArrowDown' || event.keyCode === 40) {
        event.preventDefault();
        selectedExercise = Math.min(selectedExercise + 1, Math.max(items.length - 1, 0));
        renderContent();
      }
      if (event.key === 'ArrowUp' || event.keyCode === 38) {
        event.preventDefault();
        selectedExercise = Math.max(selectedExercise - 1, 0);
        renderContent();
      }
      if (event.key === 'Enter' || event.keyCode === 13) {
        event.preventDefault();
        completeSet();
      }
    });
  }

  init();
})();
