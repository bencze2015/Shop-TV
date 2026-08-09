import assert from 'node:assert/strict';
import { parse } from 'acorn';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('loads the legacy TV client before the inert modern source', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const legacyPosition = html.indexOf('<script src="/app-legacy.js"></script>');
  const modernPosition = html.indexOf('<script type="text/plain" id="modern-client">');
  const loaderPosition = html.indexOf("document.getElementById('modern-client')");

  assert.notEqual(legacyPosition, -1);
  assert.notEqual(modernPosition, -1);
  assert.notEqual(loaderPosition, -1);
  assert.ok(legacyPosition < modernPosition);
  assert.ok(modernPosition < loaderPosition);
});

test('legacy TV client avoids unsupported browser APIs and syntax', async () => {
  const source = await readFile(new URL('../app-legacy.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => parse(source, { ecmaVersion: 5, sourceType: 'script' }));
  const executableSource = source.replace(
    /new Function\([\s\S]*?\)\(\);/,
    'supportsModernSyntax = false;'
  );

  assert.doesNotMatch(executableSource, /\b(?:const|let|async|await)\b/);
  assert.doesNotMatch(executableSource, /=>|\?\.|\?\?|`/);
  assert.doesNotMatch(executableSource, /\b(?:fetch|URLSearchParams)\b/);
  assert.doesNotMatch(executableSource, /\.(?:includes|padStart)\s*\(/);
  assert.doesNotMatch(executableSource, /Number\.isFinite/);
});

test('CSS includes fallbacks for unsupported Samsung TV features', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(html, /body\{[^}]*padding:48px;padding:clamp/);
  assert.match(html, /\.screen\{width:100%;margin:0\}/);
  assert.doesNotMatch(html, /max-width:(?:1000|1100|1420)px/);
  assert.match(html, /\.hello\{[^}]*font-size:48px;font-size:clamp/);
  assert.match(html, /\.whoop\{[^}]*display:flex;[^}]*display:grid/);
  assert.match(html, /\.exercise\{[^}]*display:flex;display:grid/);
});

test('legacy TV client loads workouts and WHOOP data without modern APIs', async () => {
  const source = await readFile(new URL('../app-legacy.js', import.meta.url), 'utf8');
  const elementIds = [
    'programName', 'hello', 'date', 'jordanBtn', 'kelseyBtn', 'whoopLive',
    'todayTab', 'progressTab', 'whoop', 'content', 'preview'
  ];
  const elements = Object.fromEntries(elementIds.map((id) => [
    id,
    { className: '', textContent: '', innerHTML: '' }
  ]));
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
        ? JSON.stringify({
            programName: 'Shop Training',
            profiles: { jordan: { name: 'Jordan', week: {} } }
          })
        : JSON.stringify({
            recovery: { score: { recovery_score: 80, hrv_rmssd_milli: 45, resting_heart_rate: 55 } },
            cycle: { score: { strain: 10.2 } },
            sleep: { score: { sleep_performance_percentage: 90 } },
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
    Function: function UnsupportedModernSyntax() {
      throw new SyntaxError('Optional chaining is not supported');
    },
    setInterval() {}
  };
  context.window = context;

  vm.runInNewContext(source, context);

  assert.equal(elements.hello.textContent, 'HELLO, JORDAN');
  assert.equal(elements.whoop.className, 'whoop');
  assert.match(elements.whoop.innerHTML, /Recovery/);
  assert.match(elements.whoop.innerHTML, /80%/);
  assert.ok(requests.some((url) => url.startsWith('/workouts.json')));
  assert.ok(requests.some((url) => url.startsWith('/api/whoop-data')));
});
