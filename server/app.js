import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import { getFixedRoomNames } from '../shared/campusRooms.js';

const { Pool } = pg;

const app = express();
const port = process.env.PORT || 3001;
const databaseUrl = process.env.DATABASE_URL;
const isLocalDatabase = databaseUrl?.includes('localhost') || databaseUrl?.includes('127.0.0.1');
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl && !isLocalDatabase ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.DATABASE_POOL_MAX || 5),
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const columns = [
  'schedule_date',
  'day_name',
  'campus_name',
  'room_name',
  'time_slot',
  'topic_batch',
  'num_students',
  'student_service_name',
  'recurrence_group_id',
  'recurrence_days',
  'recurrence_start_date',
  'recurrence_end_date',
  'recurrence_exception_dates',
];
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function parseTimeLabel(label) {
  const match = String(label)
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3].toUpperCase();

  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
    return null;
  }

  if (period === 'PM' && hour !== 12) {
    hour += 12;
  }

  if (period === 'AM' && hour === 12) {
    hour = 0;
  }

  return hour * 60 + minute;
}

function calculateHoursUsed(timeSlot) {
  const [startLabel, endLabel] = String(timeSlot).split(' - ');
  const startMinutes = parseTimeLabel(startLabel);
  const endMinutes = parseTimeLabel(endLabel);

  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return null;
  }

  return Number(((endMinutes - startMinutes) / 60).toFixed(2));
}

function parseMonth(month) {
  const match = String(month)
    .trim()
    .match(/^(\d{4})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]);

  if (monthIndex < 1 || monthIndex > 12) {
    return null;
  }

  const startDate = `${match[1]}-${match[2]}-01`;
  const nextMonth = monthIndex === 12 ? 1 : monthIndex + 1;
  const nextYear = monthIndex === 12 ? year + 1 : year;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  return { startDate, endDate };
}

