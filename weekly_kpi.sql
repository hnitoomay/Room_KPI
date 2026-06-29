-- Supabase-ready Room KPI schema.
-- This script is safe to paste into the Supabase SQL editor and run more than once.

BEGIN;

CREATE TABLE IF NOT EXISTS public.weekly_kpi (
    id SERIAL PRIMARY KEY,
    schedule_date DATE NOT NULL,
    day_name VARCHAR(10),
    time_slot VARCHAR(50) NOT NULL,
    room_name VARCHAR(100) NOT NULL,
    campus_name VARCHAR(100) NOT NULL,
    topic_batch VARCHAR(255) NOT NULL,
    num_students VARCHAR(50),
    student_service_name VARCHAR(100),
    recurrence_group_id VARCHAR(100),
    recurrence_days VARCHAR(100),
    recurrence_start_date DATE,
    recurrence_end_date DATE,
    recurrence_exception_dates VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS public.room_usage_history (
    id SERIAL PRIMARY KEY,
    schedule_date DATE NOT NULL,
    campus_name VARCHAR(100) NOT NULL,
    room_name VARCHAR(100) NOT NULL,
    room_capacity VARCHAR(50),
    hours_used NUMERIC(6, 2) NOT NULL,
    usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
    finalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.schedule_finalization (
    id SERIAL PRIMARY KEY,
    schedule_date DATE NOT NULL,
    campus_name VARCHAR(100) NOT NULL,
    finalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (schedule_date, campus_name)
);

CREATE TABLE IF NOT EXISTS public.schedule_rooms (
    id SERIAL PRIMARY KEY,
    schedule_date DATE NOT NULL,
    campus_name VARCHAR(100) NOT NULL,
    room_name VARCHAR(100) NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (schedule_date, campus_name, room_name)
);

ALTER TABLE public.weekly_kpi
    ADD COLUMN IF NOT EXISTS schedule_date DATE,
    ADD COLUMN IF NOT EXISTS day_name VARCHAR(10),
    ADD COLUMN IF NOT EXISTS time_slot VARCHAR(50),
    ADD COLUMN IF NOT EXISTS room_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS campus_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS topic_batch VARCHAR(255),
    ADD COLUMN IF NOT EXISTS num_students VARCHAR(50),
    ADD COLUMN IF NOT EXISTS student_service_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS recurrence_group_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS recurrence_days VARCHAR(100),
    ADD COLUMN IF NOT EXISTS recurrence_start_date DATE,
    ADD COLUMN IF NOT EXISTS recurrence_end_date DATE,
    ADD COLUMN IF NOT EXISTS recurrence_exception_dates VARCHAR(255);

ALTER TABLE public.room_usage_history
    ADD COLUMN IF NOT EXISTS schedule_date DATE,
    ADD COLUMN IF NOT EXISTS campus_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS room_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS room_capacity VARCHAR(50),
    ADD COLUMN IF NOT EXISTS hours_used NUMERIC(6, 2),
    ADD COLUMN IF NOT EXISTS usage_date DATE DEFAULT CURRENT_DATE,
    ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.schedule_finalization
    ADD COLUMN IF NOT EXISTS schedule_date DATE,
    ADD COLUMN IF NOT EXISTS campus_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.schedule_rooms
    ADD COLUMN IF NOT EXISTS schedule_date DATE,
    ADD COLUMN IF NOT EXISTS campus_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS room_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

UPDATE public.weekly_kpi
SET schedule_date = CURRENT_DATE
WHERE schedule_date IS NULL;

UPDATE public.room_usage_history
SET schedule_date = COALESCE(schedule_date, usage_date, CURRENT_DATE),
    usage_date = COALESCE(usage_date, CURRENT_DATE),
    finalized_at = COALESCE(finalized_at, NOW()),
    created_at = COALESCE(created_at, NOW())
WHERE schedule_date IS NULL
   OR usage_date IS NULL
   OR finalized_at IS NULL
   OR created_at IS NULL;

ALTER TABLE public.weekly_kpi
    ALTER COLUMN schedule_date SET NOT NULL,
    ALTER COLUMN time_slot SET NOT NULL,
    ALTER COLUMN room_name SET NOT NULL,
    ALTER COLUMN campus_name SET NOT NULL,
    ALTER COLUMN topic_batch SET NOT NULL;

ALTER TABLE public.room_usage_history
    ALTER COLUMN schedule_date SET NOT NULL,
    ALTER COLUMN campus_name SET NOT NULL,
    ALTER COLUMN room_name SET NOT NULL,
    ALTER COLUMN hours_used SET NOT NULL,
    ALTER COLUMN usage_date SET NOT NULL,
    ALTER COLUMN usage_date SET DEFAULT CURRENT_DATE,
    ALTER COLUMN finalized_at SET NOT NULL,
    ALTER COLUMN finalized_at SET DEFAULT NOW(),
    ALTER COLUMN created_at SET NOT NULL,
    ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE public.schedule_finalization
    ALTER COLUMN schedule_date SET NOT NULL,
    ALTER COLUMN campus_name SET NOT NULL,
    ALTER COLUMN finalized_at SET NOT NULL,
    ALTER COLUMN finalized_at SET DEFAULT NOW();

ALTER TABLE public.schedule_rooms
    ALTER COLUMN schedule_date SET NOT NULL,
    ALTER COLUMN campus_name SET NOT NULL,
    ALTER COLUMN room_name SET NOT NULL,
    ALTER COLUMN display_order SET NOT NULL,
    ALTER COLUMN display_order SET DEFAULT 0,
    ALTER COLUMN created_at SET NOT NULL,
    ALTER COLUMN created_at SET DEFAULT NOW();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'schedule_finalization_schedule_date_campus_name_key'
          AND conrelid = 'public.schedule_finalization'::regclass
    ) THEN
        ALTER TABLE public.schedule_finalization
            ADD CONSTRAINT schedule_finalization_schedule_date_campus_name_key
            UNIQUE (schedule_date, campus_name);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'schedule_rooms_schedule_date_campus_name_room_name_key'
          AND conrelid = 'public.schedule_rooms'::regclass
    ) THEN
        ALTER TABLE public.schedule_rooms
            ADD CONSTRAINT schedule_rooms_schedule_date_campus_name_room_name_key
            UNIQUE (schedule_date, campus_name, room_name);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS weekly_kpi_schedule_campus_idx
    ON public.weekly_kpi (schedule_date, campus_name);

CREATE INDEX IF NOT EXISTS room_usage_history_schedule_campus_idx
    ON public.room_usage_history (schedule_date, campus_name);

CREATE INDEX IF NOT EXISTS schedule_rooms_schedule_campus_idx
    ON public.schedule_rooms (schedule_date, campus_name);

COMMIT;
