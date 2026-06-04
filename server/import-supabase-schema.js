import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const { Client } = pg;

function findConnectionString(envText) {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl && !databaseUrl.includes('localhost') && !databaseUrl.includes('127.0.0.1')) {
    return databaseUrl;
  }

  const supabaseUrl = envText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('postgresql://') && line.includes('supabase.co'));

  return supabaseUrl || databaseUrl;
}

const envText = await readFile(new URL('../.env', import.meta.url), 'utf8');
const connectionString = findConnectionString(envText);

if (!connectionString) {
  throw new Error('DATABASE_URL is missing from .env');
}

const shouldUseSsl = connectionString.includes('supabase.co');
const client = new Client({
  connectionString,
  ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined,
});

try {
  const sql = await readFile(new URL('../weekly_kpi.sql', import.meta.url), 'utf8');

  await client.connect();
  await client.query(sql);

  const result = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('weekly_kpi', 'room_usage_history', 'schedule_finalization', 'schedule_rooms')
    ORDER BY table_name
  `);

  console.log(`Imported schema. Tables: ${result.rows.map((row) => row.table_name).join(', ')}`);
} finally {
  await client.end();
}