function getNextDateInput(scheduleDate) {
  const parsedDate = parseDateInput(scheduleDate);

  if (!parsedDate) {
    return null;
  }

  const nextDate = new Date(`${parsedDate}T00:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  return parseDateInput(nextDate);
}

function getPreviousDateInput(scheduleDate) {
  const parsedDate = parseDateInput(scheduleDate);

  if (!parsedDate) {
    return null;
  }

  const previousDate = new Date(`${parsedDate}T00:00:00Z`);
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  return parseDateInput(previousDate);
}

function parseDateRange(startDateInput, endDateInput) {
  const startDate = parseDateInput(startDateInput);
  const endDate = parseDateInput(endDateInput);

  if (!startDate || !endDate || startDate > endDate) {
    return null;
  }

  return {
    startDate,
    endDate,
    exclusiveEndDate: getNextDateInput(endDate),
  };
}

function parseDateInput(dateInput) {
  if (dateInput instanceof Date && !Number.isNaN(dateInput.getTime())) {
    return `${dateInput.getUTCFullYear()}-${String(dateInput.getUTCMonth() + 1).padStart(2, '0')}-${String(
      dateInput.getUTCDate(),
    ).padStart(2, '0')}`;
  }

  const match = String(dateInput)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);

  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() + 1 !== Number(match[2]) ||
    date.getUTCDate() !== Number(match[3])
  ) {
    return null;
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function getDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getDayNameFromDate(scheduleDate) {
  return days[new Date(`${scheduleDate}T00:00:00Z`).getUTCDay()];
}

function getTomorrowDayName() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return days[tomorrow.getDay()];
}

function normalizeRecurrenceDays(value) {
  const sourceValues = Array.isArray(value)
    ? value
    : String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

  return weekdayOrder.filter((dayName) => sourceValues.includes(dayName));
}

function serializeRecurrenceDays(dayNames) {
  return normalizeRecurrenceDays(dayNames).join(',');
}

function normalizeRecurrenceExceptionDates(value) {
  const sourceValues = Array.isArray(value)
    ? value
    : String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

  return [...new Set(sourceValues.map((dateValue) => parseDateInput(dateValue)).filter(Boolean))].sort();
}

function serializeRecurrenceExceptionDates(dateValues) {
  return normalizeRecurrenceExceptionDates(dateValues).join(',');
}

function isRecurringRow(row) {
  return (
    row.recurrence_group_id &&
    row.recurrence_start_date &&
    row.recurrence_end_date &&
    row.recurrence_days.length > 0
  );
}

function toUtcDate(scheduleDate) {
  return new Date(`${scheduleDate}T00:00:00Z`);
}

function formatConflictRow(row) {
  return `${row.schedule_date} ${row.room_name} ${row.time_slot}`;
}

function buildConflictMessage(conflicts) {
  const items = conflicts.slice(0, 3).map(({ incoming, existing }) => {
    if (existing) {
      return `${formatConflictRow(incoming)} conflicts with ${formatConflictRow(existing)}`;
    }

    return `${formatConflictRow(incoming)} conflicts with another repeated session in this save`;
  });

  return `Conflicting room schedules found: ${items.join('; ')}. Edit this conflict session schedule and try again.`;
}

function expandRecurringRow(row) {
  if (!isRecurringRow(row)) {
    return [row];
  }

  const startDate = toUtcDate(row.recurrence_start_date);
  const endDate = toUtcDate(row.recurrence_end_date);
  const generatedRows = [];

  for (let cursor = new Date(startDate); cursor <= endDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const scheduleDate = parseDateInput(cursor);
    const dayName = getDayNameFromDate(scheduleDate);

    if (!row.recurrence_days.includes(dayName)) {
      continue;
    }

    if (row.recurrence_exception_dates.includes(scheduleDate)) {
      continue;
    }

    generatedRows.push({
      ...row,
      schedule_date: scheduleDate,
      day_name: dayName,
    });
  }

  return generatedRows;
}

function timeSlotsOverlap(firstTimeSlot, secondTimeSlot) {
  const [firstStartLabel, firstEndLabel] = String(firstTimeSlot).split(' - ');
  const [secondStartLabel, secondEndLabel] = String(secondTimeSlot).split(' - ');
  const firstStart = parseTimeLabel(firstStartLabel);
  const firstEnd = parseTimeLabel(firstEndLabel);
  const secondStart = parseTimeLabel(secondStartLabel);
  const secondEnd = parseTimeLabel(secondEndLabel);

  if ([firstStart, firstEnd, secondStart, secondEnd].some((value) => value === null)) {
    return false;
  }

  return firstStart < secondEnd && secondStart < firstEnd;
}

function findScheduleConflicts(candidateRows, existingRows) {
  const conflicts = [];

  for (let index = 0; index < candidateRows.length; index += 1) {
    const incoming = candidateRows[index];

    for (let compareIndex = index + 1; compareIndex < candidateRows.length; compareIndex += 1) {
      const otherCandidate = candidateRows[compareIndex];

      if (
        incoming.schedule_date === otherCandidate.schedule_date &&
        incoming.room_name === otherCandidate.room_name &&
        timeSlotsOverlap(incoming.time_slot, otherCandidate.time_slot)
      ) {
        conflicts.push({ incoming, existing: otherCandidate });
      }
    }

    existingRows.forEach((existing) => {
      const sameRecurringSeries =
        incoming.recurrence_group_id &&
        existing.recurrence_group_id &&
        incoming.recurrence_group_id === existing.recurrence_group_id;

      if (
        !sameRecurringSeries &&
        incoming.schedule_date === existing.schedule_date &&
        incoming.room_name === existing.room_name &&
        timeSlotsOverlap(incoming.time_slot, existing.time_slot)
      ) {
        conflicts.push({ incoming, existing });
      }
    });
  }

  return conflicts;
}

function serializeRowIdentity(row) {
  return [
    row.schedule_date,
    row.day_name,
    row.campus_name,
    row.room_name,
    row.time_slot,
    row.topic_batch,
    row.num_students,
    row.student_service_name,
    row.recurrence_group_id,
    serializeRecurrenceDays(row.recurrence_days),
    row.recurrence_start_date,
    row.recurrence_end_date,
    serializeRecurrenceExceptionDates(row.recurrence_exception_dates),
  ].join('||');
}

function dedupeRows(rows) {
  const uniqueRows = [];
  const seen = new Set();

  rows.forEach((row) => {
    const identity = serializeRowIdentity(row);

    if (seen.has(identity)) {
      return;
    }

    seen.add(identity);
    uniqueRows.push(row);
  });

  return uniqueRows;
}

function serializeSlotIdentity(row) {
  return [row.schedule_date, row.campus_name, row.room_name, row.time_slot].join('||');
}

function mergeRowsBySlot(rows) {
  const rowMap = new Map();

  rows.forEach((row) => {
    rowMap.set(serializeSlotIdentity(row), row);
  });

  return Array.from(rowMap.values());
}

function normalizeRecurringGroupIds(value) {
  const sourceValues = Array.isArray(value) ? value : [];
  return [...new Set(sourceValues.map((item) => String(item || '').trim()).filter(Boolean))];
}

function normalizeRow(row) {
  const scheduleDate = parseDateInput(row.schedule_date);
  const recurrenceDays = normalizeRecurrenceDays(row.recurrence_days);
  const recurrenceStartDate = parseDateInput(row.recurrence_start_date);
  const recurrenceEndDate = parseDateInput(row.recurrence_end_date);
  const recurrenceExceptionDates = normalizeRecurrenceExceptionDates(row.recurrence_exception_dates);
  const recurrenceGroupId = String(row.recurrence_group_id || '').trim() || null;
  const hasValidRecurrence =
    recurrenceGroupId &&
    recurrenceStartDate &&
    recurrenceEndDate &&
    recurrenceDays.length > 0 &&
    recurrenceStartDate <= recurrenceEndDate;

  return {
    schedule_date: scheduleDate,
    day_name: scheduleDate ? getDayNameFromDate(scheduleDate) : String(row.day_name || '').trim(),
    campus_name: String(row.campus_name || '').trim(),
    room_name: String(row.room_name || '').trim(),
    time_slot: String(row.time_slot || '').trim(),
    topic_batch: String(row.topic_batch || '').trim(),
    num_students: String(row.num_students || '').trim(),
    student_service_name: String(row.student_service_name || '').trim() || null,
    room_capacity: String(row.room_capacity ?? row.capacity ?? row.num_students ?? '').trim(),
    recurrence_group_id: hasValidRecurrence ? recurrenceGroupId : null,
    recurrence_days: hasValidRecurrence ? recurrenceDays : [],
    recurrence_start_date: hasValidRecurrence ? recurrenceStartDate : null,
    recurrence_end_date: hasValidRecurrence ? recurrenceEndDate : null,
    recurrence_exception_dates: hasValidRecurrence ? recurrenceExceptionDates : [],
  };
}

function isPublishable(row) {
  return row.schedule_date && row.day_name && row.campus_name && row.room_name && row.time_slot && row.topic_batch;
}

function buildBulkInsert(rows) {
  const values = [];
  const placeholders = rows.map((row, rowIndex) => {
    const offset = rowIndex * columns.length;
    values.push(
      row.schedule_date,
      row.day_name,
      row.campus_name,
      row.room_name,
      row.time_slot,
      row.topic_batch,
      row.num_students,
      row.student_service_name,
      row.recurrence_group_id,
      serializeRecurrenceDays(row.recurrence_days),
      row.recurrence_start_date,
      row.recurrence_end_date,
      serializeRecurrenceExceptionDates(row.recurrence_exception_dates),
    );
    return `(${columns.map((_, columnIndex) => `$${offset + columnIndex + 1}`).join(', ')})`;
  });

  return { values, placeholders };
}

async function ensureDatabaseSchema() {
  await pool.query(`
    ALTER TABLE weekly_kpi
    ADD COLUMN IF NOT EXISTS schedule_date DATE
  `);

  await pool.query(`
    ALTER TABLE weekly_kpi
    ADD COLUMN IF NOT EXISTS student_service_name VARCHAR(100)
  `);

  await pool.query(`
    ALTER TABLE weekly_kpi
    ADD COLUMN IF NOT EXISTS recurrence_group_id VARCHAR(100)
  `);

  await pool.query(`
    ALTER TABLE weekly_kpi
    ADD COLUMN IF NOT EXISTS recurrence_days VARCHAR(100)
  `);

  await pool.query(`
    ALTER TABLE weekly_kpi
    ADD COLUMN IF NOT EXISTS recurrence_start_date DATE
  `);

  await pool.query(`
    ALTER TABLE weekly_kpi
    ADD COLUMN IF NOT EXISTS recurrence_end_date DATE
  `);

  await pool.query(`
    ALTER TABLE weekly_kpi
    ADD COLUMN IF NOT EXISTS recurrence_exception_dates VARCHAR(255)
  `);

  await pool.query(`
    UPDATE weekly_kpi
    SET schedule_date = CURRENT_DATE
    WHERE schedule_date IS NULL
  `);

  await pool.query(`
    ALTER TABLE weekly_kpi
    ALTER COLUMN schedule_date SET NOT NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_usage_history (
      id SERIAL PRIMARY KEY,
      schedule_date DATE,
      campus_name VARCHAR(100) NOT NULL,
      room_name VARCHAR(100) NOT NULL,
      room_capacity VARCHAR(50),
      hours_used NUMERIC(6, 2) NOT NULL,
      usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE room_usage_history
    ADD COLUMN IF NOT EXISTS schedule_date DATE
  `);

  await pool.query(`
    ALTER TABLE room_usage_history
    ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ
  `);

  await pool.query(`
    UPDATE room_usage_history
    SET schedule_date = usage_date
    WHERE schedule_date IS NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_finalization (
      id SERIAL PRIMARY KEY,
      schedule_date DATE NOT NULL,
      campus_name VARCHAR(100) NOT NULL,
      finalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (schedule_date, campus_name)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_rooms (
      id SERIAL PRIMARY KEY,
      schedule_date DATE NOT NULL,
      campus_name VARCHAR(100) NOT NULL,
      room_name VARCHAR(100) NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (schedule_date, campus_name, room_name)
    )
  `);
}

function normalizeRoomNames(campusName, rooms, rows = []) {
  const fixedRooms = getFixedRoomNames(campusName);

  if (fixedRooms.length > 0) {
    return fixedRooms;
  }

  const roomNames = [];
  const seenRooms = new Set();

  [...(Array.isArray(rooms) ? rooms : []), ...rows.map((row) => row.room_name)].forEach((room) => {
    const roomName = typeof room === 'string' ? room.trim() : String(room?.name || room?.room_name || '').trim();

    if (roomName && !seenRooms.has(roomName)) {
      seenRooms.add(roomName);
      roomNames.push(roomName);
    }
  });

  return roomNames;
}

async function replaceScheduleRooms(client, scheduleDate, campusName, roomNames) {
  await client.query('DELETE FROM schedule_rooms WHERE schedule_date = $1 AND campus_name = $2', [
    scheduleDate,
    campusName,
  ]);

  if (roomNames.length === 0) {
    return;
  }

  const values = [];
  const placeholders = roomNames.map((roomName, index) => {
    const offset = index * 4;
    values.push(scheduleDate, campusName, roomName, index);
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
  });

  await client.query(
    `INSERT INTO schedule_rooms (schedule_date, campus_name, room_name, display_order)
     VALUES ${placeholders.join(', ')}`,
    values,
  );
}

async function replaceRoomUsageHistory(client, scheduleDate, campusName, rows) {
  await client.query('DELETE FROM room_usage_history WHERE schedule_date = $1 AND campus_name = $2', [
    scheduleDate,
    campusName,
  ]);

  const historyRows = rows
    .map((row) => ({
      schedule_date: scheduleDate,
      campus_name: row.campus_name,
      room_name: row.room_name,
      room_capacity: row.room_capacity,
      hours_used: calculateHoursUsed(row.time_slot),
    }))
    .filter((row) => row.campus_name && row.room_name && row.hours_used !== null);

  if (historyRows.length === 0) {
    return 0;
  }

  const values = [];
  const placeholders = historyRows.map((row, rowIndex) => {
    const offset = rowIndex * 5;
    values.push(row.schedule_date, row.campus_name, row.room_name, row.room_capacity || null, row.hours_used);
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 1}, NOW(), NOW())`;
  });

  await client.query(
    `INSERT INTO room_usage_history
       (schedule_date, campus_name, room_name, room_capacity, hours_used, usage_date, finalized_at, created_at)
     VALUES ${placeholders.join(', ')}`,
    values,
  );

  return historyRows.length;
}

async function finalizeScheduleForCampus(client, scheduleDate, campusName) {
  const normalizedScheduleDate = parseDateInput(scheduleDate);
  const normalizedCampusName = String(campusName || '').trim();

  if (!normalizedScheduleDate || !normalizedCampusName) {
    throw new Error(`Invalid finalization target: date=${String(scheduleDate)} campus=${String(campusName)}`);
  }

  const scheduleResult = await client.query(
    `SELECT schedule_date, day_name, campus_name, room_name, time_slot, topic_batch, num_students, student_service_name,
            recurrence_group_id, recurrence_days, recurrence_start_date, recurrence_end_date, recurrence_exception_dates
     FROM weekly_kpi
     WHERE schedule_date = $1 AND campus_name = $2
     ORDER BY room_name, time_slot, id`,
    [normalizedScheduleDate, normalizedCampusName],
  );

  const finalizedRows = await replaceRoomUsageHistory(
    client,
    normalizedScheduleDate,
    normalizedCampusName,
    scheduleResult.rows.map(normalizeRow).filter(isPublishable),
  );

  await client.query(
    `INSERT INTO schedule_finalization (schedule_date, campus_name, finalized_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (schedule_date, campus_name)
     DO UPDATE SET finalized_at = EXCLUDED.finalized_at`,
    [normalizedScheduleDate, normalizedCampusName],
  );

  return finalizedRows;
}

async function finalizeDueSchedules(databasePool, cutoffDate) {
  const normalizedCutoffDate = parseDateInput(cutoffDate);

  if (!normalizedCutoffDate) {
    throw new Error(`Invalid finalization cutoff date: ${String(cutoffDate)}`);
  }

  const dueSchedulesResult = await databasePool.query(
    `SELECT wk.schedule_date, wk.campus_name
     FROM weekly_kpi wk
     WHERE wk.schedule_date <= $1
       AND NOT EXISTS (
         SELECT 1
         FROM schedule_finalization sf
         WHERE sf.schedule_date = wk.schedule_date
           AND sf.campus_name = wk.campus_name
       )
     GROUP BY wk.schedule_date, wk.campus_name
     ORDER BY wk.schedule_date, wk.campus_name`,
    [normalizedCutoffDate],
  );

  const finalizedSchedules = [];

  for (const row of dueSchedulesResult.rows) {
    const scheduleDate = parseDateInput(row.schedule_date);
    const campusName = String(row.campus_name || '').trim();

    if (!scheduleDate || !campusName) {
      continue;
    }

    let client;

    try {
      client = await databasePool.connect();
      await client.query('BEGIN');
      const finalizedRows = await finalizeScheduleForCampus(client, scheduleDate, campusName);
      await client.query('COMMIT');
      finalizedSchedules.push({ scheduleDate, campusName, finalizedRows });
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK');
      }

      console.error(`Failed to finalize ${campusName} for ${scheduleDate}.`, error);
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  return finalizedSchedules;
}

function getTimeZoneParts(timeZone, date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return formatter.formatToParts(date).reduce((parts, item) => {
    if (item.type !== 'literal') {
      parts[item.type] = item.value;
    }

    return parts;
  }, {});
}

function getTimeZoneDateInput(timeZone, date = new Date()) {
  const parts = getTimeZoneParts(timeZone, date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

let autoFinalizeTimer = null;
let autoFinalizeInFlight = false;
const autoFinalizeTimeZone = process.env.AUTO_FINALIZE_TIMEZONE || 'Asia/Yangon';
const autoFinalizeHour = Number(process.env.AUTO_FINALIZE_HOUR || 23);
const autoFinalizeMinute = Number(process.env.AUTO_FINALIZE_MINUTE || 0);

function getLatestDueScheduleDate(date = new Date()) {
  const nowParts = getTimeZoneParts(autoFinalizeTimeZone, date);
  const todayDate = `${nowParts.year}-${nowParts.month}-${nowParts.day}`;
  const currentHour = Number(nowParts.hour);
  const currentMinute = Number(nowParts.minute);
  const isAfterCutoff =
    currentHour > autoFinalizeHour || (currentHour === autoFinalizeHour && currentMinute >= autoFinalizeMinute);

  return isAfterCutoff ? todayDate : getPreviousDateInput(todayDate);
}

function shouldFinalizeScheduleDate(scheduleDate, date = new Date()) {
  const latestDueScheduleDate = getLatestDueScheduleDate(date);
  return Boolean(scheduleDate && latestDueScheduleDate && scheduleDate <= latestDueScheduleDate);
}

function startAutoFinalizeScheduler() {
  if (autoFinalizeTimer) {
    return;
  }

  async function runAutoFinalizeTick() {
    const nowParts = getTimeZoneParts(autoFinalizeTimeZone);
    const scheduleDate = `${nowParts.year}-${nowParts.month}-${nowParts.day}`;

    if (Number(nowParts.hour) !== autoFinalizeHour || Number(nowParts.minute) < autoFinalizeMinute) {
      return;
    }

    if (autoFinalizeInFlight) {
      return;
    }

    autoFinalizeInFlight = true;

    try {
      const finalizedSchedules = await finalizeDueSchedules(pool, scheduleDate);

      for (const finalizedSchedule of finalizedSchedules) {
        console.log(
          `Auto-finalized ${finalizedSchedule.campusName} for ${finalizedSchedule.scheduleDate} with ${finalizedSchedule.finalizedRows} session(s).`,
        );
      }
    } catch (error) {
      console.error(`Failed to scan campuses for auto-finalization on ${scheduleDate}.`, error);
    } finally {
      autoFinalizeInFlight = false;
    }
  }

  autoFinalizeTimer = setInterval(runAutoFinalizeTick, 60 * 1000);
  runAutoFinalizeTick().catch((error) => {
    console.error('Initial auto-finalize check failed.', error);
  });
}

app.get('/api/health', async (_request, response) => {
  if (!databaseUrl) {
    return response.status(503).json({
      ok: false,
      databaseConfigured: false,
      error: 'DATABASE_URL is not configured.',
    });
  }

  try {
    await pool.query('SELECT 1');
    response.json({ ok: true, databaseConfigured: true, databaseConnected: true });
  } catch (error) {
    console.error('Database health check failed.', error);
    response.status(503).json({
      ok: false,
      databaseConfigured: true,
      databaseConnected: false,
      error: error.code || error.message,
    });
  }
});

app.get('/api/weekly-kpi/schedule', async (request, response) => {
  const scheduleDate = parseDateInput(request.query.schedule_date);
  const campusName = String(request.query.campus_name || '').trim();

  if (!scheduleDate || !campusName) {
    return response.status(400).json({ error: 'Schedule date and campus are required.' });
  }

  try {
    const [scheduleResult, roomResult] = await Promise.all([
      pool.query(
      `SELECT id, schedule_date, day_name, campus_name, room_name, time_slot, topic_batch, num_students, student_service_name,
              recurrence_group_id, recurrence_days, recurrence_start_date, recurrence_end_date, recurrence_exception_dates
       FROM weekly_kpi
       WHERE schedule_date = $1 AND campus_name = $2
       ORDER BY room_name, time_slot, id`,
      [scheduleDate, campusName],
      ),
      pool.query(
        `SELECT room_name
         FROM schedule_rooms
         WHERE schedule_date = $1 AND campus_name = $2
         ORDER BY display_order, room_name`,
        [scheduleDate, campusName],
      ),
    ]);

    const fixedRooms = getFixedRoomNames(campusName);

    response.json({
      rows:
        fixedRooms.length > 0
          ? scheduleResult.rows.filter((row) => fixedRooms.includes(row.room_name))
          : scheduleResult.rows,
      rooms: fixedRooms.length > 0 ? fixedRooms : roomResult.rows.map((row) => row.room_name),
    });
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: 'Failed to load schedule.' });
  }
});

app.get('/api/schedule/tomorrow', async (request, response) => {
  const requestedDate = parseDateInput(request.query.schedule_date);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const scheduleDate = requestedDate || getDateInput(tomorrow);
  const requestedDayName = String(request.query.day_name || '').trim();
  const tomorrowDayName = requestedDayName || getDayNameFromDate(scheduleDate) || getTomorrowDayName();
  const campusName = String(request.query.campus_name || '').trim();

  try {
    const result = campusName
      ? await pool.query(
          `SELECT id, schedule_date, day_name, campus_name, room_name, time_slot, topic_batch, num_students, student_service_name,
                  recurrence_group_id, recurrence_days, recurrence_start_date, recurrence_end_date, recurrence_exception_dates
           FROM weekly_kpi
           WHERE schedule_date = $1 AND campus_name = $2
           ORDER BY time_slot, room_name, id`,
          [scheduleDate, campusName],
        )
      : await pool.query(
          `SELECT id, schedule_date, day_name, campus_name, room_name, time_slot, topic_batch, num_students, student_service_name,
                  recurrence_group_id, recurrence_days, recurrence_start_date, recurrence_end_date, recurrence_exception_dates
           FROM weekly_kpi
           WHERE schedule_date = $1
           ORDER BY time_slot, campus_name, room_name, id`,
          [scheduleDate],
        );
    const roomResult = campusName
      ? await pool.query(
          `SELECT room_name
           FROM schedule_rooms
           WHERE schedule_date = $1 AND campus_name = $2
           ORDER BY display_order, room_name`,
          [scheduleDate, campusName],
        )
      : await pool.query(
          `SELECT campus_name, room_name
           FROM schedule_rooms
           WHERE schedule_date = $1
           ORDER BY campus_name, display_order, room_name`,
          [scheduleDate],
        );

    const fixedRooms = campusName ? getFixedRoomNames(campusName) : [];

    response.json({
      activeCampus: campusName || 'All Campuses',
      dayName: tomorrowDayName,
      scheduleDate,
      rows: fixedRooms.length > 0 ? result.rows.filter((row) => fixedRooms.includes(row.room_name)) : result.rows,
      rooms: campusName
        ? fixedRooms.length > 0
          ? fixedRooms
          : roomResult.rows.map((row) => row.room_name)
        : roomResult.rows,
    });
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: 'Failed to load tomorrow schedule.' });
  }
});

