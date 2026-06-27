// Pure overtime math, shared by the browser page and the Node test.
export const STANDARD_DAY = 8;   // hours in a normal workday
export const MIN_RELEASE = 0.5;  // overtime is only "released" once carry >= 30 min

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
export function computeMonthlyOvertime(days, opts = {}) {
  const standardDay = opts.standardDay ?? STANDARD_DAY;
  const minRelease = opts.minRelease ?? MIN_RELEASE;
  const sorted = [...days].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  let carry = 0, net = 0, totalPushed = 0;
  const rows = sorted.map((d) => {
    const hours = r2(d.hours);
    const deviation = r2(hours - standardDay);
    net = r2(net + deviation);
    carry = r2(carry + Math.max(0, deviation)); // only positive OT accumulates
    let pushedOT = 0;
    if (carry >= minRelease - 1e-9) { pushedOT = carry; carry = 0; }
    totalPushed = r2(totalPushed + pushedOT);
    return { date: d.date, rel: d.rel, hours, deviation, carryAfter: carry, pushedOT };
  });
  return { rows, net: r2(net), totalPushed: r2(totalPushed), remainder: r2(carry) };
}
