import assert from 'node:assert/strict';
import { parse } from 'acorn';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const elementIds = [
  'planName', 'hello', 'date', 'clock', 'preview', 'householdStatus', 'jordanBtn', 'kelseyBtn',
  'whoopLive', 'progressTab', 'whoop', 'content', 'controlHint', 'toast',
  'celebration', 'celebrationSource', 'celebrationTitle', 'celebrationMeta'
];

function createElementMap() {
  return Object.fromEntries(elementIds.map((id) => [
    id,
    { className: '', textContent: '', innerHTML: '', style: {} }
  ]));
}

function mutableDate(initialValue) {
  let current = new Date(initialValue).getTime();
  return class TestDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [current]));
    }

    static now() {
      return current;
    }

    static set(value) {
      current = new Date(value).getTime();
    }
  };
}

test('serves one Samsung-compatible client without a competing modern loader', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(html, /<script src="\/app-legacy\.js"><\/script>/);
  assert.doesNotMatch(html, /modern-client|new Function/);
  assert.equal((html.match(/<script/g) || []).length, 1);
});

test('TV client remains valid ES5 and avoids unsupported browser APIs', async () => {
  const source = await readFile(new URL('../app-legacy.js', import.meta.url), 'utf8');

  assert.doesNotThrow(() => parse(source, { ecmaVersion: 5, sourceType: 'script' }));
  assert.doesNotMatch(source, /\b(?:const|let|async|await)\b/);
  assert.doesNotMatch(source, /=>|\?\.|\?\?|\`/);
  assert.doesNotMatch(source, /\b(?:fetch|URLSearchParams)\b/);
  assert.doesNotMatch(source, /\.(?:includes|padStart)\s*\(/);
  assert.doesNotMatch(source, /Number\.isFinite/);
});

test('desktop TV layout is locked to one viewport with flexible exercise rows', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(html, /html,body\{[^}]*height:100%;[^}]*overflow:hidden/);
  assert.match(html, /\.screen\{[^}]*height:100%;[^}]*min-height:0;[^}]*display:flex/);
  assert.match(html, /\.workspace\{[^}]*flex:1;min-height:0;[^}]*overflow:hidden/);
  assert.match(html, /\.training-layout\{[^}]*flex:1;min-height:0;display:flex/);
  assert.match(html, /\.ambient-layout\{[^}]*flex:1;min-height:0;display:flex/);
  assert.match(html, /\.ambient-move\{[^}]*flex:1;min-height:0;[^}]*display:flex/);
  assert.match(html, /\.exercise\{[^}]*flex:1;min-height:0;[^}]*display:flex/);
  assert.match(html, /\.toolbar button\.remote-focus\{[^}]*outline:2px solid #a9ffcf/);
  assert.match(html, /\.toolbar button\{[^}]*min-width:76px;min-height:38px/);
  assert.match(html, /\.calendar-key\{[^}]*font-size:9px/);
  assert.match(html, /\.exercise\.remote-focus\{[^}]*box-shadow:[^}]*#a9ffcf/);
  assert.match(html, /\.timer-value\{[^}]*color:#a9ffcf/);
  assert.match(html, /\.celebration\{[^}]*position:fixed;[^}]*top:0;right:0;bottom:0;left:0/);
  assert.match(html, /\.household-progress-layout\{[^}]*flex:1;min-height:0;display:flex/);
  assert.match(html, /\.month-grid\{[^}]*flex:1;min-height:0;display:flex;flex-wrap:wrap/);
  assert.match(html, /@media\(max-width:900px\)\{\s*html,body\{height:auto;overflow:auto\}/);
  assert.doesNotMatch(html, /max-width:(?:1000|1100|1420)px/);
});

test('every configured training day stays within the five-row TV density budget', async () => {
  const workouts = JSON.parse(await readFile(new URL('../workouts.json', import.meta.url), 'utf8'));

  for (const profile of Object.values(workouts.profiles)) {
    for (const [day, plan] of Object.entries(profile.week)) {
      assert.ok(
        plan.exercises.length <= 5,
        `${profile.name} ${day} has ${plan.exercises.length} exercises; the TV frame supports five`
      );
    }
  }
});

test('the shared training week starts with Push on Monday', async () => {
  const workouts = JSON.parse(await readFile(new URL('../workouts.json', import.meta.url), 'utf8'));

  for (const profile of Object.values(workouts.profiles)) {
    assert.equal(profile.week.Monday.name, 'Push');
    assert.equal(profile.week.Tuesday.name, 'Rest');
    assert.equal(profile.week.Wednesday.name, 'Pull');
    assert.equal(profile.week.Thursday.name, 'Rest');
    assert.equal(profile.week.Friday.name, 'Legs');
    assert.equal(profile.week.Sunday.name, 'Rest');
  }
  assert.deepEqual(
    workouts.profiles.jordan.week.Monday.exercises.map((exercise) => exercise.name),
    ['Dumbbell Bench Press', 'Incline Dumbbell Press', 'Dumbbell Lateral Raise']
  );
  assert.deepEqual(
    workouts.profiles.kelsey.week.Monday.exercises.map((exercise) => exercise.name),
    ['Dumbbell Bench Press', 'Incline Dumbbell Press', 'Dumbbell Lateral Raise']
  );
  for (const profile of Object.values(workouts.profiles)) {
    assert.equal(profile.week.Monday.exercises.length, 3);
    assert.equal(profile.week.Wednesday.exercises.length, 3);
    assert.equal(profile.week.Friday.exercises.length, 3);
  }
});

test('the third Push and Pull movements alternate while the first two stay anchored', async () => {
  const source = await readFile(new URL('../app-legacy.js', import.meta.url), 'utf8');
  const workouts = JSON.parse(await readFile(new URL('../workouts.json', import.meta.url), 'utf8'));
  const elements = createElementMap();
  const TestDate = mutableDate('2026-08-19T12:00:00-07:00');

  class FakeXmlHttpRequest {
    open(_method, url) { this.url = url; }
    send() {
      this.readyState = 4;
      this.status = 200;
      if (this.url.startsWith('/workouts.json')) this.responseText = JSON.stringify(workouts);
      else if (this.url.startsWith('/api/workout-plan')) {
        this.responseText = JSON.stringify({
          schemaVersion: 1,
          revision: 0,
          sharedSchedule: true,
          profileWeeks: {},
          dateOverrides: {}
        });
      } else this.responseText = JSON.stringify({ workouts: [], trends: {} });
      this.onreadystatechange();
    }
  }

  const context = {
    console,
    document: {
      getElementById: (id) => elements[id],
      addEventListener() {}
    },
    history: { replaceState() {} },
    location: { search: '', pathname: '/' },
    localStorage: { getItem() { return null; }, setItem() {} },
    XMLHttpRequest: FakeXmlHttpRequest,
    setInterval() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    Date: TestDate
  };
  context.window = context;
  vm.runInNewContext(source, context);

  assert.match(elements.content.innerHTML, /Pull-Ups/);
  assert.match(elements.content.innerHTML, /One-Arm Dumbbell Row/);
  assert.match(elements.content.innerHTML, /Dumbbell Hammer Curl/);
  assert.doesNotMatch(elements.content.innerHTML, />Dumbbell Curl</);

  context.setDay('Monday');
  assert.match(elements.content.innerHTML, /Dumbbell Bench Press/);
  assert.match(elements.content.innerHTML, /Incline Dumbbell Press/);
  assert.match(elements.content.innerHTML, /Band Triceps Extension/);
});

test('TV client renders training, rest, progress, WHOOP, and set completion flows', async () => {
  const source = await readFile(new URL('../app-legacy.js', import.meta.url), 'utf8');
  const workouts = JSON.parse(await readFile(new URL('../workouts.json', import.meta.url), 'utf8'));
  const elements = createElementMap();
  const requests = [];
  const storage = new Map();
  const TestDate = mutableDate('2026-08-10T12:00:00-07:00');
  storage.set('shopSessionUI:jordan:2026-08-10', JSON.stringify({ selectedDay: 'Tuesday' }));

  class FakeXmlHttpRequest {
    open(_method, url) {
      this.url = url;
    }

    send() {
      requests.push(this.url);
      this.readyState = 4;
      this.status = 200;
      this.responseText = this.url.startsWith('/workouts.json')
        ? JSON.stringify(workouts)
        : JSON.stringify({
            recovery: { score: { recovery_score: 80, hrv_rmssd_milli: 45, resting_heart_rate: 55 } },
            cycle: { score: { strain: 10.2 } },
            sleep: { score: { sleep_performance_percentage: 90 } },
            trends: {
              recovery: { current: 80, baseline: 70 },
              hrv: { current: 45, baseline: 42 },
              restingHr: { current: 55, baseline: 57 },
              strain: { current: 10.2, baseline: 9 },
              sleep: { current: 90, baseline: 85 }
            },
            workouts: [],
            workoutAccess: true
          });
      this.onreadystatechange();
    }
  }

  const context = {
    console,
    document: {
      getElementById: (id) => elements[id],
      addEventListener() {}
    },
    history: { replaceState() {} },
    location: { search: '?day=Tuesday', pathname: '/' },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value)
    },
    XMLHttpRequest: FakeXmlHttpRequest,
    setInterval() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    Date: TestDate
  };
  context.window = context;

  vm.runInNewContext(source, context);

  assert.equal(elements.hello.textContent, 'HELLO, JORDAN');
  assert.equal(elements.whoop.className, 'whoop');
  assert.match(elements.whoop.innerHTML, /Recovery/);
  assert.match(elements.whoop.innerHTML, /80%/);
  assert.equal(elements.whoopLive.textContent, 'JORDAN WHOOP · JUST UPDATED');
  assert.match(elements.householdStatus.innerHTML, /Jordan<strong>Ready/);
  assert.match(elements.householdStatus.innerHTML, /Kelsey<strong>Ready/);

  assert.match(elements.content.innerHTML, /PUSH DAY/);
  assert.match(elements.content.innerHTML, /READY WHEN YOU ARE/);
  assert.match(elements.content.innerHTML, /Complete workout/);
  assert.match(elements.content.innerHTML, /Track individual sets/);
  assert.match(elements.content.innerHTML, /Dumbbell Bench Press/);
  assert.match(elements.content.innerHTML, /Est\. time/);
  assert.equal((elements.content.innerHTML.match(/class="ambient-move /g) || []).length, 3);

  context.setTrackingMode('sets');
  assert.match(elements.content.innerHTML, /PUSH SESSION/);
  assert.match(elements.content.innerHTML, /class="focus-card remote-focus"/);
  context.completeSet();
  assert.match(elements.content.innerHTML, /1<\/strong><span>of 3 sets complete/);
  assert.match(elements.content.innerHTML, /set-segment done/);
  assert.match(elements.content.innerHTML, /Rest timer/);
  assert.match(elements.content.innerHTML, /Back undoes the last set/);

  context.setTrackingMode('ambient');
  context.completeWorkout('manual');
  assert.match(elements.content.innerHTML, /WORKOUT COMPLETE/);
  assert.match(elements.content.innerHTML, /Marked complete on this screen/);
  assert.match(elements.celebration.className, /visible/);
  assert.equal(elements.celebrationTitle.textContent, 'PUSH COMPLETE');
  assert.match(elements.householdStatus.innerHTML, /Jordan<strong>Done/);
  assert.match(elements.householdStatus.innerHTML, /Kelsey<strong>Ready/);
  context.dismissCelebration();
  context.setProfile('kelsey');
  assert.match(elements.content.innerHTML, /READY WHEN YOU ARE/);
  assert.doesNotMatch(elements.content.innerHTML, /WORKOUT COMPLETE/);

  context.setDay('Tuesday');
  assert.match(elements.content.innerHTML, /RECOVERY DAY/);
  assert.match(elements.content.innerHTML, /class="week-strip"/);
  assert.match(elements.content.innerHTML, /Wednesday/);
  assert.match(elements.content.innerHTML, /Pull Session/);

  context.setView('progress');
  assert.doesNotMatch(elements.content.innerHTML, /Shared progress|YOUR MONTH, TOGETHER|Two routines/);
  assert.match(elements.content.innerHTML, /Together this month/);
  assert.match(elements.content.innerHTML, /Jordan/);
  assert.match(elements.content.innerHTML, /Kelsey/);
  assert.equal(elements.hello.textContent, 'HOUSEHOLD PROGRESS');
  assert.equal(elements.planName.textContent, 'SHARED');
  assert.match(elements.progressTab.className, /active/);
  assert.doesNotMatch(elements.jordanBtn.className, /active/);
  assert.doesNotMatch(elements.kelseyBtn.className, /active/);

  context.setProfile('jordan');
  assert.match(elements.content.innerHTML, /READY WHEN YOU ARE|WORKOUT COMPLETE/);
  assert.match(elements.jordanBtn.className, /active/);
  assert.doesNotMatch(elements.progressTab.className, /active/);

  context.setView('progress');
  context.setProfile('kelsey');
  assert.match(elements.content.innerHTML, /READY WHEN YOU ARE|WORKOUT COMPLETE/);
  assert.match(elements.kelseyBtn.className, /active/);
  assert.doesNotMatch(elements.progressTab.className, /active/);

  assert.ok(requests.some((url) => url.startsWith('/workouts.json')));
  assert.ok(requests.some((url) => url.startsWith('/api/workout-plan')));
  assert.ok(requests.some((url) => url.includes('/api/whoop-data?profile=jordan')));
  assert.ok(requests.some((url) => url.includes('/api/whoop-data?profile=kelsey')));
});

test('shared progress calendar splits Jordan and Kelsey status for every day', async () => {
  const source = await readFile(new URL('../app-legacy.js', import.meta.url), 'utf8');
  const workouts = JSON.parse(await readFile(new URL('../workouts.json', import.meta.url), 'utf8'));
  const elements = createElementMap();
  const storage = new Map();
  const TestDate = mutableDate('2026-08-13T12:00:00-07:00');

  class FakeXmlHttpRequest {
    open(_method, url) { this.url = url; }
    send() {
      this.readyState = 4;
      this.status = 200;
      if (this.url.startsWith('/workouts.json')) {
        this.responseText = JSON.stringify(workouts);
      } else if (this.url.startsWith('/api/workout-plan')) {
        this.responseText = JSON.stringify({
          schemaVersion: 1,
          revision: 9,
          sharedSchedule: true,
          profileWeeks: {},
          dateOverrides: {
            '2026-08-13': { jordan: workouts.profiles.jordan.week.Wednesday },
          },
          rescheduleEvents: [{
            profile: 'jordan',
            fromDate: '2026-08-12',
            toDate: '2026-08-13',
            planName: 'Pull',
          }],
        });
      } else if (this.url.startsWith('/api/workout-history')) {
        this.responseText = JSON.stringify({
          profiles: {
            jordan: [{ date: '2026-08-13', planName: 'Pull', completionSource: 'manual' }],
            kelsey: [{ date: '2026-08-12', planName: 'Pull', completionSource: 'manual' }],
          },
        });
      } else if (this.url.startsWith('/api/daily-steps')) {
        this.responseText = JSON.stringify({
          goal: 12500,
          profiles: {
            jordan: [{ date: '2026-08-13', steps: 13120, goal: 12500, met: true }],
            kelsey: [{ date: '2026-08-13', steps: 8400, goal: 12500, met: false }],
          },
        });
      } else {
        const isKelsey = this.url.includes('profile=kelsey');
        this.responseText = JSON.stringify({
          recovery: { score: {
            recovery_score: isKelsey ? 71 : 82,
            hrv_rmssd_milli: isKelsey ? 61 : 83,
          } },
          sleep: { score: { sleep_performance_percentage: isKelsey ? 88 : 96 } },
          workouts: [],
          trends: {},
        });
      }
      this.onreadystatechange();
    }
  }

  const context = {
    console,
    document: {
      getElementById: (id) => elements[id],
      addEventListener() {},
    },
    history: { replaceState() {} },
    location: { search: '', pathname: '/' },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
    XMLHttpRequest: FakeXmlHttpRequest,
    setInterval() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    Date: TestDate,
  };
  context.window = context;
  vm.runInNewContext(source, context);
  context.setView('progress');

  assert.equal(elements.hello.textContent, 'HOUSEHOLD PROGRESS');
  assert.equal(elements.whoopLive.textContent, 'HOUSEHOLD WHOOP · LIVE');
  assert.match(elements.whoop.innerHTML, /Jordan/);
  assert.match(elements.whoop.innerHTML, /Kelsey/);
  assert.match(elements.content.innerHTML, /AUGUST 2026/);
  assert.equal((elements.content.innerHTML.match(/class="calendar-day filled/g) || []).length, 31);
  assert.match(elements.content.innerHTML, /class="calendar-day filled j-pushed k-done" data-date="2026-08-12"/);
  assert.match(elements.content.innerHTML, /class="calendar-day filled j-done k-rest today" data-date="2026-08-13"/);
  assert.match(elements.content.innerHTML, /class="calendar-day filled j-scheduled k-scheduled" data-date="2026-08-14"[^>]+#292e2b/);
  assert.doesNotMatch(elements.content.innerHTML, /j-scheduled[^>]+#65d995/);
  assert.match(elements.content.innerHTML, /Completed/);
  assert.match(elements.content.innerHTML, /Pushed/);
  assert.match(elements.content.innerHTML, /Consistency/);
  assert.match(elements.content.innerHTML, /Latest session/);
  assert.match(elements.content.innerHTML, /13\.1k/);
  assert.match(elements.content.innerHTML, /8\.4k/);
  assert.match(elements.content.innerHTML, /step-goal-marker jordan-step met/);
  assert.match(elements.content.innerHTML, /step-goal-marker kelsey-step under/);
});

test('missing step data is shown as not connected instead of a false zero', async () => {
  const source = await readFile(new URL('../app-legacy.js', import.meta.url), 'utf8');
  const workouts = JSON.parse(await readFile(new URL('../workouts.json', import.meta.url), 'utf8'));
  const elements = createElementMap();
  const TestDate = mutableDate('2026-08-13T12:00:00-07:00');

  class FakeXmlHttpRequest {
    open(_method, url) { this.url = url; }
    send() {
      this.readyState = 4;
      this.status = 200;
      if (this.url.startsWith('/workouts.json')) this.responseText = JSON.stringify(workouts);
      else if (this.url.startsWith('/api/workout-plan')) this.responseText = JSON.stringify({
        schemaVersion: 1, revision: 1, profileWeeks: {}, dateOverrides: {}, rescheduleEvents: [],
      });
      else if (this.url.startsWith('/api/workout-history')) this.responseText = JSON.stringify({
        profiles: { jordan: [], kelsey: [] },
      });
      else if (this.url.startsWith('/api/daily-steps')) this.responseText = JSON.stringify({
        goal: 12500, profiles: { jordan: [], kelsey: [] },
      });
      else this.responseText = JSON.stringify({ workouts: [], trends: {} });
      this.onreadystatechange();
    }
  }

  const context = {
    console,
    document: { getElementById: (id) => elements[id], addEventListener() {} },
    history: { replaceState() {} },
    location: { search: '', pathname: '/' },
    localStorage: { getItem() { return null; }, setItem() {} },
    XMLHttpRequest: FakeXmlHttpRequest,
    setInterval() {}, setTimeout() { return 1; }, clearTimeout() {}, Date: TestDate,
  };
  context.window = context;
  vm.runInNewContext(source, context);
  context.setView('progress');

  assert.equal((elements.content.innerHTML.match(/NOT CONNECTED/g) || []).length, 2);
  assert.doesNotMatch(elements.content.innerHTML, /Steps today<\/span><strong>—/);
});

test('TV autopilot shows the remaining person, then returns to shared progress', async () => {
  const source = await readFile(new URL('../app-legacy.js', import.meta.url), 'utf8');
  const workouts = JSON.parse(await readFile(new URL('../workouts.json', import.meta.url), 'utf8'));
  const elements = createElementMap();
  const storage = new Map([['shopProfile', 'jordan']]);
  const TestDate = mutableDate('2026-08-10T12:00:00-07:00');

  class FakeXmlHttpRequest {
    open(method, url) { this.method = method; this.url = url; }
    send() {
      this.readyState = 4;
      this.status = 200;
      if (this.url.startsWith('/workouts.json')) {
        this.responseText = JSON.stringify(workouts);
      } else if (this.url.startsWith('/api/workout-plan')) {
        this.responseText = JSON.stringify({
          schemaVersion: 1,
          revision: 1,
          profileWeeks: {},
          dateOverrides: {},
          rescheduleEvents: [],
        });
      } else if (this.url.startsWith('/api/workout-history')) {
        this.responseText = JSON.stringify({
          profiles: {
            jordan: [{ date: '2026-08-10', planName: 'Push', completionSource: 'manual' }],
            kelsey: [],
          },
        });
      } else if (this.url.startsWith('/api/daily-steps')) {
        this.responseText = JSON.stringify({ goal: 12500, profiles: { jordan: [], kelsey: [] } });
      } else {
        this.responseText = JSON.stringify({ workouts: [], trends: {} });
      }
      this.onreadystatechange();
    }
  }

  const context = {
    console,
    document: {
      getElementById: (id) => elements[id],
      addEventListener() {},
    },
    history: { replaceState() {} },
    location: { search: '', pathname: '/' },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
    XMLHttpRequest: FakeXmlHttpRequest,
    setInterval() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    Date: TestDate,
  };
  context.window = context;
  vm.runInNewContext(source, context);

  assert.equal(elements.hello.textContent, 'HELLO, KELSEY');
  assert.match(elements.content.innerHTML, /PUSH DAY/);
  assert.match(elements.content.innerHTML, /READY WHEN YOU ARE/);

  context.completeWorkout('manual');
  context.dismissCelebration();
  context.runTvAutopilot(true);
  assert.equal(elements.hello.textContent, 'HOUSEHOLD PROGRESS');
  assert.doesNotMatch(elements.content.innerHTML, /Shared progress|YOUR MONTH, TOGETHER|Two routines/);
});

test('five-way remote navigation, timer persistence, auto-advance, and undo work together', async () => {
  const source = await readFile(new URL('../app-legacy.js', import.meta.url), 'utf8');
  const workouts = JSON.parse(await readFile(new URL('../workouts.json', import.meta.url), 'utf8'));
  const elements = createElementMap();
  const storage = new Map();
  const intervals = [];
  const TestDate = mutableDate('2026-08-10T12:00:00-07:00');
  let keydown;

  class FakeXmlHttpRequest {
    open(_method, url) {
      this.url = url;
    }

    send() {
      this.readyState = 4;
      this.status = 200;
      this.responseText = this.url.startsWith('/workouts.json')
        ? JSON.stringify(workouts)
        : JSON.stringify({});
      this.onreadystatechange();
    }
  }

  const context = {
    console,
    document: {
      getElementById: (id) => elements[id],
      addEventListener(type, listener) {
        if (type === 'keydown') keydown = listener;
      }
    },
    history: { replaceState() {} },
    location: { search: '?day=Monday&preview=1', pathname: '/' },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value)
    },
    XMLHttpRequest: FakeXmlHttpRequest,
    setInterval(callback) {
      intervals.push(callback);
    },
    setTimeout() { return 1; },
    clearTimeout() {},
    Date: TestDate
  };
  context.window = context;
  vm.runInNewContext(source, context);

  const press = (key, keyCode) => keydown({ key, keyCode, preventDefault() {} });

  assert.match(elements.content.innerHTML, /ambient-action primary remote-focus/);
  press('ArrowUp', 38);
  assert.match(elements.jordanBtn.className, /remote-focus/);
  press('ArrowLeft', 37);
  assert.match(elements.progressTab.className, /remote-focus/);
  press('ArrowRight', 39);
  press('ArrowDown', 40);
  assert.match(elements.content.innerHTML, /ambient-action primary remote-focus/);
  press('ArrowDown', 40);
  assert.match(elements.content.innerHTML, /Track individual sets/);
  press('Enter', 13);
  assert.match(elements.content.innerHTML, /exercise selected remote-focus/);

  press('Enter', 13);
  assert.match(elements.content.innerHTML, /Rest timer/);
  assert.match(elements.content.innerHTML, /1<\/strong><span>of 3 sets complete/);
  const uiKey = [...storage.keys()].find((key) => key.startsWith('shopSessionUI:jordan:'));
  const storedUi = JSON.parse(storage.get(uiKey));
  assert.ok(storedUi.restTimerEnd > TestDate.now());
  assert.equal(storedUi.lastAction.previousDone, 0);

  press('Enter', 13);
  assert.doesNotMatch(elements.content.innerHTML, /Rest timer/);
  press('Enter', 13);
  press('Enter', 13);
  press('Enter', 13);
  assert.match(elements.content.innerHTML, /Incline Dumbbell Press/);
  assert.match(elements.content.innerHTML, /Next: Incline Dumbbell Press/);

  press('Backspace', 8);
  assert.match(elements.content.innerHTML, /Dumbbell Bench Press/);
  assert.match(elements.content.innerHTML, /2<\/strong><span>of 3 sets complete/);
  assert.doesNotMatch(elements.content.innerHTML, /Rest timer/);
  assert.match(elements.toast.className, /visible/);

  assert.ok(intervals.length >= 3);
});

test('eligible WHOOP strength workouts automatically complete both household plans', async () => {
  const source = await readFile(new URL('../app-legacy.js', import.meta.url), 'utf8');
  const workouts = JSON.parse(await readFile(new URL('../workouts.json', import.meta.url), 'utf8'));
  const elements = createElementMap();
  const storage = new Map();
  const TestDate = mutableDate('2026-08-10T12:00:00-07:00');

  class FakeXmlHttpRequest {
    open(_method, url) { this.url = url; }
    send() {
      const target = this.url.includes('profile=kelsey') ? 'kelsey' : 'jordan';
      this.readyState = 4;
      this.status = 200;
      this.responseText = this.url.startsWith('/workouts.json')
        ? JSON.stringify(workouts)
        : JSON.stringify({
            workouts: [{
              id: `${target}-whoop-workout-1`,
              sport_name: 'Weightlifting',
              start: '2026-08-10T10:15:00-07:00',
              end: '2026-08-10T11:00:00-07:00'
            }],
            workoutAccess: true,
            trends: {}
          });
      this.onreadystatechange();
    }
  }

  const context = {
    console,
    document: {
      getElementById: (id) => elements[id],
      addEventListener() {}
    },
    history: { replaceState() {} },
    location: { search: '', pathname: '/' },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value)
    },
    XMLHttpRequest: FakeXmlHttpRequest,
    setInterval() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    Date: TestDate
  };
  context.window = context;
  vm.runInNewContext(source, context);

  assert.match(elements.content.innerHTML, /WORKOUT COMPLETE/);
  assert.match(elements.content.innerHTML, /Confirmed by WHOOP · Weightlifting/);
  assert.match(elements.celebrationSource.textContent, /WHOOP/);
  const jordanKey = [...storage.keys()].find((key) => key.startsWith('shopWorkout:jordan:'));
  const jordanState = JSON.parse(storage.get(jordanKey));
  assert.equal(jordanState.completionSource, 'whoop');
  assert.equal(jordanState.whoopWorkoutId, 'jordan-whoop-workout-1');

  const kelseyKey = [...storage.keys()].find((key) => key.startsWith('shopWorkout:kelsey:'));
  const kelseyState = JSON.parse(storage.get(kelseyKey));
  assert.equal(kelseyState.completionSource, 'whoop');
  assert.equal(kelseyState.whoopWorkoutId, 'kelsey-whoop-workout-1');
  assert.match(elements.householdStatus.innerHTML, /Jordan<strong>Done/);
  assert.match(elements.householdStatus.innerHTML, /Kelsey<strong>Done/);

  context.dismissCelebration();
  context.setProfile('kelsey');
  assert.match(elements.content.innerHTML, /WORKOUT COMPLETE/);
  assert.match(elements.content.innerHTML, /Confirmed by WHOOP · Weightlifting/);
});

test('an unconnected Kelsey profile shows a phone-only WHOOP connection QR code', async () => {
  const source = await readFile(new URL('../app-legacy.js', import.meta.url), 'utf8');
  const workouts = JSON.parse(await readFile(new URL('../workouts.json', import.meta.url), 'utf8'));
  const elements = createElementMap();
  const storage = new Map([['shopProfile', 'kelsey']]);
  const TestDate = mutableDate('2026-08-10T12:00:00-07:00');

  class FakeXmlHttpRequest {
    open(_method, url) { this.url = url; }
    send() {
      this.readyState = 4;
      if (this.url.startsWith('/workouts.json')) {
        this.status = 200;
        this.responseText = JSON.stringify(workouts);
      } else if (this.url.includes('profile=kelsey')) {
        this.status = 401;
        this.responseText = JSON.stringify({ error: 'Kelsey WHOOP is not connected.' });
      } else {
        this.status = 200;
        this.responseText = JSON.stringify({ workouts: [], trends: {} });
      }
      this.onreadystatechange();
    }
  }

  const context = {
    console,
    document: {
      getElementById: (id) => elements[id],
      addEventListener() {}
    },
    history: { replaceState() {} },
    location: { search: '', pathname: '/' },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value)
    },
    XMLHttpRequest: FakeXmlHttpRequest,
    setInterval() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    Date: TestDate
  };
  context.window = context;
  vm.runInNewContext(source, context);

  assert.equal(elements.whoopLive.textContent, 'KELSEY WHOOP · CONNECT');
  assert.match(elements.whoop.innerHTML, /Connect Kelsey WHOOP from her phone/);
  assert.match(elements.whoop.innerHTML, /\/api\/whoop-qr\?profile=kelsey/);
});

test('the unattended screen rolls to a fresh training day at 7 AM', async () => {
  const source = await readFile(new URL('../app-legacy.js', import.meta.url), 'utf8');
  const workouts = JSON.parse(await readFile(new URL('../workouts.json', import.meta.url), 'utf8'));
  const elements = createElementMap();
  const intervals = [];
  const TestDate = mutableDate('2026-08-10T06:59:00-07:00');

  class FakeXmlHttpRequest {
    open(_method, url) { this.url = url; }
    send() {
      this.readyState = 4;
      this.status = 200;
      this.responseText = this.url.startsWith('/workouts.json')
        ? JSON.stringify(workouts)
        : JSON.stringify({ workouts: [], trends: {} });
      this.onreadystatechange();
    }
  }

  const context = {
    console,
    document: {
      getElementById: (id) => elements[id],
      addEventListener() {}
    },
    history: { replaceState() {} },
    location: { search: '', pathname: '/' },
    localStorage: { getItem() { return null; }, setItem() {} },
    XMLHttpRequest: FakeXmlHttpRequest,
    setInterval(callback) { intervals.push(callback); },
    setTimeout() { return 1; },
    clearTimeout() {},
    Date: TestDate
  };
  context.window = context;
  vm.runInNewContext(source, context);

  assert.match(elements.content.innerHTML, /RECOVERY DAY/);
  TestDate.set('2026-08-10T07:01:00-07:00');
  for (const callback of intervals) callback();
  assert.match(elements.content.innerHTML, /PUSH DAY/);
  assert.match(elements.content.innerHTML, /READY WHEN YOU ARE/);
});

test('all seven day previews render without overflowing the exercise budget', async () => {
  const source = await readFile(new URL('../app-legacy.js', import.meta.url), 'utf8');
  const workouts = JSON.parse(await readFile(new URL('../workouts.json', import.meta.url), 'utf8'));
  const elements = createElementMap();

  class FakeXmlHttpRequest {
    open(_method, url) {
      this.url = url;
    }

    send() {
      this.readyState = 4;
      this.status = 200;
      this.responseText = this.url.startsWith('/workouts.json')
        ? JSON.stringify(workouts)
        : JSON.stringify({});
      this.onreadystatechange();
    }
  }

  const context = {
    console,
    document: {
      getElementById: (id) => elements[id],
      addEventListener() {}
    },
    history: { replaceState() {} },
    location: { search: '', pathname: '/' },
    localStorage: { getItem() { return null; }, setItem() {} },
    XMLHttpRequest: FakeXmlHttpRequest,
    setInterval() {}
  };
  context.window = context;
  vm.runInNewContext(source, context);

  for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
    context.setDay(day);
    assert.ok(elements.content.innerHTML.length > 200, `${day} should render a complete view`);
    assert.ok(
      (elements.content.innerHTML.match(/onclick="selectExercise\(/g) || []).length <= 5,
      `${day} exceeds the exercise row budget`
    );
  }
});

test('the TV applies live date exceptions without a refresh and keeps completion attached to its plan', async () => {
  const source = await readFile(new URL('../app-legacy.js', import.meta.url), 'utf8');
  const workouts = JSON.parse(await readFile(new URL('../workouts.json', import.meta.url), 'utf8'));
  const elements = createElementMap();
  const storage = new Map();
  const TestDate = mutableDate('2026-08-10T12:00:00-07:00');
  let liveConfig = {
    schemaVersion: 1,
    revision: 0,
    updatedAt: null,
    sharedSchedule: true,
    profileWeeks: {},
    dateOverrides: {}
  };

  class FakeXmlHttpRequest {
    open(_method, url) { this.url = url; }
    send() {
      this.readyState = 4;
      this.status = 200;
      if (this.url.startsWith('/workouts.json')) this.responseText = JSON.stringify(workouts);
      else if (this.url.startsWith('/api/workout-plan')) this.responseText = JSON.stringify(liveConfig);
      else this.responseText = JSON.stringify({ workouts: [], trends: {} });
      this.onreadystatechange();
    }
  }

  const context = {
    console,
    document: {
      getElementById: (id) => elements[id],
      addEventListener() {}
    },
    history: { replaceState() {} },
    location: { search: '', pathname: '/' },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value)
    },
    XMLHttpRequest: FakeXmlHttpRequest,
    setInterval() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    Date: TestDate
  };
  context.window = context;
  vm.runInNewContext(source, context);

  assert.match(elements.content.innerHTML, /PUSH DAY/);
  context.completeWorkout('manual');
  assert.equal(JSON.parse(storage.get('shopWorkout:jordan:2026-08-10')).planName, 'Push');

  liveConfig = {
    ...liveConfig,
    revision: 1,
    dateOverrides: {
      '2026-08-10': {
        jordan: clonePlan(workouts.profiles.jordan.week.Wednesday)
      }
    }
  };
  context.loadWorkoutPlan();

  assert.match(elements.content.innerHTML, /PULL DAY/);
  assert.match(elements.content.innerHTML, /READY WHEN YOU ARE/);
  assert.doesNotMatch(elements.content.innerHTML, /WORKOUT COMPLETE/);
});

test('Samsung TV completion stays inline and avoids the crash-prone full-screen celebration', async () => {
  const source = await readFile(new URL('../app-legacy.js', import.meta.url), 'utf8');
  const workouts = JSON.parse(await readFile(new URL('../workouts.json', import.meta.url), 'utf8'));
  const elements = createElementMap();
  const storage = new Map();
  const TestDate = mutableDate('2026-08-10T12:00:00-07:00');

  class FakeXmlHttpRequest {
    open(_method, url) { this.url = url; }
    send() {
      this.readyState = 4;
      this.status = 200;
      if (this.url.startsWith('/workouts.json')) this.responseText = JSON.stringify(workouts);
      else if (this.url.startsWith('/api/workout-plan')) {
        this.responseText = JSON.stringify({
          schemaVersion: 1,
          revision: 0,
          sharedSchedule: true,
          profileWeeks: {},
          dateOverrides: {}
        });
      } else this.responseText = JSON.stringify({ workouts: [], trends: {} });
      this.onreadystatechange();
    }
  }

  const context = {
    console,
    document: {
      getElementById: (id) => elements[id],
      addEventListener() {}
    },
    history: { replaceState() {} },
    location: { search: '', pathname: '/' },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value)
    },
    XMLHttpRequest: FakeXmlHttpRequest,
    innerWidth: 1280,
    navigator: {
      userAgent: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0) SamsungBrowser/1.1 TV Safari/538.1'
    },
    setInterval() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    Date: TestDate
  };
  context.window = context;
  vm.runInNewContext(source, context);

  context.completeWorkout('manual');

  assert.match(elements.content.innerHTML, /WORKOUT COMPLETE/);
  assert.doesNotMatch(elements.celebration.className, /visible/);
  assert.match(elements.toast.className, /visible/);
  assert.equal(elements.toast.textContent, 'Push workout complete · Saved');
  assert.equal(JSON.parse(storage.get('shopWorkout:jordan:2026-08-10')).completed, true);
});

function clonePlan(plan) {
  return JSON.parse(JSON.stringify(plan));
}
