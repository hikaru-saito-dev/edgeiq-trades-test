/**
 * Market hours utility for US equity options trading
 * Market hours: 09:30 - 16:00 EST (Eastern Standard Time)
 * Note: EST is UTC-5, EDT (daylight saving) is UTC-4
 */

/**
 * Convert UTC timestamp to EST/EDT
 * @param utcTimestamp - UTC Date object
 * @returns Date object representing EST/EDT time
 */
export function convertToEST(utcTimestamp: Date): Date {
  // Use Intl.DateTimeFormat to get EST/EDT time components
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(utcTimestamp);
  const year = parseInt(parts.find(p => p.type === 'year')?.value || '0');
  const month = parseInt(parts.find(p => p.type === 'month')?.value || '0') - 1; // 0-indexed
  const day = parseInt(parts.find(p => p.type === 'day')?.value || '0');
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
  const second = parseInt(parts.find(p => p.type === 'second')?.value || '0');

  // Create a date in UTC that represents the EST/EDT time
  return new Date(Date.UTC(year, month, day, hour, minute, second));
}

/**
 * Internal helper: get New York (EST/EDT) date parts for a given timestamp.
 */
function getNewYorkDateParts(timestamp: Date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(timestamp);
  const year = parseInt(parts.find(p => p.type === 'year')?.value || '0');
  const month = parseInt(parts.find(p => p.type === 'month')?.value || '0'); // 1-indexed
  const day = parseInt(parts.find(p => p.type === 'day')?.value || '0');
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
  const second = parseInt(parts.find(p => p.type === 'second')?.value || '0');
  const weekday = parts.find(p => p.type === 'weekday')?.value || '';

  return { year, month, day, hour, minute, second, weekday };
}

/**
 * NYSE holiday helpers (regular hours + early closes at 1:00 PM ET).
 * We include commonly observed US market holidays.
 */
function getObservedDate(date: Date): Date {
  const day = date.getUTCDay(); // 0 Sun, 6 Sat
  if (day === 6) {
    // Saturday -> observed Friday
    return new Date(date.getTime() - 24 * 60 * 60 * 1000);
  }
  if (day === 0) {
    // Sunday -> observed Monday
    return new Date(date.getTime() + 24 * 60 * 60 * 1000);
  }
  return date;
}

function getNthWeekdayOfMonth(year: number, month: number, weekday: number, n: number) {
  // month: 0-11, weekday: 0=Sun
  const firstDay = new Date(Date.UTC(year, month, 1));
  const firstWeekday = firstDay.getUTCDay();
  const offset = (7 + weekday - firstWeekday) % 7;
  const day = 1 + offset + (n - 1) * 7;
  return new Date(Date.UTC(year, month, day));
}

function getLastWeekdayOfMonth(year: number, month: number, weekday: number) {
  const firstNextMonth = new Date(Date.UTC(year, month + 1, 1));
  const lastDay = new Date(firstNextMonth.getTime() - 24 * 60 * 60 * 1000);
  const lastWeekday = lastDay.getUTCDay();
  const offset = (7 + lastWeekday - weekday) % 7;
  const day = lastDay.getUTCDate() - offset;
  return new Date(Date.UTC(year, month, day));
}

