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
 * Check if market is currently open (09:30 - 16:00 EST)
 * @param timestamp - Optional timestamp to check (defaults to now)
 * @returns true if market is open, false otherwise
 * 
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

  // Market hours: 09:30 - 16:00 EST
  const marketOpenHour = 9;
  const marketOpenMinute = 30;
  const marketCloseHour = 16;
  const marketCloseMinute = 0;

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

  // Define market session times in New York local time
  const openHour = 9;
  const openMinute = 30;
  const closeHour = 16;
  const closeMinute = 0;

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
        if (nextParts.weekday !== 'Sat' && nextParts.weekday !== 'Sun') {
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
        targetYear = year;
        targetMonth = month;
        targetDay = day;
      } else {
        // After close: next business day at 09:30
        let cursor = makeNYDate(year, month, day, hour, minute, second);
        while (true) {
          cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
          const nextParts = getNewYorkDateParts(cursor);
          if (nextParts.weekday !== 'Sat' && nextParts.weekday !== 'Sun') {
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

  if (isMarketOpen(now)) {
    // Calculate minutes until close (16:00 EST)
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
    const closeMinutes = 16 * 60 + 0; // 16:00
    const minutesUntilClose = closeMinutes - currentMinutes;

    return `Market is open. Closes in ${minutesUntilClose} minutes.`;
  }

  // Get weekday to check if weekend
  const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  });
  const weekday = weekdayFormatter.format(now);

  if (weekday === 'Sat' || weekday === 'Sun') {
    return 'Market is closed (weekend). Trades can only be created/settled between 09:30–16:00 EST on weekdays.';
  }

  // Before or after market hours
  return 'Market is closed. Trades can only be created/settled between 09:30–16:00 EST.';
}

/**
 * Get formatted market hours string
 */
export function getMarketHoursString(): string {
  return '09:30–16:00 EST';
}

