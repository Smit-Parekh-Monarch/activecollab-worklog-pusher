import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHoursDecimal, decimalToHHMM, isoDateFromFile, monthKeyOf, groupByMonth,
  computeMonthlyOvertime, isWeekend, STANDARD_DAY, MIN_RELEASE,
} from '../public/overtime-core.js';

test('constants', () => {
  assert.equal(STANDARD_DAY, 8);
  assert.equal(MIN_RELEASE, 0.5);
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

test('computeMonthlyOvertime: accumulation releases at 30 min', () => {
  const r = computeMonthlyOvertime([
    { date: '2026-06-01', hours: 8.2 },
    { date: '2026-06-02', hours: 8.2 },
    { date: '2026-06-03', hours: 8.2 },
  ]);
  assert.deepEqual(r.rows.map(x => x.pushedOT), [0, 0, 0.6]);
  assert.deepEqual(r.rows.map(x => x.carryAfter), [0.2, 0.4, 0]);
  assert.equal(r.net, 0.6);
  assert.equal(r.totalPushed, 0.6);
  assert.equal(r.remainder, 0);
});

test('computeMonthlyOvertime: short day shown not pushed; big day releases', () => {
  const r = computeMonthlyOvertime([
    { date: '2026-06-01', hours: 8.2 },
    { date: '2026-06-02', hours: 5 },
    { date: '2026-06-03', hours: 10.9 },
  ]);
  assert.deepEqual(r.rows.map(x => x.deviation), [0.2, -3, 2.9]);
  assert.deepEqual(r.rows.map(x => x.pushedOT), [0, 0, 3.1]);
  assert.equal(r.net, 0.1);
  assert.equal(r.totalPushed, 3.1);
});

test('computeMonthlyOvertime: leftover under 30 min is remainder, not pushed', () => {
  const r = computeMonthlyOvertime([
    { date: '2026-06-01', hours: 8.1 },
    { date: '2026-06-02', hours: 8.1 },
  ]);
  assert.deepEqual(r.rows.map(x => x.pushedOT), [0, 0]);
  assert.equal(r.totalPushed, 0);
  assert.equal(r.remainder, 0.2);
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
