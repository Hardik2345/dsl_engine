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

function matchesCronDate(cron, date) {
  return cron.minute.has(date.getUTCMinutes())
    && cron.hour.has(date.getUTCHours())
    && cron.day.has(date.getUTCDate())
    && cron.month.has(date.getUTCMonth() + 1)
    && cron.weekday.has(date.getUTCDay());
}

function getNextRunAt(expr, fromDate) {
  const cron = parseCronExpr(expr);
  const cursor = new Date(fromDate);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  const limit = 60 * 24 * 366;
  for (let i = 0; i < limit; i += 1) {
    if (matchesCronDate(cron, cursor)) {
      return new Date(cursor);
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }

  throw new Error('unable to compute next run for cron expression');
}

function listMissedRuns(expr, startExclusive, endInclusive, maxRuns = 500) {
  const cron = parseCronExpr(expr);
  const cursor = new Date(startExclusive);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  const missed = [];
  while (cursor <= endInclusive && missed.length < maxRuns) {
    if (matchesCronDate(cron, cursor)) {
      missed.push(new Date(cursor));
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }

  return missed;
}

module.exports = {
  getNextRunAt,
  listMissedRuns
};
