import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHoursDecimal, decimalToHHMM, isoDateFromFile, monthKeyOf, groupByMonth,
  computeMonthlyOvertime, isWeekend, STANDARD_DAY, MIN_RELEASE,
} from '../lib/overtime-core.js';

test('constants', () => {
  assert.equal(STANDARD_DAY, 8);
  assert.equal(MIN_RELEASE, 25 / 60); // 25 minutes
});

test('parseHoursDecimal', () => {
  assert.equal(parseHoursDecimal('8:55'), 8.92);
  assert.equal(parseHoursDecimal('3:30'), 3.5);
  assert.equal(parseHoursDecimal('3.5'), 3.5);
  assert.equal(parseHoursDecimal(2), 2);
  assert.equal(parseHoursDecimal(''), 0);
});

test('decimalToHHMM', () => {
  assert.equal(decimalToHHMM(1.09), '1:05');   // 1h 5.4m -> rounds to 1:05
  assert.equal(decimalToHHMM(0.5), '0:30');
  assert.equal(decimalToHHMM(0.92), '0:55');
  assert.equal(decimalToHHMM(2), '2:00');
  assert.equal(decimalToHHMM(0.999), '1:00');  // 59.94m rounds up, carries
  assert.equal(decimalToHHMM(-3), '0:00');     // negatives clamp to zero
});

// round-trip: typing time -> decimal -> time is stable to the minute
test('parseHoursDecimal/decimalToHHMM round-trip', () => {
  assert.equal(decimalToHHMM(parseHoursDecimal('0:30')), '0:30');
  assert.equal(decimalToHHMM(parseHoursDecimal('1:45')), '1:45');
});

test('isoDateFromFile prefers date, falls back to rel basename', () => {
  assert.equal(isoDateFromFile({ date: '2026-06-18' }), '2026-06-18');
  assert.equal(isoDateFromFile({ rel: 'june/week-1/1-6-2026.json' }), '2026-06-01');
  assert.equal(isoDateFromFile({ rel: 'x/25-6-2026.json' }), '2026-06-25');
  assert.equal(isoDateFromFile({ rel: 'nope.json' }), null);
});

test('monthKeyOf and groupByMonth (descending)', () => {
  assert.equal(monthKeyOf({ date: '2026-06-18' }), '2026-06');
  const files = [
    { date: '2026-05-02' }, { date: '2026-06-18' }, { date: '2026-06-01' },
  ];
  const g = groupByMonth(files);
  assert.deepEqual([...g.keys()], ['2026-06', '2026-05']);
  assert.equal(g.get('2026-06').length, 2);
});

// ---- the banking rule -------------------------------------------------------
// A day's own overtime >= 25 min is pushed that day, untouched. Overtime under
// 25 min banks; short days subtract from the bank; the bank releases once it
// reaches 25 min.

test('computeMonthlyOvertime: small bits (<25min) bank and release once they reach 25 min', () => {
  const r = computeMonthlyOvertime([
    { date: '2026-06-01', hours: 8.2 }, // +0:12 -> bank
    { date: '2026-06-02', hours: 8.2 }, // +0:12 -> bank 0:24 (still <25)
    { date: '2026-06-03', hours: 8.2 }, // +0:12 -> bank 0:36 -> release
  ]);
  assert.deepEqual(r.rows.map(x => x.pushedOT), [0, 0, 0.6]);
  assert.deepEqual(r.rows.map(x => x.carryAfter), [0.2, 0.4, 0]);
  assert.equal(r.net, 0.6);
  assert.equal(r.totalPushed, 0.6);
  assert.equal(r.remainder, 0);
});

test('computeMonthlyOvertime: a day at/over 25 min pushes that day, the smaller bank is left alone', () => {
  const r = computeMonthlyOvertime([
    { date: '2026-06-01', hours: 8.4 },  // +0:24 (<25) -> banks
    { date: '2026-06-02', hours: 8.45 }, // +0:27 (>=25) -> pushes its own, bank untouched
  ]);
  assert.deepEqual(r.rows.map(x => x.pushedOT), [0, 0.45]);
  assert.deepEqual(r.rows.map(x => x.carryAfter), [0.4, 0.4]);
  assert.equal(r.remainder, 0.4); // the 0:24 bit is still banked, not pushed
});

test('computeMonthlyOvertime: 29 minutes is pushed immediately, never carried into the next day', () => {
  const r = computeMonthlyOvertime([
    { date: '2026-06-01', hours: 8.48 }, // +0:29 (>=25) -> push now
    { date: '2026-06-02', hours: 8.1 },  // +0:06 (<25)  -> banks (no leftover from day 1)
  ]);
  assert.equal(r.rows[0].pushedOT, 0.48);
  assert.equal(r.rows[0].carryAfter, 0);  // nothing carried forward
  assert.equal(r.rows[1].pushedOT, 0);
  assert.equal(r.rows[1].carryAfter, 0.1);
});