app.get('/api/room-usage-history/summary', async (request, response) => {
  const dateRange =
    parseDateRange(request.query.start_date, request.query.end_date) || parseMonth(request.query.month);
  const campusName = String(request.query.campus_name || '').trim();

  if (!dateRange) {
    return response.status(400).json({ error: 'A valid date range is required.' });
  }

  try {
    const latestDueScheduleDate = getLatestDueScheduleDate();
    const finalizeThroughDate =
      latestDueScheduleDate && dateRange.endDate < latestDueScheduleDate ? dateRange.endDate : latestDueScheduleDate;

    if (finalizeThroughDate && finalizeThroughDate >= dateRange.startDate) {
      await finalizeDueSchedules(pool, finalizeThroughDate);
    }

    const params = [dateRange.startDate, dateRange.exclusiveEndDate];
    const campusFilter = campusName ? 'AND campus_name = $3' : '';

    if (campusName) {
      params.push(campusName);
    }

    const result = await pool.query(
      `SELECT
         campus_name,
         room_name,
         COUNT(*)::int AS total_times_used,
         COALESCE(SUM(hours_used), 0)::float AS total_hours_used
       FROM room_usage_history
       WHERE COALESCE(schedule_date, usage_date) >= $1::date
         AND COALESCE(schedule_date, usage_date) < $2::date
         ${campusFilter}
       GROUP BY campus_name, room_name
       ORDER BY campus_name, total_hours_used DESC, total_times_used DESC, room_name`,
      params,
    );

    response.json({ rows: result.rows, startDate: dateRange.startDate, endDate: dateRange.endDate });
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: 'Failed to load room usage analytics.' });
  }
});

