(function () {
  'use strict';

  var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var PROFILES = ['jordan', 'kelsey'];
  var PLAN_NAMES = ['Rest', 'Push', 'Pull', 'Legs'];
  var STORAGE_KEY = 'shopWorkoutAdminToken';
  var state = {
    token: '',
    defaults: null,
    config: null,
    target: 'jordan',
    weekOffset: 0,
    exerciseProfile: 'jordan',
    exercisePlan: 'Push'
  };
  var app = document.getElementById('app');
  var lock = document.getElementById('lock');
  var toastTimer;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function pad2(value) { return value < 10 ? '0' + value : String(value); }
  function dateKey(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }
  function dateFromKey(key) { return new Date(key + 'T12:00:00'); }
  function addDays(date, amount) {
    var next = new Date(date.getTime());
    next.setDate(next.getDate() + amount);
    return next;
  }
  function mondayFor(date) {
    var monday = new Date(date.getTime());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    monday.setHours(12, 0, 0, 0);
    return monday;
  }
  function trainingDate() {
    var date = new Date();
    date.setHours(date.getHours() - 7);
    return date;
  }
  function dayName(date) { return DAYS[(date.getDay() + 6) % 7]; }
  function targets() { return state.target === 'both' ? PROFILES.slice() : [state.target]; }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"]/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character];
    });
  }
  function slug(value) {
    return String(value || 'exercise').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'exercise';
  }
  function showToast(message) {
    var element = document.getElementById('toast');
    element.textContent = message;
    element.className = 'toast show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { element.className = 'toast'; }, 3200);
  }
  function hashTokenFromUrl() {
    var match = /^#token=([^&]+)/.exec(location.hash || '');
    if (!match) return '';
    try { return decodeURIComponent(match[1]); } catch (error) { return ''; }
  }
  function request(url, options) {
    var settings = options || {};
    settings.headers = Object.assign({}, settings.headers || {}, state.token
      ? { Authorization: 'Bearer ' + state.token }
      : {});
    return fetch(url, settings).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) {
          var error = new Error(body.error || 'Request failed.');
          error.status = response.status;
          throw error;
        }
        return body;
      });
    });
  }
  function showLock(message) {
    app.style.display = 'none';
    lock.style.display = 'block';
    document.getElementById('lockError').textContent = message || '';
  }
  function effectiveWeek(profile) {
    return state.config.profileWeeks[profile] || state.defaults.profiles[profile].week;
  }
  function ensureWeek(profile) {
    if (!state.config.profileWeeks[profile]) {
      state.config.profileWeeks[profile] = clone(state.defaults.profiles[profile].week);
    }
    return state.config.profileWeeks[profile];
  }
  function planTemplate(profile, name) {
    var weeks = [effectiveWeek(profile), state.defaults.profiles[profile].week];
    var weekIndex;
    var dayIndex;
    if (name === 'Rest') return { name: 'Rest', exercises: [] };
    for (weekIndex = 0; weekIndex < weeks.length; weekIndex += 1) {
      for (dayIndex = 0; dayIndex < DAYS.length; dayIndex += 1) {
        if (weeks[weekIndex][DAYS[dayIndex]].name === name) {
          return clone(weeks[weekIndex][DAYS[dayIndex]]);
        }
      }
    }
    return { name: name, exercises: [] };
  }
  function rotatedPlan(plan, date) {
    var rotation = state.defaults.accessoryRotation;
    var startsOn;
    var weekNumber;
    var cycle;
    var result;
    if (!rotation || !rotation.cycleWeeks || !rotation.cycleWeeks.length || !plan.exercises || plan.exercises.length < 3) {
      return clone(plan);
    }
    startsOn = dateFromKey(rotation.startsOn);
    weekNumber = Math.floor((mondayFor(date).getTime() - mondayFor(startsOn).getTime()) / (7 * 24 * 60 * 60 * 1000));
    if (weekNumber < 0) return clone(plan);
    cycle = rotation.cycleWeeks[weekNumber % rotation.cycleWeeks.length];
    result = clone(plan);
    if (cycle[plan.name]) result.exercises[2] = clone(cycle[plan.name]);
    return result;
  }
  function resolvedPlan(profile, date) {
    var key = dateKey(date);
    var exception = state.config.dateOverrides[key];
    if (exception && exception[profile]) return exception[profile];
    return rotatedPlan(effectiveWeek(profile)[dayName(date)], date);
  }
  function setOverride(profile, date, plan) {
    var key = dateKey(date);
    if (!state.config.dateOverrides[key]) state.config.dateOverrides[key] = {};
    state.config.dateOverrides[key][profile] = clone(plan);
  }
  function deleteOverride(profile, key) {
    if (!state.config.dateOverrides[key]) return;
    delete state.config.dateOverrides[key][profile];
    if (!Object.keys(state.config.dateOverrides[key]).length) delete state.config.dateOverrides[key];
  }
  function scheduleOptions(selected) {
    return PLAN_NAMES.map(function (name) {
      return '<option value="' + name + '"' + (name === selected ? ' selected' : '') + '>' + name + '</option>';
    }).join('');
  }
  function targetLabel() {
    if (state.target === 'both') return 'Jordan + Kelsey';
    return state.defaults.profiles[state.target].name;
  }
  function catchUpLabel() {
    if (state.target === 'both') return 'Do yesterday’s workout today';
    var yesterday = addDays(trainingDate(), -1);
    return 'Do yesterday’s ' + resolvedPlan(state.target, yesterday).name + ' today';
  }
  function syncLabel() {
    if (!state.config.updatedAt) return 'Ready';
    return 'Saved ' + new Date(state.config.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function selectedWeekPlan(day) {
    var list = targets().map(function (profile) { return effectiveWeek(profile)[day].name; });
    return list.every(function (name) { return name === list[0]; }) ? list[0] : 'Mixed';
  }
  function shortDate(date) {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  function exerciseSummary(plan) {
    return plan.exercises.map(function (exercise, index) {
      return '<span class="movement ' + (index === 2 && (plan.name === 'Push' || plan.name === 'Pull') ? 'rotating' : '') + '">' +
        escapeHtml(exercise.name) + (index === 2 && (plan.name === 'Push' || plan.name === 'Pull') ? '<i>rotates</i>' : '') + '</span>';
    }).join('');
  }
  function renderProjectionPlan(profile, date) {
    var plan = resolvedPlan(profile, date);
    var person = state.target === 'both' ? '<span class="person">' + state.defaults.profiles[profile].name + '</span>' : '';
    if (!plan.exercises.length) {
      return '<div class="projection-plan rest">' + person + '<span class="plan-pill">Rest</span></div>';
    }
    return '<div class="projection-plan">' + person + '<span class="plan-pill ' + plan.name.toLowerCase() + '">' + escapeHtml(plan.name) + '</span>' +
      '<div class="movement-list">' + exerciseSummary(plan) + '</div></div>';
  }
  function renderWeekProjection(today) {
    var monday = addDays(mondayFor(today), state.weekOffset * 7);
    var sunday = addDays(monday, 6);
    var rows = DAYS.map(function (day, index) {
      var date = addDays(monday, index);
      var isToday = dateKey(date) === dateKey(today);
      return '<div class="projection-day ' + (isToday ? 'today' : '') + '"><div class="day-stamp"><strong>' +
        (isToday ? 'Today' : day.slice(0, 3)) + '</strong><span>' + shortDate(date) + '</span></div><div class="day-plans">' +
        targets().map(function (profile) { return renderProjectionPlan(profile, date); }).join('') + '</div></div>';
    }).join('');
    return '<section class="card schedule-card"><div class="section-head schedule-head"><div><div class="eyebrow">Your plan</div><h2>' +
      (state.weekOffset ? 'Next week' : 'This week') + '</h2><p class="sub">' + shortDate(monday) + ' — ' + shortDate(sunday) +
      '</p></div><div class="week-switch"><button data-week-offset="0" class="' + (!state.weekOffset ? 'active' : '') + '">This week</button>' +
      '<button data-week-offset="1" class="' + (state.weekOffset ? 'active' : '') + '">Next week</button></div></div>' +
      '<div class="projection">' + rows + '</div><p class="rotation-note"><span>↻</span> The first two movements stay consistent. The third Push and Pull movement alternates weekly.</p></section>';
  }
  function renderExerciseEditor() {
    var plan = planTemplate(state.exerciseProfile, state.exercisePlan);
    var rows = plan.exercises.map(function (exercise, index) {
      return '<div class="exercise" data-index="' + index + '" data-id="' + escapeHtml(exercise.id) + '">' +
        '<div class="exercise-top"><span class="grip">' + pad2(index + 1) + '</span>' +
        '<input class="exercise-name" value="' + escapeHtml(exercise.name) + '" aria-label="Exercise name">' +
        '<button class="remove" data-action="remove-exercise" aria-label="Remove exercise">×</button></div>' +
        '<div class="fields"><label>Sets<input class="exercise-sets" type="number" min="1" max="10" value="' + exercise.sets + '"></label>' +
        '<label>Reps<input class="exercise-reps" value="' + escapeHtml(exercise.reps) + '"></label>' +
        '<label>Rest sec<input class="exercise-rest" type="number" min="0" max="600" step="5" value="' + exercise.restSeconds + '"></label></div>' +
        '<div class="move-row"><button class="mini" data-action="move-up">↑ Earlier</button><button class="mini" data-action="move-down">↓ Later</button></div></div>';
    }).join('');
    return '<div class="editor-tabs">' + PROFILES.map(function (profile) {
      return '<button class="chip ' + (state.exerciseProfile === profile ? 'active' : '') + '" data-profile-editor="' + profile + '">' +
        state.defaults.profiles[profile].name + '</button>';
    }).join('') + '</div><div class="editor-tabs">' + ['Push', 'Pull', 'Legs'].map(function (name) {
      return '<button class="chip ' + (state.exercisePlan === name ? 'active' : '') + '" data-plan-editor="' + name + '">' + name + '</button>';
    }).join('') + '</div><div id="exerciseList" class="exercise-list">' + rows + '</div>' +
      '<div class="footer-actions"><button class="add" data-action="add-exercise">+ Exercise</button>' +
      '<button class="save" data-action="save-exercises">Save exercises</button></div>';
  }
  function renderExceptions() {
    var rows = [];
    Object.keys(state.config.dateOverrides).sort().forEach(function (key) {
      PROFILES.forEach(function (profile) {
        var plan = state.config.dateOverrides[key][profile];
        if (!plan) return;
        rows.push('<div class="exception-row"><div><strong>' + new Date(key + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' }) +
          ' · ' + state.defaults.profiles[profile].name + '</strong><br><span>' + escapeHtml(plan.name) + '</span></div>' +
          '<button data-remove-exception="' + key + '|' + profile + '">Remove</button></div>');
      });
    });
    return rows.length ? rows.join('') : '<p class="sub">No special dates. Your normal weekly schedule is in control.</p>';
  }
  function render() {
    var today = trainingDate();
    var todayPlans = targets().map(function (profile) {
      return state.defaults.profiles[profile].name + ': ' + resolvedPlan(profile, today).name;
    }).join(' · ');
    app.style.display = 'block';
    lock.style.display = 'none';
    app.innerHTML = '<header class="top"><div><div class="eyebrow">Shop training</div><h1>Plan the week.</h1><p class="top-sub">See it. Adjust it. Then let the TV run the workout.</p></div>' +
      '<div class="sync"><b>TV live</b><span id="syncLabel">' + syncLabel() + '</span></div></header>' +
      '<section class="profile-card"><div><strong>Viewing</strong><span>' + escapeHtml(todayPlans) + '</span></div>' +
      '<div class="segments">' + ['jordan', 'kelsey', 'both'].map(function (target) {
        var label = target === 'both' ? 'Both' : state.defaults.profiles[target].name;
        return '<button data-target="' + target + '" class="' + (state.target === target ? 'active' : '') + '">' + label + '</button>';
      }).join('') + '</div></section>' + renderWeekProjection(today) +
      '<section class="card"><div class="section-head"><div><div class="eyebrow">Quick changes</div><h2>Adjust the plan</h2><p class="sub">One tap. The TV notices within 30 seconds.</p></div></div>' +
      '<div class="quick-grid"><button class="action primary wide" data-action="catch-up"><strong>' + catchUpLabel() + '</strong><span>' +
      (state.target === 'both'
        ? 'Choose Jordan or Kelsey first so a completed workout is never moved for the other person.'
        : 'Copies the missed session onto today without changing the permanent schedule.') +
      '</span></button>' +
      '<button class="action" data-action="defer"><strong>Move today → tomorrow</strong><span>Keeps today as rest and preserves the next workout.</span></button>' +
      '<button class="action" data-action="shift"><strong>Shift remaining week</strong><span>Moves every remaining session forward one day.</span></button>' +
      '<button class="action wide" data-action="restore"><strong>Restore normal schedule</strong><span>Removes this week’s exceptions for ' + targetLabel() + '.</span></button></div></section>' +
      '<section class="card"><div class="section-head"><div><div class="eyebrow">Foundation</div><h2>Normal weekly schedule</h2><p class="sub">Permanent until you change it again.</p></div></div>' +
      '<div class="toggle-row"><div><strong>Shared weekly rhythm</strong><span>Permanent day changes stay aligned for both people.</span></div>' +
      '<button class="switch ' + (state.config.sharedSchedule ? 'on' : '') + '" data-action="toggle-shared" aria-label="Toggle shared schedule"></button></div>' +
      '<div class="week">' + DAYS.map(function (day) {
        var selected = selectedWeekPlan(day);
        return '<div class="day-row"><label>' + day + '</label><select data-week-day="' + day + '">' +
          (selected === 'Mixed' ? '<option selected disabled>Mixed</option>' : '') + scheduleOptions(selected) + '</select></div>';
      }).join('') + '</div></section>' +
      '<section class="card"><div class="section-head"><div><div class="eyebrow">Movements</div><h2>Exercise library</h2><p class="sub">The first two stay fixed. Position three rotates automatically on Push and Pull days.</p></div></div>' + renderExerciseEditor() + '</section>' +
      '<section class="card"><div class="section-head"><div><div class="eyebrow">Exception</div><h2>Special date</h2><p class="sub">Override one date without changing the normal week.</p></div></div>' +
      '<div class="exception-grid"><input id="exceptionDate" type="date" value="' + dateKey(today) + '"><select id="exceptionPlan">' + scheduleOptions('Rest') + '</select>' +
      '<button class="save" data-action="save-exception">Set for ' + targetLabel() + '</button></div><div class="exceptions">' + renderExceptions() + '</div></section>';
  }
  function saveConfig(message) {
    var expectedRevision = state.config.revision;
    var sync = document.getElementById('syncLabel');
    if (sync) sync.textContent = 'Saving…';
    return request('/api/workout-admin', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: state.config, expectedRevision: expectedRevision })
    }).then(function (config) {
      state.config = config;
      render();
      showToast(message || 'Saved · TV updating now');
    }).catch(function (error) {
      if (error.status === 409) {
        return load().then(function () { showToast('Reloaded a newer change · try once more'); });
      }
      render();
      showToast(error.message);
    });
  }
  function deferToday() {
    var today = trainingDate();
    var tomorrow = addDays(today, 1);
    targets().forEach(function (profile) {
      var current = clone(resolvedPlan(profile, today));
      var tomorrowPlan = clone(resolvedPlan(profile, tomorrow));
      if (!current.exercises.length) return;
      setOverride(profile, today, { name: 'Rest', exercises: [] });
      setOverride(profile, tomorrow, current);
      if (tomorrowPlan.exercises.length) {
        var cursor = addDays(tomorrow, 1);
        var carry = tomorrowPlan;
        var mondayOffset = 7 - ((today.getDay() + 6) % 7);
        var weekEnd = addDays(today, mondayOffset - 1);
        while (cursor.getTime() <= weekEnd.getTime()) {
          var nextCarry = clone(resolvedPlan(profile, cursor));
          setOverride(profile, cursor, carry);
          carry = nextCarry;
          cursor = addDays(cursor, 1);
        }
      }
    });
    saveConfig('Moved to tomorrow · TV updating now');
  }
  function catchUpYesterday() {
    var today = trainingDate();
    var yesterday = addDays(today, -1);
    var missed;
    if (state.target === 'both') {
      showToast('Choose Jordan or Kelsey first');
      return;
    }
    missed = clone(resolvedPlan(state.target, yesterday));
    if (!missed.exercises || !missed.exercises.length) {
      showToast(state.defaults.profiles[state.target].name + ' had no workout yesterday');
      return;
    }
    setOverride(state.target, today, missed);
    saveConfig(missed.name + ' is ready today · TV updating now');
  }
  function shiftWeek() {
    var today = trainingDate();
    var todayIndex = (today.getDay() + 6) % 7;
    var weekEnd = addDays(today, 6 - todayIndex);
    targets().forEach(function (profile) {
      var plans = [];
      var cursor = new Date(today.getTime());
      while (cursor.getTime() <= weekEnd.getTime()) {
        plans.push(clone(resolvedPlan(profile, cursor)));
        cursor = addDays(cursor, 1);
      }
      setOverride(profile, today, { name: 'Rest', exercises: [] });
      for (var index = 1; index < plans.length; index += 1) {
        setOverride(profile, addDays(today, index), plans[index - 1]);
      }
    });
    saveConfig('Remaining week shifted one day');
  }
  function restoreWeek() {
    var today = trainingDate();
    var monday = addDays(today, -((today.getDay() + 6) % 7));
    targets().forEach(function (profile) {
      for (var index = 0; index < 7; index += 1) deleteOverride(profile, dateKey(addDays(monday, index)));
    });
    saveConfig('Normal weekly schedule restored');
  }
  function changePermanentDay(day, planName) {
    var selectedTargets = state.config.sharedSchedule ? PROFILES : targets();
    selectedTargets.forEach(function (profile) {
      ensureWeek(profile)[day] = planTemplate(profile, planName);
    });
    saveConfig(day + ' updated permanently');
  }
  function readExerciseForm() {
    return Array.from(document.querySelectorAll('#exerciseList .exercise')).map(function (row, index) {
      var name = row.querySelector('.exercise-name').value.trim();
      return {
        id: row.dataset.id || slug(name) + '-' + (index + 1),
        name: name,
        sets: Number(row.querySelector('.exercise-sets').value),
        reps: row.querySelector('.exercise-reps').value.trim(),
        restSeconds: Number(row.querySelector('.exercise-rest').value)
      };
    });
  }
  function saveExercises() {
    var exercises = readExerciseForm();
    if (!exercises.length) { showToast('Add at least one exercise'); return; }
    var week = ensureWeek(state.exerciseProfile);
    DAYS.forEach(function (day) {
      if (week[day].name === state.exercisePlan) week[day].exercises = clone(exercises);
    });
    Object.keys(state.config.dateOverrides).forEach(function (key) {
      var plan = state.config.dateOverrides[key][state.exerciseProfile];
      if (plan && plan.name === state.exercisePlan) plan.exercises = clone(exercises);
    });
    saveConfig(state.defaults.profiles[state.exerciseProfile].name + ' ' + state.exercisePlan + ' exercises saved');
  }
  function reorderExercise(button, amount) {
    var row = button.closest('.exercise');
    var sibling = amount < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!sibling) return;
    if (amount < 0) row.parentNode.insertBefore(row, sibling);
    else row.parentNode.insertBefore(sibling, row);
  }
  function saveException() {
    var key = document.getElementById('exceptionDate').value;
    var planName = document.getElementById('exceptionPlan').value;
    if (!key) { showToast('Choose a date first'); return; }
    targets().forEach(function (profile) {
      setOverride(profile, dateFromKey(key), planTemplate(profile, planName));
    });
    saveConfig('Special date saved');
  }
  function handleClick(event) {
    var targetButton = event.target.closest('[data-target]');
    var weekButton = event.target.closest('[data-week-offset]');
    var profileEditor = event.target.closest('[data-profile-editor]');
    var planEditor = event.target.closest('[data-plan-editor]');
    var exceptionButton = event.target.closest('[data-remove-exception]');
    var actionButton = event.target.closest('[data-action]');
    if (targetButton) { state.target = targetButton.dataset.target; render(); return; }
    if (weekButton) { state.weekOffset = Number(weekButton.dataset.weekOffset); render(); return; }
    if (profileEditor) { state.exerciseProfile = profileEditor.dataset.profileEditor; render(); return; }
    if (planEditor) { state.exercisePlan = planEditor.dataset.planEditor; render(); return; }
    if (exceptionButton) {
      var parts = exceptionButton.dataset.removeException.split('|');
      deleteOverride(parts[1], parts[0]);
      saveConfig('Special date removed');
      return;
    }
    if (!actionButton) return;
    var action = actionButton.dataset.action;
    if (action === 'catch-up') catchUpYesterday();
    else if (action === 'defer') deferToday();
    else if (action === 'shift') shiftWeek();
    else if (action === 'restore') restoreWeek();
    else if (action === 'toggle-shared') { state.config.sharedSchedule = !state.config.sharedSchedule; saveConfig('Shared schedule updated'); }
    else if (action === 'save-exercises') saveExercises();
    else if (action === 'save-exception') saveException();
    else if (action === 'remove-exercise') actionButton.closest('.exercise').remove();
    else if (action === 'move-up') reorderExercise(actionButton, -1);
    else if (action === 'move-down') reorderExercise(actionButton, 1);
    else if (action === 'add-exercise') {
      if (document.querySelectorAll('#exerciseList .exercise').length >= 5) { showToast('The TV supports up to five exercises'); return; }
      var list = document.getElementById('exerciseList');
      var index = list.children.length;
      var wrapper = document.createElement('div');
      wrapper.innerHTML = '<div class="exercise" data-index="' + index + '"><div class="exercise-top"><span class="grip">' + pad2(index + 1) + '</span><input class="exercise-name" value="New Exercise"><button class="remove" data-action="remove-exercise">×</button></div><div class="fields"><label>Sets<input class="exercise-sets" type="number" value="3"></label><label>Reps<input class="exercise-reps" value="8–12"></label><label>Rest sec<input class="exercise-rest" type="number" value="90"></label></div><div class="move-row"><button class="mini" data-action="move-up">↑ Earlier</button><button class="mini" data-action="move-down">↓ Later</button></div></div>';
      list.appendChild(wrapper.firstChild);
    }
  }
  function load() {
    return Promise.all([
      fetch('/workouts.json?time=' + Date.now()).then(function (response) { return response.json(); }),
      request('/api/workout-admin')
    ]).then(function (values) {
      state.defaults = values[0];
      state.config = values[1];
      render();
    }).catch(function (error) {
      if (error.status === 401) {
        localStorage.removeItem(STORAGE_KEY);
        state.token = '';
        showLock('That access key was not accepted.');
        return;
      }
      showLock(error.message);
    });
  }
  function unlock() {
    var input = document.getElementById('tokenInput');
    state.token = input.value.trim();
    if (!state.token) { document.getElementById('lockError').textContent = 'Enter the private access key.'; return; }
    localStorage.setItem(STORAGE_KEY, state.token);
    load();
  }

  app.addEventListener('click', handleClick);
  app.addEventListener('change', function (event) {
    if (event.target.matches('[data-week-day]')) changePermanentDay(event.target.dataset.weekDay, event.target.value);
  });
  document.getElementById('unlockButton').addEventListener('click', unlock);
  document.getElementById('tokenInput').addEventListener('keydown', function (event) { if (event.key === 'Enter') unlock(); });

  var fragmentToken = hashTokenFromUrl();
  if (fragmentToken) {
    state.token = fragmentToken;
    localStorage.setItem(STORAGE_KEY, fragmentToken);
    history.replaceState({}, '', location.pathname + location.search);
  } else {
    state.token = localStorage.getItem(STORAGE_KEY) || '';
  }
  if (state.token) load();
  else showLock();
}());