test('computeMonthlyOvertime: a short day offsets the banked small bits (net)', () => {
  const days = [
    { date: '2026-06-01', hours: 8.3 }, // +0:18 banks
    { date: '2026-06-02', hours: 7.9 }, // -0:06 eats into the bank
    { date: '2026-06-03', hours: 8.3 }, // +0:18 -> bank 0:30 -> release
  ];
  const net = computeMonthlyOvertime(days, { netDeviation: true });
  const ignore = computeMonthlyOvertime(days, { netDeviation: false });
  assert.equal(ignore.totalPushed, 0.6); // short ignored -> releases 0.6
  assert.equal(net.totalPushed, 0.5);    // short subtracted -> releases 0.5
  assert.equal(net.net, +(net.totalPushed + net.remainder).toFixed(2)); // invariant
});

test('computeMonthlyOvertime: a big overtime day is pushed in full and does NOT absorb the bank', () => {
  // mirrors the real June run: small bits bank through Jun 3-4, Jun 9 is a 1:01
  // overtime day, Jun 10 is another small bit.
  const r = computeMonthlyOvertime([
    { date: '2026-06-03', hours: 8.17 }, // +0:10 bank 0:10
    { date: '2026-06-04', hours: 8.20 }, // +0:12 bank 0:22
    { date: '2026-06-09', hours: 9.01 }, // +1:01 (>=25) push 1:01, bank stays 0:22
    { date: '2026-06-10', hours: 8.17 }, // +0:10 bank 0:32 -> release 0:32
  ], { netDeviation: true });
  const by = Object.fromEntries(r.rows.map((x) => [x.date, x]));
  assert.equal(by['2026-06-09'].pushedOT, 1.01);   // pushed in full, untouched
  assert.equal(by['2026-06-09'].carryAfter, 0.37); // bank NOT flushed by the big day
  assert.equal(by['2026-06-10'].pushedOT, 0.54);   // 0:22 + 0:10 releases here
  assert.equal(r.net, +(r.totalPushed + r.remainder).toFixed(2)); // invariant
});

test('computeMonthlyOvertime: leftover under 25 min at month end is remainder, not pushed', () => {
  const r = computeMonthlyOvertime([
    { date: '2026-06-01', hours: 8.1 },
    { date: '2026-06-02', hours: 8.1 },
  ]);
  assert.deepEqual(r.rows.map(x => x.pushedOT), [0, 0]);
  assert.equal(r.totalPushed, 0);
  assert.equal(r.remainder, 0.2);
});

test('computeMonthlyOvertime: a big day still pushes while a deficit stays as bank debt (net)', () => {
  const r = computeMonthlyOvertime([
    { date: '2026-06-01', hours: 5 },   // Mon -3  -> bank debt -3
    { date: '2026-06-02', hours: 10 },  // Tue +2  -> big day, pushes its own 2
  ], { netDeviation: true });
  assert.equal(r.totalPushed, 2);
  assert.equal(r.net, -1);
  assert.equal(r.remainder, -3);                 // debt is not repaid by a big OT day
  assert.equal(r.net, +(r.totalPushed + r.remainder).toFixed(2)); // invariant
});

test('isWeekend: Sat/Sun true, weekdays false (no tz drift)', () => {
  assert.equal(isWeekend('2026-06-27'), true);   // Saturday
  assert.equal(isWeekend('2026-06-28'), true);   // Sunday
  assert.equal(isWeekend('2026-06-26'), false);  // Friday
  assert.equal(isWeekend('2026-06-22'), false);  // Monday
});

test('computeMonthlyOvertime: weekend day has 0 standard, pushes all its hours', () => {
  const r = computeMonthlyOvertime([
    { date: '2026-06-26', hours: 8 },     // Fri, exactly standard -> neutral
    { date: '2026-06-27', hours: 9.17 },  // Sat (9:10) -> all overtime
  ]);
  assert.deepEqual(r.rows.map(x => x.deviation), [0, 9.17]);
  assert.deepEqual(r.rows.map(x => x.pushedOT), [0, 9.17]);
  assert.deepEqual(r.rows.map(x => x.isWeekend), [false, true]);
  assert.deepEqual(r.rows.map(x => x.standard), [8, 0]);
  assert.equal(r.net, 9.17);
  assert.equal(r.totalPushed, 9.17);
  assert.equal(r.remainder, 0);
});

test('computeMonthlyOvertime: weekendStandard is overridable via opts', () => {
  const r = computeMonthlyOvertime(
    [{ date: '2026-06-27', hours: 9.17 }],
    { weekendStandard: 8 },
  );
  assert.equal(r.rows[0].deviation, 1.17);
  assert.equal(r.rows[0].standard, 8);
});

test('computeMonthlyOvertime: exactly 8h is neutral; sorts by date', () => {
  const r = computeMonthlyOvertime([
    { date: '2026-06-02', hours: 9 },
    { date: '2026-06-01', hours: 8 },
  ]);
  assert.deepEqual(r.rows.map(x => x.date), ['2026-06-01', '2026-06-02']);
  assert.deepEqual(r.rows.map(x => x.pushedOT), [0, 1]);
  assert.equal(r.remainder, 0);
});