app.post('/api/weekly-kpi/publish', async (request, response) => {
  const rows = Array.isArray(request.body?.rows) ? request.body.rows.map(normalizeRow) : [];
  const publishableRows = rows.filter(isPublishable);

  if (publishableRows.length === 0) {
    return response.status(400).json({
      error: 'Add at least one complete row before publishing.',
    });
  }

  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE weekly_kpi RESTART IDENTITY');

    const { values, placeholders } = buildBulkInsert(publishableRows);

    await client.query(
      `INSERT INTO weekly_kpi (${columns.join(', ')}) VALUES ${placeholders.join(', ')}`,
      values,
    );

    await client.query('COMMIT');
    response.json({ inserted: publishableRows.length });
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error(error);
    response.status(500).json({ error: 'Failed to publish weekly KPI schedule.' });
  } finally {
    if (client) {
      client.release();
    }
  }
});

app.post('/api/weekly-kpi/matrix', async (request, response) => {
  const scheduleDate = parseDateInput(request.body?.schedule_date);
  const dayName = scheduleDate ? getDayNameFromDate(scheduleDate) : String(request.body?.day_name || '').trim();
  const campusName = String(request.body?.campus_name || '').trim();
  const rows = Array.isArray(request.body?.rows)
    ? request.body.rows.map((row) => normalizeRow({ ...row, schedule_date: row.schedule_date || scheduleDate }))
    : [];
  const roomNames = normalizeRoomNames(campusName, request.body?.rooms, rows);
  const publishableRows = rows.filter(
    (row) =>
      row.schedule_date === scheduleDate &&
      row.day_name === dayName &&
      row.campus_name === campusName &&
      roomNames.includes(row.room_name) &&
      isPublishable(row),
  );

  if (!scheduleDate || !campusName) {
    return response.status(400).json({ error: 'Schedule date and campus are required.' });
  }

  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('DELETE FROM weekly_kpi WHERE schedule_date = $1 AND campus_name = $2', [scheduleDate, campusName]);
    await replaceScheduleRooms(client, scheduleDate, campusName, roomNames);

    if (publishableRows.length > 0) {
      const { values, placeholders } = buildBulkInsert(publishableRows);

      await client.query(
        `INSERT INTO weekly_kpi (${columns.join(', ')}) VALUES ${placeholders.join(', ')}`,
        values,
      );
    }

    let finalizedRows = 0;
    let finalizedNow = false;

    if (shouldFinalizeScheduleDate(scheduleDate)) {
      finalizedRows = await finalizeScheduleForCampus(client, scheduleDate, campusName);
      finalizedNow = true;
    }

    await client.query('COMMIT');
    response.json({ inserted: publishableRows.length, rooms: roomNames.length, finalizedNow, finalizedRows });
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error(error);
    response.status(500).json({ error: 'Failed to save matrix schedule.' });
  } finally {
    if (client) {
      client.release();
    }
  }
});

