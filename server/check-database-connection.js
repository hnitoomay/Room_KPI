import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is missing from .env');
}

const isSupabase = process.env.DATABASE_URL.includes('supabase.co');
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: isSupabase ? { rejectUnauthorized: false } : undefined,
});

try {
  await client.connect();
  const result = await client.query(`
    SELECT
      current_database() AS database,
      current_user AS user_name,
      inet_server_addr()::text AS server_addr,
      COUNT(*)::int AS weekly_rows
    FROM public.weekly_kpi
  `);

  console.log(JSON.stringify({ ...result.rows[0], is_supabase_url: isSupabase }, null, 2));
} finally {
  await client.end();
}