function formatDateUTC(date: Date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

// Early close (1:00 PM ET) helpers
// Day after Thanksgiving (Friday) and Christmas Eve (Dec 24 if weekday)
function getDayAfterThanksgiving(year: number): Date {
  // Thanksgiving: 4th Thursday of November
  const thanksgiving = getNthWeekdayOfMonth(year, 10, 4, 4); // month 10 = November, weekday 4 = Thu
  return new Date(thanksgiving.getTime() + 24 * 60 * 60 * 1000); // Friday
}

function getChristmasEve(year: number): Date | null {
  const date = new Date(Date.UTC(year, 11, 24));
  const day = date.getUTCDay();
  // If weekend, markets are usually closed/observed differently; skip early close
  if (day === 0 || day === 6) return null;
  return date;
}

function getEarlyCloseMap(year: number): Set<string> {
  const set = new Set<string>();
  const dayAfterTg = getDayAfterThanksgiving(year);
  set.add(formatDateUTC(dayAfterTg));
  const christmasEve = getChristmasEve(year);
  if (christmasEve) set.add(formatDateUTC(christmasEve));
  return set;
}

function isEarlyCloseDay(timestamp: Date): boolean {
  const parts = getNewYorkDateParts(timestamp);
  const dateKey = `${parts.year}-${parts.month.toString().padStart(2, '0')}-${parts.day
    .toString()
    .padStart(2, '0')}`;
  return getEarlyCloseMap(parts.year).has(dateKey);
}

function getSessionHours(timestamp: Date) {
  // Standard hours
  const openHour = 9;
  const openMinute = 30;
  const closeHour = isEarlyCloseDay(timestamp) ? 13 : 16; // 1:00 PM ET on early close
  const closeMinute = 0;
  return { openHour, openMinute, closeHour, closeMinute };
}

function getNyseHolidayMap(year: number): Set<string> {
  const holidays = new Set<string>();

  // Fixed-date holidays with observation
  const newYears = getObservedDate(new Date(Date.UTC(year, 0, 1)));
  holidays.add(formatDateUTC(newYears));

  const juneteenth = getObservedDate(new Date(Date.UTC(year, 5, 19)));
  holidays.add(formatDateUTC(juneteenth));

  const independenceDay = getObservedDate(new Date(Date.UTC(year, 6, 4)));
  holidays.add(formatDateUTC(independenceDay));

  const christmas = getObservedDate(new Date(Date.UTC(year, 11, 25)));
  holidays.add(formatDateUTC(christmas));

  // Floating holidays
  const mlk = getNthWeekdayOfMonth(year, 0, 1, 3); // 3rd Mon Jan
  holidays.add(formatDateUTC(mlk));

  const presidentsDay = getNthWeekdayOfMonth(year, 1, 1, 3); // 3rd Mon Feb
  holidays.add(formatDateUTC(presidentsDay));

  // Good Friday (two days before Easter Sunday). Approx via Anonymous Gregorian algorithm.
  const goodFriday = getGoodFriday(year);
  holidays.add(formatDateUTC(goodFriday));

  const memorialDay = getLastWeekdayOfMonth(year, 4, 1); // last Mon May
  holidays.add(formatDateUTC(memorialDay));

  const laborDay = getNthWeekdayOfMonth(year, 8, 1, 1); // 1st Mon Sep
  holidays.add(formatDateUTC(laborDay));

  const thanksgiving = getNthWeekdayOfMonth(year, 10, 4, 4); // 4th Thu Nov
  holidays.add(formatDateUTC(thanksgiving));

  return holidays;
}

// Compute Good Friday (2 days before Easter) using Anonymous Gregorian algorithm
function getGoodFriday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const easterSunday = new Date(Date.UTC(year, month - 1, day));
  const goodFriday = new Date(easterSunday.getTime() - 2 * 24 * 60 * 60 * 1000);
  return goodFriday;
}

function isMarketHoliday(timestamp: Date): boolean {
  const parts = getNewYorkDateParts(timestamp);
  const holidays = getNyseHolidayMap(parts.year);
  const dateKey = `${parts.year}-${parts.month.toString().padStart(2, '0')}-${parts.day
    .toString()
    .padStart(2, '0')}`;
  return holidays.has(dateKey);
}

/**
 * Check if market is currently open (09:30 - 16:00 ET; 13:00 ET on early-closes), excluding weekends and US market holidays.
 * NOTE: Set DISABLE_MARKET_HOURS_CHECK=true in .env.local to bypass market hours for testing
 */
export function isMarketOpen(timestamp?: Date): boolean {
  // Allow bypass via env for local/testing
  if (process.env.DISABLE_MARKET_HOURS_CHECK === 'true') {
    return true;
  }

  const checkTime = timestamp || new Date();

  // Get EST/EDT time components using Intl API
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(checkTime);
  const weekday = parts.find(p => p.type === 'weekday')?.value || '';
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');

  if (weekday === 'Sat' || weekday === 'Sun') {
    return false;
  }

  // Holiday check (New York date)
  if (isMarketHoliday(checkTime)) {
    return false;
  }

  const { openHour: marketOpenHour, openMinute: marketOpenMinute, closeHour: marketCloseHour, closeMinute: marketCloseMinute } = getSessionHours(checkTime);

  // Check if before market open
  if (hour < marketOpenHour || (hour === marketOpenHour && minute < marketOpenMinute)) {
    return false;
  }

  // Check if after market close
  if (hour > marketCloseHour || (hour === marketCloseHour && minute >= marketCloseMinute)) {
    return false;
  }

  return true;
}

/**
 * Get a real-time countdown label until the next market event.
 * - If market is open: countdown until close (16:00 EST)
 * - If market is closed: countdown until next open (09:30 EST on next business day)
 */