app.post('/api/weekly-kpi/schedule', async (request, response) => {
  const scheduleDate = parseDateInput(request.body?.schedule_date);
  const dayName = scheduleDate ? getDayNameFromDate(scheduleDate) : String(request.body?.day_name || '').trim();
  const campusName = String(request.body?.campus_name || '').trim();
  const deletedRecurringGroupIds = normalizeRecurringGroupIds(request.body?.deleted_recurrence_group_ids);
  const rows = Array.isArray(request.body?.rows)
    ? request.body.rows.map((row) => normalizeRow({ ...row, schedule_date: row.schedule_date || scheduleDate }))
    : [];
  const seriesRows = Array.isArray(request.body?.series_rows)
    ? request.body.series_rows.map((row) => normalizeRow({ ...row, schedule_date: row.schedule_date || scheduleDate }))
    : [];
  const roomNames = normalizeRoomNames(campusName, request.body?.rooms, rows);
  const publishableRows = rows.filter(
    (row) =>
      row.schedule_date === scheduleDate &&
      row.day_name === dayName &&
      row.campus_name === campusName &&
      roomNames.includes(row.room_name) &&
      isPublishable(row),
  );
  const recurringRows = seriesRows.filter(
    (row) => row.campus_name === campusName && roomNames.includes(row.room_name) && isPublishable(row) && isRecurringRow(row),
  );
  const singleRows = publishableRows.filter((row) => !isRecurringRow(row));
  const incomingRecurringGroupIds = normalizeRecurringGroupIds(recurringRows.map((row) => row.recurrence_group_id));
  const replacedRecurringGroupIds = normalizeRecurringGroupIds([...incomingRecurringGroupIds, ...deletedRecurringGroupIds]);
  const expandedRecurringRows = recurringRows.flatMap(expandRecurringRow);
  const rowsToPersist = mergeRowsBySlot(dedupeRows([...expandedRecurringRows, ...singleRows]));

  if (!scheduleDate || !campusName) {
    return response.status(400).json({ error: 'Schedule date and campus are required.' });
  }

  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const replacedRecurringDates = [];

    if (rowsToPersist.length > 0) {
      const targetDates = [...new Set(rowsToPersist.map((row) => row.schedule_date).filter(Boolean))];
      const queryParams = [campusName, targetDates];
      let exclusionSql = 'AND schedule_date <> $3';

      queryParams.push(scheduleDate);

      if (replacedRecurringGroupIds.length > 0) {
        exclusionSql += ' AND (recurrence_group_id IS NULL OR recurrence_group_id <> ALL($4::text[]))';
        queryParams.push(replacedRecurringGroupIds);
      }

      const existingResult = await client.query(
        `SELECT schedule_date, room_name, time_slot, topic_batch, recurrence_group_id
         FROM weekly_kpi
         WHERE campus_name = $1
           AND schedule_date = ANY($2::date[])
           ${exclusionSql}`,
        queryParams,
      );
      const conflicts = findScheduleConflicts(rowsToPersist, existingResult.rows);

      if (conflicts.length > 0) {
        await client.query('ROLLBACK');
        return response.status(409).json({
          error: buildConflictMessage(conflicts),
          conflicts: conflicts.slice(0, 10),
        });
      }
    }

    if (replacedRecurringGroupIds.length > 0) {
      const replacedDateResult = await client.query(
        `SELECT DISTINCT schedule_date
         FROM weekly_kpi
         WHERE campus_name = $1
           AND recurrence_group_id = ANY($2::text[])`,
        [campusName, replacedRecurringGroupIds],
      );

      replacedRecurringDates.push(...replacedDateResult.rows.map((row) => parseDateInput(row.schedule_date)).filter(Boolean));
    }

    await client.query('DELETE FROM weekly_kpi WHERE schedule_date = $1 AND campus_name = $2', [scheduleDate, campusName]);

    if (replacedRecurringGroupIds.length > 0) {
      await client.query(
        'DELETE FROM weekly_kpi WHERE campus_name = $1 AND recurrence_group_id = ANY($2::text[])',
        [campusName, replacedRecurringGroupIds],
      );
    }

    await replaceScheduleRooms(client, scheduleDate, campusName, roomNames);

    if (rowsToPersist.length > 0) {
      const { values, placeholders } = buildBulkInsert(rowsToPersist);

      await client.query(
        `INSERT INTO weekly_kpi (${columns.join(', ')}) VALUES ${placeholders.join(', ')}`,
        values,
      );
    }

    const finalizableDates = [
      scheduleDate,
      ...rowsToPersist.map((row) => row.schedule_date),
      ...replacedRecurringDates,
    ]
      .filter((dateInput, index, items) => dateInput && items.indexOf(dateInput) === index)
      .filter((dateInput) => shouldFinalizeScheduleDate(dateInput))
      .sort();

    let finalizedDates = 0;
    let finalizedRows = 0;

    for (const finalizedDate of finalizableDates) {
      finalizedRows += await finalizeScheduleForCampus(client, finalizedDate, campusName);
      finalizedDates += 1;
    }

    await client.query('COMMIT');
    response.json({
      inserted: rowsToPersist.length,
      sourceRows: publishableRows.length,
      repeatedRows: expandedRecurringRows.length,
      rooms: roomNames.length,
      finalizedDates,
      finalizedRows,
    });
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error(error);
    response.status(500).json({ error: 'Failed to publish schedule.' });
  } finally {
    if (client) {
      client.release();
    }
  }
});

