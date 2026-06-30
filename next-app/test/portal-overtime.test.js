import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePortalOvertime, PORTAL_MIN_PUSH } from '../lib/portal-overtime.js';

// The portal-hours rule (deliberately simpler than the main overtime core):
//   • weekday standard 8h, weekend standard 0 (every weekend hour is overtime)
//   • a day whose overtime is >= 25 min is PUSHABLE that day, in full
//   • a day whose overtime is > 0 but < 25 min just ADDS to the bank
//   • the bank NEVER auto-releases — it only accumulates (handled manually)
//   • short (negative) days are shown but do NOT touch the bank

test('PORTAL_MIN_PUSH is 25 minutes', () => {
  assert.equal(PORTAL_MIN_PUSH, 25 / 60);
});

test('a day at/over 25 min is pushable in full', () => {
  const r = computePortalOvertime([{ date: '2026-06-01', hours: 8.55 }]); // +0:33
  assert.equal(r.rows[0].status, 'push');
  assert.equal(r.rows[0].pushOT, 0.55);
  assert.equal(r.rows[0].banked, 0);
  assert.equal(r.totalPush, 0.55);
  assert.equal(r.bankTotal, 0);
});

test('a day exactly at 25 min pushes (boundary)', () => {
  const r = computePortalOvertime([{ date: '2026-06-01', hours: 8 + 25 / 60 }]);
  assert.equal(r.rows[0].status, 'push');
});

test('a day under 25 min banks and never releases', () => {
  const r = computePortalOvertime([
    { date: '2026-06-03', hours: 8.17 }, // +0:10 bank
    { date: '2026-06-04', hours: 8.2 },  // +0:12 bank
    { date: '2026-06-10', hours: 8.17 }, // +0:10 bank -> total 0:32 but NOT released
  ]);
  assert.deepEqual(r.rows.map((x) => x.status), ['bank', 'bank', 'bank']);
  assert.deepEqual(r.rows.map((x) => x.pushOT), [0, 0, 0]);
  assert.equal(r.totalPush, 0);
  assert.equal(r.bankTotal, 0.54); // +0.17 +0.20 +0.17 banked, never released
});

test('big days push while small bits bank independently (no interaction)', () => {
  const r = computePortalOvertime([
    { date: '2026-06-03', hours: 8.17 }, // +0:10 bank
    { date: '2026-06-09', hours: 9.01 }, // +1:01 push (untouched by bank)
    { date: '2026-06-10', hours: 8.17 }, // +0:10 bank
  ]);
  const by = Object.fromEntries(r.rows.map((x) => [x.date, x]));
  assert.equal(by['2026-06-09'].pushOT, 1.01);
  assert.equal(by['2026-06-09'].status, 'push');
  assert.equal(r.bankTotal, 0.34); // +0.17 +0.17 banked
  assert.equal(r.totalPush, 1.01);
});

test('short (under) days are shown but do not touch the bank', () => {
  const r = computePortalOvertime([
    { date: '2026-06-03', hours: 8.17 }, // +0:10 bank
    { date: '2026-06-11', hours: 7 },    // -1:00 short
  ]);
  const by = Object.fromEntries(r.rows.map((x) => [x.date, x]));
  assert.equal(by['2026-06-11'].status, 'short');
  assert.equal(by['2026-06-11'].deviation, -1);
  assert.equal(r.bankTotal, 0.17); // unchanged by the short day
  assert.equal(r.totalShort, 1);   // total under-hours reported separately
});

test('weekend: every hour is overtime; a 9:10 Saturday is pushable in full', () => {
  const r = computePortalOvertime([{ date: '2026-06-27', hours: 9.17 }]); // Saturday
  assert.equal(r.rows[0].isWeekend, true);
  assert.equal(r.rows[0].standard, 0);
  assert.equal(r.rows[0].deviation, 9.17);
  assert.equal(r.rows[0].status, 'push');
  assert.equal(r.totalPush, 9.17);
});

test('exactly 8h weekday is neutral (on target)', () => {
  const r = computePortalOvertime([{ date: '2026-06-05', hours: 8 }]);
  assert.equal(r.rows[0].status, 'on');
  assert.equal(r.totalPush, 0);
  assert.equal(r.bankTotal, 0);
});

test('totals: logged sums every day; sorts by date', () => {
  const r = computePortalOvertime([
    { date: '2026-06-02', hours: 8.5 },
    { date: '2026-06-01', hours: 8 },
  ]);
  assert.deepEqual(r.rows.map((x) => x.date), ['2026-06-01', '2026-06-02']);
  assert.equal(r.totalLogged, 16.5);
});
