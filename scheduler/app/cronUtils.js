function getFormatter(timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short'
  });
}

function getTimeZoneParts(date, timeZone = 'UTC') {
  const formatter = getFormatter(timeZone);
  const parts = formatter.formatToParts(date);
  const map = {};
  parts.forEach((part) => {
    if (part.type !== 'literal') map[part.type] = part.value;
  });

  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayMap[map.weekday]
  };
}

function localDateTimeToUtc({
  year,
  month,
  day,
  hour = 0,
  minute = 0,
  second = 0
}, timeZone = 'UTC') {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  for (let i = 0; i < 4; i += 1) {
    const parts = getTimeZoneParts(guess, timeZone);
    const desiredUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
    const actualUtcMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    const diffMs = desiredUtcMs - actualUtcMs;
    if (diffMs === 0) return guess;
    guess = new Date(guess.getTime() + diffMs);
  }

  return guess;
}

function parsePart(part, min, max) {
  const values = new Set();
  const chunks = String(part).split(',');

  for (const chunkRaw of chunks) {
    const chunk = chunkRaw.trim();
    if (!chunk) continue;

    if (chunk === '*') {
      for (let i = min; i <= max; i += 1) values.add(i);
      continue;
    }

    if (chunk.startsWith('*/')) {
      const step = Number(chunk.slice(2));
      if (!Number.isInteger(step) || step <= 0) continue;
      for (let i = min; i <= max; i += step) values.add(i);
      continue;
    }

    if (chunk.includes('-')) {
      const [startRaw, endRaw] = chunk.split('-');
      const start = Number(startRaw);
      const end = Number(endRaw);
      if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
      for (let i = Math.max(start, min); i <= Math.min(end, max); i += 1) {
        values.add(i);
      }
      continue;
    }

    const value = Number(chunk);
    if (Number.isInteger(value) && value >= min && value <= max) {
      values.add(value);
    }
  }

  return values;
}

function parseCronExpr(expr) {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error('cron expression must have 5 parts (minute hour day month weekday)');
  }

  return {
    minute: parsePart(parts[0], 0, 59),
    hour: parsePart(parts[1], 0, 23),
    day: parsePart(parts[2], 1, 31),
    month: parsePart(parts[3], 1, 12),
    weekday: parsePart(parts[4], 0, 6)
  };
}

function isTopOfHourCronExpr(expr) {
  const cron = parseCronExpr(expr);
  return cron.minute.size === 1 && cron.minute.has(0);
}

function matchesCronDate(cron, date, timeZone = 'UTC') {
  const parts = getTimeZoneParts(date, timeZone);
  return cron.minute.has(parts.minute)
    && cron.hour.has(parts.hour)
    && cron.day.has(parts.day)
    && cron.month.has(parts.month)
    && cron.weekday.has(parts.weekday);
}

function getNextRunAt(expr, fromDate, timeZone = 'UTC') {
  const cron = parseCronExpr(expr);
  const cursor = new Date(fromDate);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  const limit = 60 * 24 * 366;
  for (let i = 0; i < limit; i += 1) {
    if (matchesCronDate(cron, cursor, timeZone)) {
      return new Date(cursor);
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }

  throw new Error('unable to compute next run for cron expression');
}

function listMissedRuns(expr, startExclusive, endInclusive, maxRuns = 500, timeZone = 'UTC') {
  const cron = parseCronExpr(expr);
  const cursor = new Date(startExclusive);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  const missed = [];
  while (cursor <= endInclusive && missed.length < maxRuns) {
    if (matchesCronDate(cron, cursor, timeZone)) {
      missed.push(new Date(cursor));
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }

  return missed;
}

module.exports = {
  getNextRunAt,
  listMissedRuns,
  parseCronExpr,
  isTopOfHourCronExpr,
  getTimeZoneParts,
  localDateTimeToUtc
};
