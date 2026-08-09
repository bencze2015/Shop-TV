import assert from 'node:assert/strict';
import { parse } from 'acorn';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const elementIds = [
  'planName', 'hello', 'date', 'clock', 'preview', 'jordanBtn', 'kelseyBtn',
  'whoopLive', 'todayTab', 'progressTab', 'whoop', 'content', 'controlHint'
];

function createElementMap() {
  return Object.fromEntries(elementIds.map((id) => [
    id,
    { className: '', textContent: '', innerHTML: '' }
  ]));
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
  assert.match(html, /\.exercise\{[^}]*flex:1;min-height:0;[^}]*display:flex/);
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

test('TV client renders training, rest, progress, WHOOP, and set completion flows', async () => {
  const source = await readFile(new URL('../app-legacy.js', import.meta.url), 'utf8');
  const workouts = JSON.parse(await readFile(new URL('../workouts.json', import.meta.url), 'utf8'));
  const elements = createElementMap();
  const requests = [];
  const storage = new Map();

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
            }
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
    setInterval() {}
  };
  context.window = context;

  vm.runInNewContext(source, context);

  assert.equal(elements.hello.textContent, 'HELLO, JORDAN');
  assert.equal(elements.whoop.className, 'whoop');
  assert.match(elements.whoop.innerHTML, /Recovery/);
  assert.match(elements.whoop.innerHTML, /80%/);

  context.setDay('Monday');
  assert.match(elements.content.innerHTML, /PUSH SESSION/);
  assert.match(elements.content.innerHTML, /class="focus-card"/);
  assert.match(elements.content.innerHTML, /Dumbbell Bench Press/);
  assert.match(elements.content.innerHTML, /Est\. time/);
  assert.equal((elements.content.innerHTML.match(/onclick="selectExercise\(/g) || []).length, 5);

  context.completeSet();
  assert.match(elements.content.innerHTML, /1<\/strong><span>of 3 sets complete/);
  assert.match(elements.content.innerHTML, /set-segment done/);

  context.setDay('Sunday');
  assert.match(elements.content.innerHTML, /RECOVERY DAY/);
  assert.match(elements.content.innerHTML, /class="week-strip"/);
  assert.match(elements.content.innerHTML, /Monday/);
  assert.match(elements.content.innerHTML, /Push Session/);

  context.setView('progress');
  assert.match(elements.content.innerHTML, /TRAINING OVERVIEW/);
  assert.match(elements.content.innerHTML, /Weekly completion/);
  assert.match(elements.content.innerHTML, /HRV vs baseline/);

  assert.ok(requests.some((url) => url.startsWith('/workouts.json')));
  assert.ok(requests.some((url) => url.startsWith('/api/whoop-data')));
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
