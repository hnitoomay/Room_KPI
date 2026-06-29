# Weekly KPI Admin

React and Tailwind admin page for editing a weekly university KPI schedule timeline and publishing it to PostgreSQL.

## Setup

1. Install dependencies:

   ```powershell
   npm.cmd install
   ```

2. Create `.env` from `.env.example` and set `DATABASE_URL` for your PostgreSQL database.

3. Create the table:

   ```powershell
   psql -d your_database_name -f .\weekly_kpi.sql
   ```

4. Start the app:

   ```powershell
   npm.cmd run dev
   ```

The admin page runs at `http://127.0.0.1:5173/`. The API runs at `http://127.0.0.1:3001/`.

The entrance LED display runs at:

```text
http://127.0.0.1:5173/entrance-led?campus_name=Time%20City%20Room
```

## Timeline Publish Behavior

The dashboard has Campus and Day dropdowns, a fixed room list for each campus, and horizontal room lanes from `08:00 AM` through `06:00 PM`. Staff only manage session blocks with start time, end time, topic/batch name, and number of students.

When Campus or Day changes, the dashboard loads saved rows from `GET /api/weekly-kpi/schedule`. The PostgreSQL table still has one `time_slot` column, so the app stores start and end time as a single value like `08:00 AM - 09:00 AM` and parses that range back into visual timeline blocks.

The `Publish Schedule` button sends active session blocks to `POST /api/weekly-kpi/schedule`.
The API runs one database transaction:

```sql
DELETE FROM weekly_kpi WHERE day_name = $1 AND campus_name = $2;
INSERT INTO weekly_kpi (...);
```

Publishing with no active session blocks clears previously saved classes for that selected day and campus.

## Entrance LED Display

The LED display fetches real rows from `GET /api/schedule/tomorrow` every 60 seconds and renders schedules in an airport departure-board style. The display accepts optional `campus_name` and `day_name` query parameters and only hides passed sessions when the selected schedule day is today.

## Deploy To Vercel

1. Run `node server/import-supabase-schema.js` against the production database before the first deployment.
2. Push the repository to GitHub. Do not commit `.env`; it is ignored by Git.
3. Import the GitHub repository in Vercel.
4. Add `DATABASE_URL` in the Vercel project environment variables for Production, Preview, and Development as needed.
5. Deploy with the detected Vite build settings.

The Express API is exported through `api/index.js`, and `vercel.json` routes `/api/*` requests to it while preserving SPA routes such as `/entrance-led`.
For Supabase, use its pooled PostgreSQL connection string for `DATABASE_URL`. `DATABASE_POOL_MAX` defaults to `5` and can be lowered if the database has a strict connection limit.

After deployment, open `/api/health` on the Vercel domain. A working deployment returns:

```json
{"ok":true,"databaseConfigured":true,"databaseConnected":true}
```

If Vercel logs show `ECONNREFUSED 127.0.0.1:3001`, confirm the latest commit containing `vercel.json` is deployed and that the Vercel Build Command is `npm run build`, not `npm run dev`. Also confirm `DATABASE_URL` in Vercel uses the Supabase pooled connection string rather than a localhost connection string.

## Security

The schedule dashboard and write API endpoints do not currently require authentication. Do not treat a public deployment as production-ready until access control is added, because anyone who can reach the site can save or finalize schedules.
