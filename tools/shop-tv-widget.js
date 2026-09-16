// Shop TV — Scriptable home-screen widget.
//
// A glanceable widget: today's workout plan and whether Jordan and Kelsey have each completed
// it, in the app's own dark/mint visual style. Reads the same two public, unauthenticated
// endpoints the TV and Manager already use -- it never writes anything, so it cannot corrupt or
// interfere with the live plan.
//
// Setup (see the README section at the bottom of this file, or the PR description, for the
// plain-language version): install Scriptable from the App Store, create a new script, paste
// this whole file in, add a Scriptable widget (small or medium) to the home screen, and set it
// to run this script.
//
// This file replicates two small pieces of app-legacy.js's logic on purpose, so the widget shows
// exactly what the TV would show for "today" -- not an approximation:
//   1. The training day rolls over at 7 AM local time, not midnight (TRAINING_DAY_START_HOUR
//      below), so checking the widget at 2 AM still shows last night's (unfinished) session.
//   2. A date override (e.g. the Sept 25 - Oct 24 2026 travel block) always wins outright and is
//      never touched by the accessory-exercise rotation -- the rotation only ever applies to the
//      regular weekly plan. Getting this order backwards would silently show a dumbbell exercise
//      on a bodyweight travel day.

const BASE_URL = 'https://shop-tv-gamma.vercel.app';
const TRAINING_DAY_START_HOUR = 7;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const COLOR_BG = new Color('#080a0c');
const COLOR_MINT = new Color('#a9ffcf');
const COLOR_INK = new Color('#f5f7f4');
const COLOR_MUTED = new Color('#7c8581');
const COLOR_LINE = new Color('#222a27');
const COLOR_DANGER = new Color('#ff9b9b');

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function dateKey(date) {
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

// "Today" for training purposes -- shifted back so the day doesn't flip until 7 AM local.
function trainingDate(now) {
  const value = new Date((now || new Date()).getTime());
  value.setHours(value.getHours() - TRAINING_DAY_START_HOUR);
  return value;
}

function mondayFor(date) {
  const monday = new Date(date.getTime());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  monday.setHours(12, 0, 0, 0);
  return monday;
}

function dateFromKey(key) {
  const parts = String(key || '').split('-');
  if (parts.length !== 3) return null;
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0, 0);
}

async function fetchJSON(path) {
  const req = new Request(BASE_URL + path);
  req.timeoutInterval = 8;
  return req.loadJSON();
}

// Mirrors app-legacy.js's rotatedPlanForDate: swaps in the current week's accessory exercise for
// any slot whose planName matches, based on how many weeks have elapsed since the rotation's
// shared anchor date. Only ever called for the regular weekly plan, never for a date override.
function applyRotation(plan, date, accessoryRotation) {
  const result = JSON.parse(JSON.stringify(plan || { name: 'Rest', exercises: [] }));
  if (!accessoryRotation || !accessoryRotation.slots || !accessoryRotation.slots.length) return result;
  if (!result.exercises || !result.exercises.length) return result;
  const startsOn = dateFromKey(accessoryRotation.startsOn);
  if (!startsOn) return result;
  const weekNumber = Math.floor((mondayFor(date).getTime() - mondayFor(startsOn).getTime()) / (7 * 24 * 60 * 60 * 1000));
  if (weekNumber < 0) return result;
  for (const slot of accessoryRotation.slots) {
    if (!slot.cycleWeeks || !slot.cycleWeeks.length) continue;
    if (result.name === slot.planName && result.exercises.length > slot.exerciseIndex) {
      result.exercises[slot.exerciseIndex] = JSON.parse(JSON.stringify(slot.cycleWeeks[weekNumber % slot.cycleWeeks.length]));
    }
  }
  return result;
}

// Mirrors app-legacy.js's profilePlanForDate: a date override (e.g. the travel block) always
// wins outright; otherwise fall back to the profile's regular weekly plan, then apply rotation.
function resolvePlan(profileId, date, planConfig, workoutsJson) {
  const key = dateKey(date);
  const override = planConfig.dateOverrides && planConfig.dateOverrides[key];
  if (override && override[profileId]) return override[profileId];

  const week = (planConfig.profileWeeks && planConfig.profileWeeks[profileId])
    || (workoutsJson.profiles && workoutsJson.profiles[profileId] && workoutsJson.profiles[profileId].week);
  if (!week) return { name: 'Rest', exercises: [] };

  const dayName = DAY_NAMES[date.getDay()];
  const basePlan = week[dayName] || { name: 'Rest', exercises: [] };
  return applyRotation(basePlan, date, workoutsJson.accessoryRotation);
}

function completedOnDate(profileId, historyJson, key) {
  const entries = (historyJson.profiles && historyJson.profiles[profileId]) || [];
  return entries.some((entry) => entry.date === key);
}

function exerciseSummary(plan, limit) {
  if (!plan.exercises || !plan.exercises.length) return '';
  const names = plan.exercises.map((exercise) => exercise.name);
  return limit ? names.slice(0, limit).join(' · ') : names.join(' · ');
}

function addEyebrow(container, text) {
  const label = container.addText(text.toUpperCase());
  label.font = Font.heavySystemFont(10);
  label.textColor = COLOR_MINT;
  label.minimumScaleFactor = 0.8;
}

function addPersonRow(container, name, done) {
  const row = container.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.setPadding(6, 0, 6, 0);

  const dot = row.addText(done ? '●' : '○');
  dot.font = Font.systemFont(11);
  dot.textColor = done ? COLOR_MINT : COLOR_MUTED;
  row.addSpacer(6);

  const label = row.addText(name);
  label.font = Font.semiboldSystemFont(12);
  label.textColor = done ? COLOR_MINT : COLOR_INK;
  row.addSpacer();

  const status = row.addText(done ? 'Done' : 'Pending');
  status.font = Font.systemFont(9);
  status.textColor = done ? COLOR_MINT : COLOR_MUTED;
}

