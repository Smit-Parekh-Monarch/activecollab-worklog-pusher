// Pure overtime math, shared by the browser page and the Node test.
export const STANDARD_DAY = 8;     // hours in a normal workday
export const MIN_RELEASE = 25 / 60; // 25 min — a day's own OT at/over this pushes
                                    // that day; smaller OT banks until the bank reaches it

const r2 = (n) => +(+n).toFixed(2);

// "8:55" -> 8.92 (true decimal); decimals / numbers pass through.
export function parseHoursDecimal(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    if (v.includes(':')) { const [h, m] = v.split(':').map(Number); return r2(h + (m || 0) / 60); }
    return parseFloat(v) || 0;
  }
  return 0;
}

// 1.09 -> "1:05" (rounds to the nearest minute; negatives clamp to "0:00").
export function decimalToHHMM(dec) {
  const v = Math.max(0, +dec || 0);
  let h = Math.floor(v);
  let m = Math.round((v - h) * 60);
  if (m === 60) { h += 1; m = 0; }
  return `${h}:${String(m).padStart(2, '0')}`;
}

// ISO date for a worklog file: prefer its `date`, else parse a `d-m-yyyy` basename.
export function isoDateFromFile(file) {
  if (file && file.date && /^\d{4}-\d{2}-\d{2}/.test(file.date)) return file.date.slice(0, 10);
  const rel = (file && file.rel) || '';
  const base = rel.split('/').pop() || '';
  const m = base.match(/^(\d{1,2})-(\d{1,2})-(\d{4})\.json$/i);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// True for Saturday/Sunday. Parses YYYY-MM-DD by component via Date.UTC so the
// weekday never shifts with the local timezone.
export function isWeekend(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate || '');
  if (!m) return false;
  const day = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
  return day === 0 || day === 6;
}

export function monthKeyOf(file) {
  const iso = isoDateFromFile(file);
  return iso ? iso.slice(0, 7) : null;
}

// Map of YYYY-MM -> files[], months in descending (newest-first) order.
export function groupByMonth(files) {
  const byMonth = new Map();
  for (const f of files) {
    const k = monthKeyOf(f);
    if (!k) continue;
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(f);
  }
  return new Map([...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])));
}

// days: [{ date, rel?, hours(decimal) }]. Chronological carry accumulator.
// Weekends (Sat/Sun) have no standard workday, so every weekend hour is overtime;
// the weekend standard defaults to 0 and is overridable via opts.weekendStandard.
//
// The rule (kept deliberately simple):
//   • A day's own overtime AT OR OVER 25 min is pushed THAT day, in full and
//     untouched — a 29-min, 1-hour or 2-hour day is its own expense and is never
//     carried into the next day or merged with the bank.
//   • Overtime UNDER 25 min goes into the bank (small bits accumulate).
//   • The bank releases as one expense on the day it first reaches 25 min.
//   • Anything left in the bank under 25 min at month end is `remainder`, not pushed.
//
// opts.netDeviation (default false):
//   false → only positive small bits add to the bank; short days are ignored.
//   true  → NET: short (under) days SUBTRACT from the bank (debt allowed), so an
//           under-day offsets the small banked bits that haven't released yet.
//           Big (>=25 min) overtime days are NOT touched by short days either way.
// Invariant in net mode: net === totalPushed + remainder.
export function computeMonthlyOvertime(days, opts = {}) {
  const standardDay = opts.standardDay ?? STANDARD_DAY;
  const weekendStandard = opts.weekendStandard ?? 0;
  const minRelease = opts.minRelease ?? MIN_RELEASE;
  const net2 = opts.netDeviation ?? false;
  const sorted = [...days].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const base = sorted.map((d) => {
    const weekend = isWeekend(d.date);
    const standard = weekend ? weekendStandard : standardDay;
    const hours = r2(d.hours);
    const deviation = r2(hours - standard);
    return { date: d.date, rel: d.rel, hours, deviation, isWeekend: weekend, standard };
  });

  let bank = 0, net = 0, totalPushed = 0;
  const rows = base.map((r) => {
    net = r2(net + r.deviation);
    let pushedOT = 0;
    if (r.deviation >= minRelease - 1e-9) {
      // big day: push its own overtime, in full — leave the bank alone
      pushedOT = r.deviation;
    } else {
      // small positive bit (or, in net mode, a short day) → bank it
      bank = r2(bank + (net2 ? r.deviation : Math.max(0, r.deviation)));
      if (bank >= minRelease - 1e-9) { pushedOT = bank; bank = 0; }
    }
    totalPushed = r2(totalPushed + pushedOT);
    return { ...r, carryAfter: bank, pushedOT: r2(pushedOT) };
  });
  return { rows, net: r2(net), totalPushed: r2(totalPushed), remainder: r2(bank) };
}
