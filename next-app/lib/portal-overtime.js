// Overtime math for the /portal-hours test page. Intentionally SIMPLER than
// lib/overtime-core's banking model:
//   • weekday standard 8h; weekend standard 0 (every weekend hour is overtime)
//   • a day whose overtime is >= 25 min is PUSHABLE that day, in full
//   • a day whose overtime is > 0 but < 25 min just ADDS to the bank
//   • the bank NEVER auto-releases — it only accumulates; the user releases it
//     manually, so nothing here ever moves banked time into a push
//   • short (negative) days are reported but do NOT touch the bank
import { isWeekend } from './overtime-core.js';

export const STANDARD_DAY = 8;
export const PORTAL_MIN_PUSH = 25 / 60; // 25 minutes

const r2 = (n) => +(+n).toFixed(2);

// days: [{ date, hours(decimal), tasks?, topTask? }]
export function computePortalOvertime(days, opts = {}) {
  const standardDay = opts.standardDay ?? STANDARD_DAY;
  const weekendStandard = opts.weekendStandard ?? 0;
  const minPush = opts.minPush ?? PORTAL_MIN_PUSH;
  const sorted = [...days].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  let totalLogged = 0, totalPush = 0, bankTotal = 0, totalShort = 0, daysToPush = 0;
  const rows = sorted.map((d) => {
    const weekend = isWeekend(d.date);
    const standard = weekend ? weekendStandard : standardDay;
    const hours = r2(d.hours);
    const deviation = r2(hours - standard);
    totalLogged = r2(totalLogged + hours);

    let status, pushOT = 0, banked = 0;
    if (deviation >= minPush - 1e-9) {
      status = 'push'; pushOT = deviation; totalPush = r2(totalPush + pushOT); daysToPush++;
    } else if (deviation > 1e-9) {
      status = 'bank'; banked = deviation; bankTotal = r2(bankTotal + banked);
    } else if (deviation < -1e-9) {
      status = 'short'; totalShort = r2(totalShort - deviation);
    } else {
      status = 'on';
    }
    return { ...d, hours, deviation, isWeekend: weekend, standard, status, pushOT, banked };
  });

  return { rows, totalLogged, totalPush, bankTotal, totalShort, daysToPush };
}
