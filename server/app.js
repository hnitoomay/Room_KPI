import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pg from 'pg';

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
];
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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

function normalizeRow(row) {
  const scheduleDate = parseDateInput(row.schedule_date);

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
  };
}

function isPublishable(row) {
  return row.schedule_date && row.day_name && row.campus_name && row.room_name && row.time_slot && row.topic_batch;
}

function buildBulkInsert(rows) {
  const values = [];
  const placeholders = rows.map((row, rowIndex) => {
    const offset = rowIndex * columns.length;
    values.push(...columns.map((column) => row[column]));
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

function normalizeRoomNames(rooms, rows = []) {
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
      `SELECT id, schedule_date, day_name, campus_name, room_name, time_slot, topic_batch, num_students, student_service_name
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

    response.json({
      rows: scheduleResult.rows,
      rooms: roomResult.rows.map((row) => row.room_name),
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
          `SELECT id, schedule_date, day_name, campus_name, room_name, time_slot, topic_batch, num_students, student_service_name
           FROM weekly_kpi
           WHERE schedule_date = $1 AND campus_name = $2
           ORDER BY time_slot, room_name, id`,
          [scheduleDate, campusName],
        )
      : await pool.query(
          `SELECT id, schedule_date, day_name, campus_name, room_name, time_slot, topic_batch, num_students, student_service_name
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

    response.json({
      activeCampus: campusName || 'All Campuses',
      dayName: tomorrowDayName,
      scheduleDate,
      rows: result.rows,
      rooms: campusName ? roomResult.rows.map((row) => row.room_name) : roomResult.rows,
    });
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: 'Failed to load tomorrow schedule.' });
  }
});

app.get('/api/room-usage-history/summary', async (request, response) => {
  const monthRange = parseMonth(request.query.month);
  const campusName = String(request.query.campus_name || '').trim();

  if (!monthRange) {
    return response.status(400).json({ error: 'A valid month is required, using YYYY-MM format.' });
  }

  try {
    const params = [monthRange.startDate, monthRange.endDate];
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

    response.json({ rows: result.rows });
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
  const roomNames = normalizeRoomNames(request.body?.rooms, rows);
  const publishableRows = rows.filter(
    (row) =>
      row.schedule_date === scheduleDate && row.day_name === dayName && row.campus_name === campusName && isPublishable(row),
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

    await client.query('COMMIT');
    response.json({ inserted: publishableRows.length, rooms: roomNames.length });
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
  const rows = Array.isArray(request.body?.rows)
    ? request.body.rows.map((row) => normalizeRow({ ...row, schedule_date: row.schedule_date || scheduleDate }))
    : [];
  const roomNames = normalizeRoomNames(request.body?.rooms, rows);
  const publishableRows = rows.filter(
    (row) =>
      row.schedule_date === scheduleDate && row.day_name === dayName && row.campus_name === campusName && isPublishable(row),
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

    await client.query('COMMIT');
    response.json({ inserted: publishableRows.length, rooms: roomNames.length });
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

    const scheduleResult = await client.query(
      `SELECT schedule_date, day_name, campus_name, room_name, time_slot, topic_batch, num_students, student_service_name
       FROM weekly_kpi
       WHERE schedule_date = $1 AND campus_name = $2
       ORDER BY room_name, time_slot, id`,
      [scheduleDate, campusName],
    );

    const finalizedRows = await replaceRoomUsageHistory(
      client,
      scheduleDate,
      campusName,
      scheduleResult.rows.map(normalizeRow).filter(isPublishable),
    );

    await client.query(
      `INSERT INTO schedule_finalization (schedule_date, campus_name, finalized_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (schedule_date, campus_name)
       DO UPDATE SET finalized_at = EXCLUDED.finalized_at`,
      [scheduleDate, campusName],
    );

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

export { ensureDatabaseSchema };
export default app;

if (!process.env.VERCEL) {
  ensureDatabaseSchema()
    .then(() => {
      app.listen(port, () => {
        console.log(`Weekly KPI API listening on http://127.0.0.1:${port}`);
      });
    })
    .catch((error) => {
      console.error('Failed to initialize database schema.', error);
      process.exit(1);
    });
}