app.post('/api/weekly-kpi/finalize', async (request, response) => {
  const scheduleDate = parseDateInput(request.body?.schedule_date);
  const campusName = String(request.body?.campus_name || '').trim();

  if (!scheduleDate || !campusName) {
    return response.status(400).json({ error: 'Schedule date and campus are required.' });
  }

  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const finalizedRows = await finalizeScheduleForCampus(client, scheduleDate, campusName);
    await client.query('COMMIT');
    response.json({ finalizedRows, scheduleDate, campusName });
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error(error);
    response.status(500).json({ error: 'Failed to finalize schedule.' });
  } finally {
    if (client) {
      client.release();
    }
  }
});

app.get('/api/cron/finalize', async (_request, response) => {
  if (!databaseUrl) {
    return response.status(503).json({
      ok: false,
      databaseConfigured: false,
      error: 'DATABASE_URL is not configured.',
    });
  }

  try {
    const cutoffDate = getTimeZoneDateInput(autoFinalizeTimeZone);
    const finalizedSchedules = await finalizeDueSchedules(pool, cutoffDate);

    response.json({
      ok: true,
      cutoffDate,
      finalizedCount: finalizedSchedules.length,
      finalizedSchedules: finalizedSchedules.map((item) => ({
        scheduleDate: item.scheduleDate,
        campusName: item.campusName,
        finalizedRows: item.finalizedRows,
      })),
    });
  } catch (error) {
    console.error('Cron finalize failed.', error);
    response.status(500).json({
      ok: false,
      error: error.code || error.message,
    });
  }
});

export { ensureDatabaseSchema };
export default app;

if (!process.env.VERCEL) {
  ensureDatabaseSchema()
    .then(() => {
      startAutoFinalizeScheduler();
      app.listen(port, () => {
        console.log(`Weekly KPI API listening on http://127.0.0.1:${port}`);
      });
    })
    .catch((error) => {
      console.error('Failed to initialize database schema.', error);
      process.exit(1);
    });
}