function buildErrorWidget(message) {
  const widget = new ListWidget();
  widget.backgroundColor = COLOR_BG;
  widget.setPadding(14, 14, 14, 14);

  addEyebrow(widget, 'Shop TV');
  widget.addSpacer(8);

  const title = widget.addText('Couldn’t load');
  title.font = Font.boldSystemFont(17);
  title.textColor = COLOR_DANGER;
  widget.addSpacer(4);

  const sub = widget.addText(message || 'Check your connection and try again.');
  sub.font = Font.systemFont(11);
  sub.textColor = COLOR_MUTED;
  sub.minimumScaleFactor = 0.8;

  widget.addSpacer();
  return widget;
}

function buildRestWidget(dayLabel) {
  const widget = new ListWidget();
  widget.backgroundColor = COLOR_BG;
  widget.setPadding(14, 14, 14, 14);

  addEyebrow(widget, dayLabel);
  widget.addSpacer(10);

  const title = widget.addText('Rest Day');
  title.font = Font.boldSystemFont(24);
  title.textColor = COLOR_INK;
  widget.addSpacer(4);

  const sub = widget.addText('No session scheduled today.');
  sub.font = Font.systemFont(11);
  sub.textColor = COLOR_MUTED;

  widget.addSpacer();
  return widget;
}

function buildTrainingWidget(family, dayLabel, plan, jordanDone, kelseyDone) {
  const widget = new ListWidget();
  widget.backgroundColor = COLOR_BG;
  widget.setPadding(14, 14, 14, 14);
  widget.url = BASE_URL + '/manage.html';

  addEyebrow(widget, dayLabel);
  widget.addSpacer(6);

  const title = widget.addText(plan.name);
  title.font = Font.boldSystemFont(family === 'small' ? 22 : 28);
  title.textColor = COLOR_INK;
  title.minimumScaleFactor = 0.7;

  const summaryLimit = family === 'small' ? 2 : undefined;
  const summary = exerciseSummary(plan, summaryLimit);
  if (summary) {
    widget.addSpacer(4);
    const ex = widget.addText(summary);
    ex.font = Font.systemFont(family === 'small' ? 10 : 12);
    ex.textColor = COLOR_MUTED;
    ex.lineLimit = family === 'small' ? 2 : 3;
    ex.minimumScaleFactor = 0.8;
  }

  widget.addSpacer(family === 'small' ? 8 : 14);

  const divider = widget.addStack();
  divider.size = new Size(0, 1);
  divider.backgroundColor = COLOR_LINE;
  widget.addSpacer(family === 'small' ? 6 : 10);

  addPersonRow(widget, 'Jordan', jordanDone);
  addPersonRow(widget, 'Kelsey', kelseyDone);

  widget.addSpacer();
  return widget;
}

async function run() {
  const family = (typeof config !== 'undefined' && config.widgetFamily) || 'medium';

  let planConfig;
  let workoutsJson;
  let historyJson;
  try {
    [planConfig, workoutsJson, historyJson] = await Promise.all([
      fetchJSON('/api/workout-plan'),
      fetchJSON('/workouts.json'),
      fetchJSON('/api/workout-history'),
    ]);
  } catch (error) {
    const widget = buildErrorWidget('Shop TV is unreachable right now.');
    Script.setWidget(widget);
    if (!config.runsInWidget) await widget.presentMedium();
    Script.complete();
    return;
  }

  const now = trainingDate();
  const key = dateKey(now);
  const dayLabel = DAY_NAMES[now.getDay()] + ' · ' + (now.getMonth() + 1) + '/' + now.getDate();

  const jordanPlan = resolvePlan('jordan', now, planConfig, workoutsJson);
  const kelseyPlan = resolvePlan('kelsey', now, planConfig, workoutsJson);

  // Both profiles train the same named day on any date that isn't individually customized, so
  // the headline plan uses Jordan's resolution; completion is always tracked and shown per person.
  const headlinePlan = (jordanPlan.exercises && jordanPlan.exercises.length) ? jordanPlan : kelseyPlan;

  let widget;
  if (!headlinePlan.exercises || !headlinePlan.exercises.length) {
    widget = buildRestWidget(dayLabel);
  } else {
    const jordanDone = completedOnDate('jordan', historyJson, key);
    const kelseyDone = completedOnDate('kelsey', historyJson, key);
    widget = buildTrainingWidget(family, dayLabel, headlinePlan, jordanDone, kelseyDone);
  }

  Script.setWidget(widget);
  if (!config.runsInWidget) {
    if (family === 'small') await widget.presentSmall();
    else await widget.presentMedium();
  }
  Script.complete();
}

await run();

/*
SETUP -- READ THIS TO JORDAN

1. Open the App Store, search "Scriptable", install it (it's free, made by Simon Support / Read
   It Later, no account needed).
2. Open Scriptable, tap the "+" in the top right to create a new script.
3. Tap the new script, select all the placeholder text, delete it, and paste in this entire file.
4. Rename the script (tap the name at the top) to something like "Shop TV".
5. Go to the iPhone home screen, long-press an empty area, tap the "+" in the top corner, search
   for "Scriptable", and add either the small or medium widget size.
6. Long-press the new widget, tap "Edit Widget", and set "Script" to the "Shop TV" script you
   just created. Leave "When Interacting" on "Run Script".

No developer account, no Xcode, no sideloading -- Scriptable is a normal free App Store app and
this is just a script running inside it, the same as any other iOS Shortcut or automation.
*/