export function getMarketCountdown(now: Date = new Date()): { isOpen: boolean; label: string | null } {
  const isOpen = isMarketOpen(now);
  const { year, month, day, hour, minute, second, weekday } = getNewYorkDateParts(now);

  // Define market session times in New York local time (respect early close days)
  const { openHour, openMinute, closeHour, closeMinute } = getSessionHours(now);

  const makeNYDate = (y: number, m: number, d: number, h: number, min: number, s: number) =>
    new Date(Date.UTC(y, m - 1, d, h, min, s));

  let targetUtc: Date;
  let prefix: string;

  if (isOpen) {
    // Countdown until today's close (16:00)
    targetUtc = makeNYDate(year, month, day, closeHour, closeMinute, 0);
    prefix = 'Closes in';
  } else {
    // Find next open time (09:30 on next business day)
    // Start from today's NY date
    let targetYear = year;
    let targetMonth = month;
    let targetDay = day;

    const isWeekend = weekday === 'Sat' || weekday === 'Sun';

    if (isWeekend) {
      // Move forward to Monday
      // Use a Date object based on NY local components, then advance days
      let cursor = makeNYDate(year, month, day, hour, minute, second);
      // Advance until weekday is Mon-Fri
      while (true) {
        cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
        const nextParts = getNewYorkDateParts(cursor);
        if (nextParts.weekday !== 'Sat' && nextParts.weekday !== 'Sun' && !isMarketHoliday(cursor)) {
          targetYear = nextParts.year;
          targetMonth = nextParts.month;
          targetDay = nextParts.day;
          break;
        }
      }
    } else {
      // Weekday but outside trading session
      if (hour < openHour || (hour === openHour && minute < openMinute)) {
        // Before open: today at 09:30
        if (isMarketHoliday(now)) {
          // Today is a holiday; move to next business day
          let cursor = makeNYDate(year, month, day, hour, minute, second);
          while (true) {
            cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
            const nextParts = getNewYorkDateParts(cursor);
            if (nextParts.weekday !== 'Sat' && nextParts.weekday !== 'Sun' && !isMarketHoliday(cursor)) {
              targetYear = nextParts.year;
              targetMonth = nextParts.month;
              targetDay = nextParts.day;
              break;
            }
          }
        } else {
          targetYear = year;
          targetMonth = month;
          targetDay = day;
        }
      } else {
        // After close: next business day at 09:30
        let cursor = makeNYDate(year, month, day, hour, minute, second);
        while (true) {
          cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
          const nextParts = getNewYorkDateParts(cursor);
          if (nextParts.weekday !== 'Sat' && nextParts.weekday !== 'Sun' && !isMarketHoliday(cursor)) {
            targetYear = nextParts.year;
            targetMonth = nextParts.month;
            targetDay = nextParts.day;
            break;
          }
        }
      }
    }

    targetUtc = makeNYDate(targetYear, targetMonth, targetDay, openHour, openMinute, 0);
    prefix = 'Opens in';
  }

  const diffMs = targetUtc.getTime() - now.getTime();
  if (diffMs <= 0) {
    return { isOpen, label: null };
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');
  const timeStr = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  return { isOpen, label: `${prefix} ${timeStr}` };
}

/**
 * Get market status message
 * @returns User-friendly message about market status
 */
export function getMarketStatusMessage(): string {
  const now = new Date();
  const { openHour, openMinute, closeHour, closeMinute } = getSessionHours(now);
  const pad = (n: number) => n.toString().padStart(2, '0');
  const sessionWindow = `${pad(openHour)}:${pad(openMinute)}–${pad(closeHour)}:${pad(closeMinute)} ET`;

  if (isMarketOpen(now)) {
    // Calculate minutes until close (respect early close)
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');

    const currentMinutes = hour * 60 + minute;
    const closeMinutes = closeHour * 60 + closeMinute;
    const minutesUntilClose = closeMinutes - currentMinutes;

    const isEarlyClose = closeHour === 13;
    const closeLabel = `${pad(closeHour)}:${pad(closeMinute)} ET${isEarlyClose ? ' (early close)' : ''}`;
    return `Market is open. Closes at ${closeLabel} (in ${minutesUntilClose} minutes).`;
  }

  // Get weekday to check if weekend
  const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  });
  const weekday = weekdayFormatter.format(now);

  if (weekday === 'Sat' || weekday === 'Sun') {
    return `Market is closed (weekend). Regular hours: ${sessionWindow} on weekdays.`;
  }

  if (isMarketHoliday(now)) {
    return `Market is closed (holiday). Regular hours: ${sessionWindow}.`;
  }

  // Before or after market hours (not a weekend/holiday)
  return `Market is closed. Regular hours: ${sessionWindow}.`;
}

/**
 * Get formatted market hours string
 */
export function getMarketHoursString(): string {
  return '09:30–16:00 ET (early close 13:00 ET on select days)';
}

