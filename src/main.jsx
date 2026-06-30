import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';
import { campusRoomDefinitions, campuses, getCampusLabel, getFixedRoomNames } from '../shared/campusRooms.js';
import './styles.css';

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const timelineHours = [
  '08:00 AM',
  '09:00 AM',
  '10:00 AM',
  '11:00 AM',
  '12:00 PM',
  '01:00 PM',
  '02:00 PM',
  '03:00 PM',
  '04:00 PM',
  '05:00 PM',
  '06:00 PM',
];
const timelineBoundaryHours = [...timelineHours, '07:00 PM'];
const blockColors = ['bg-sky-600', 'bg-emerald-600', 'bg-amber-600', 'bg-violet-600', 'bg-rose-600'];

function getCampusFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const campusName = params.get('campus_name');
  return campuses.includes(campusName) ? campusName : campuses[0];
}

const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function scheduleKey(scheduleDate, campus) {
  return `${scheduleDate}::${campus}`;
}

function getRoomRecords(campusName) {
  return getFixedRoomNames(campusName).map((roomName) => ({
    id: roomIdFromName(roomName),
    name: roomName,
  }));
}

function createSchedule(campusName = campuses[0]) {
  return {
    rooms: getRoomRecords(campusName),
    sessions: [],
  };
}

function insertAtIndex(items, index, item) {
  const nextItems = [...items];
  nextItems.splice(Math.min(Math.max(index, 0), nextItems.length), 0, item);
  return nextItems;
}

function isTypingTarget(target) {
  const tagName = target?.tagName?.toLowerCase();
  return tagName === 'input' || tagName === 'select' || tagName === 'textarea' || target?.isContentEditable;
}

function getLastActionIndexForKey(actions, key) {
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    if (actions[index].key === key) {
      return index;
    }
  }

  return -1;
}

function roomIdFromName(roomName) {
  return `room-${roomName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || Date.now()}`;
}

function getCampusFromScheduleKey(key) {
  return String(key).split('::').slice(1).join('::');
}

function createRecurringGroupId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `series-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeRecurrenceDays(value) {
  const sourceValues = Array.isArray(value)
    ? value
    : String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

  return days.filter((dayName) => sourceValues.includes(dayName));
}

function normalizeRecurrenceExceptionDates(value) {
  const sourceValues = Array.isArray(value)
    ? value
    : String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

  return [...new Set(sourceValues)].sort();
}

function normalizeDateInputValue(value) {
  const match = String(value || '')
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (!match) {
    return '';
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function createSessionDraft(selectedDay, selectedScheduleDate, overrides = {}) {
  return {
    startTime: '08:00',
    endTime: '09:00',
    topicBatch: '',
    numStudents: '',
    studentServiceName: '',
    repeatEnabled: false,
    recurrenceDays: [selectedDay],
    recurrenceStartDate: selectedScheduleDate,
    recurrenceEndDate: selectedScheduleDate,
    recurrenceGroupId: null,
    recurrenceExceptionDates: [],
    ...overrides,
  };
}

function buildRecurringScheduleDates(startDate, endDate, recurrenceDays) {
  if (!startDate || !endDate || startDate > endDate) {
    return [];
  }

  const selectedDays = normalizeRecurrenceDays(recurrenceDays);
  const results = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const lastDate = new Date(`${endDate}T00:00:00Z`);

  while (cursor <= lastDate) {
    const scheduleDate = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}-${String(
      cursor.getUTCDate(),
    ).padStart(2, '0')}`;
    const dayName = getDayNameForDate(scheduleDate);

    if (selectedDays.includes(dayName)) {
      results.push(scheduleDate);
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return results;
}

function timeToMinutes(time) {
  const [rawHour, rawMinute] = time.split(':');
  return Number(rawHour) * 60 + Number(rawMinute);
}

function minutesToTimeInput(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function timeInputToLabel(time) {
  const [hourText, minuteText] = time.split(':');
  const hour = Number(hourText);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${String(displayHour).padStart(2, '0')}:${minuteText} ${suffix}`;
}

function labelToTimeInput(label) {
  const match = String(label)
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = match[2];
  const period = match[3].toUpperCase();

  if (period === 'PM' && hour !== 12) {
    hour += 12;
  }

  if (period === 'AM' && hour === 12) {
    hour = 0;
  }

  return `${String(hour).padStart(2, '0')}:${minute}`;
}

function parseTimeSlot(timeSlot) {
  const [startLabel, endLabel] = String(timeSlot).split(' - ');
  const startTime = labelToTimeInput(startLabel);
  const endTime = labelToTimeInput(endLabel);

  if (!startTime || !endTime) {
    return {
      startTime: '08:00',
      endTime: '09:00',
    };
  }

  return clampSession(startTime, endTime);
}

function scheduleFromRows(rows, existingRooms = []) {
  const roomMap = new Map(
    existingRooms.map((room) => {
      const name = typeof room === 'string' ? room : room.name;
      return [
        name,
        {
          id: typeof room === 'string' ? roomIdFromName(room) : room.id || roomIdFromName(name),
          name,
        },
      ];
    }),
  );

  const rooms = Array.from(roomMap.values());
  const sessions = rows
    .filter((row) => row.room_name && roomMap.has(row.room_name) && row.time_slot && row.topic_batch)
    .map((row) => {
      const room = roomMap.get(row.room_name);
      const parsedTime = parseTimeSlot(row.time_slot);

      return {
        id: `session-${row.id || `${room.id}-${row.time_slot}-${row.topic_batch}`}`,
        roomId: room.id,
        startTime: parsedTime.startTime,
        endTime: parsedTime.endTime,
        topicBatch: row.topic_batch,
        numStudents: row.num_students || '',
        studentServiceName: row.student_service_name || '',
        recurrenceGroupId: row.recurrence_group_id || null,
        recurrenceDays: normalizeRecurrenceDays(row.recurrence_days),
        recurrenceStartDate: normalizeDateInputValue(row.recurrence_start_date),
        recurrenceEndDate: normalizeDateInputValue(row.recurrence_end_date),
        recurrenceExceptionDates: normalizeRecurrenceExceptionDates(row.recurrence_exception_dates),
      };
    });

  const mergedSessions = Array.from(
    sessions
      .reduce((sessionMap, session) => {
        const key = [session.roomId, session.startTime, session.endTime].join('||');
        if (!sessionMap.has(key)) {
          sessionMap.set(key, session);
          return sessionMap;
        }

        sessionMap.set(key, session);

        return sessionMap;
      }, new Map())
      .values(),
  );

  return { rooms, sessions: mergedSessions };
}

async function readJsonResponse(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      error: `Server returned ${response.status} ${response.statusText || 'with a non-JSON response'}.`,
    };
  }
}

function clampSession(startTime, endTime) {
  const dayStart = timeToMinutes('08:00');
  const dayEnd = timeToMinutes('18:00');
  const start = Math.max(dayStart, Math.min(timeToMinutes(startTime), dayEnd - 15));
  const end = Math.max(start + 15, Math.min(timeToMinutes(endTime), dayEnd));

  return {
    startTime: minutesToTimeInput(start),
    endTime: minutesToTimeInput(end),
  };
}

function getCurrentMonthInput() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getStartOfCurrentMonthInput() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function getDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getTodayDateInput() {
  return getDateInput(new Date());
}

function getDayNameForDate(scheduleDate) {
  return weekdayNames[new Date(`${scheduleDate}T00:00:00Z`).getUTCDay()];
}

function parseBoardTimeSlot(timeSlot) {
  const [startLabel, endLabel] = String(timeSlot).split(' - ');
  const startTime = labelToTimeInput(startLabel);
  const endTime = labelToTimeInput(endLabel);

  return {
    startMinutes: startTime ? timeToMinutes(startTime) : Number.MAX_SAFE_INTEGER,
    endMinutes: endTime ? timeToMinutes(endTime) : Number.MAX_SAFE_INTEGER,
  };
}

function formatBoardDate(scheduleDate) {
  return new Date(`${scheduleDate}T00:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function LedScheduleBoard() {
  const [campusName, setCampusName] = useState(getCampusFromUrl);
  const [selectedBoardDate, setSelectedBoardDate] = useState(getTodayDateInput);
  const [rows, setRows] = useState([]);
  const [rooms, setRooms] = useState(getFixedRoomNames(getCampusFromUrl()));
  const [dayName, setDayName] = useState(getDayNameForDate(getTodayDateInput()).toUpperCase());
  const [now, setNow] = useState(new Date());
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    async function loadSchedule() {
      const params = new URLSearchParams({
        schedule_date: selectedBoardDate,
      });

      if (campusName !== 'All Campuses') {
        params.set('campus_name', campusName);
      }

      try {
        const response = await fetch(`/api/schedule/tomorrow?${params.toString()}`, {
          signal: controller.signal,
        });
        const payload = await readJsonResponse(response);

        if (!response.ok) {
          throw new Error(payload.error || 'Failed to load entrance schedule.');
        }

        setRows(Array.isArray(payload.rows) ? payload.rows : []);
        setRooms(
          Array.isArray(payload.rooms)
            ? payload.rooms
                .map((room) => (typeof room === 'string' ? room : room?.room_name))
                .filter(Boolean)
            : getFixedRoomNames(campusName),
        );
        setDayName((payload.dayName || getDayNameForDate(selectedBoardDate)).toUpperCase());
        setError('');
      } catch (loadError) {
        if (loadError.name !== 'AbortError') {
          setError(loadError.message);
        }
      }
    }

    loadSchedule();
    const pollId = window.setInterval(loadSchedule, 60000);
    const clockId = window.setInterval(() => setNow(new Date()), 1000);

    return () => {
      controller.abort();
      window.clearInterval(pollId);
      window.clearInterval(clockId);
    };
  }, [campusName, selectedBoardDate]);

  const roomRows = useMemo(() => {
    const sourceRooms = rooms.length > 0 ? rooms : getFixedRoomNames(campusName);
    const roomMap = sourceRooms.reduce((roomList, roomName) => {
      roomList.set(roomName, []);
      return roomList;
    }, new Map());

    rows.forEach((row) => {
      const roomName = row.room_name || 'Unassigned Room';

      if (!roomMap.has(roomName)) {
        if (campusName !== 'All Campuses') {
          return;
        }

        roomMap.set(roomName, []);
      }

      roomMap.get(roomName).push({
        ...row,
        ...parseBoardTimeSlot(row.time_slot),
      });
    });

    return Array.from(roomMap.entries())
      .map(([roomName, sessions]) => ({
        roomName,
        sessions: sessions.sort((first, second) => first.startMinutes - second.startMinutes),
      }))
      .sort((first, second) => first.roomName.localeCompare(second.roomName, undefined, { numeric: true }));
  }, [rows, rooms]);

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const isViewingToday = selectedBoardDate === getTodayDateInput();
  const maxSessions = Math.max(1, ...roomRows.map((room) => room.sessions.length));
  const densityPressure = Math.max(roomRows.length - 4, maxSessions - 4, 0);
  const densityScale = Math.max(0.5, Math.min(1, 1.04 - densityPressure * 0.08));
  const timeFontSize = `clamp(0.72rem, ${densityScale * 1.04}vw, 1.35rem)`;
  const topicFontSize = `clamp(0.58rem, ${densityScale * 0.78}vw, 0.98rem)`;
  const roomFontSize = `clamp(0.78rem, ${densityScale * 1.24}vw, 1.5rem)`;
  const sseFontSize = `clamp(0.56rem, ${densityScale * 0.66}vw, 0.82rem)`;

  return (
    <main className="relative flex h-screen items-center justify-center overflow-hidden bg-[#e5e5e5] p-4 text-black">
      <div className="led-blob led-blob-red" />
      <div className="led-blob led-blob-gray" />
      <div className="led-blob led-blob-soft" />
      <div className="led-glass-particles" />

      <section className="relative z-10 aspect-video w-full max-w-7xl overflow-hidden rounded-[7px] border border-white/70 bg-white/25 p-3 shadow-2xl backdrop-blur-2xl">
        <div className="flex h-full flex-col">
          <header className="grid shrink-0 grid-cols-[1fr_auto] gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-black tracking-wide text-black md:text-4xl lg:text-5xl">
                {campusName}
              </h1>
              <p className="text-base font-bold tracking-wide text-black/70 md:text-lg lg:text-xl">
                {dayName} / {formatBoardDate(selectedBoardDate)}
              </p>
            </div>

            <div className="rounded-[7px] border border-white/50 bg-white/60 px-3 py-2 text-right shadow-lg backdrop-blur-lg">
              <div className="text-base font-black tracking-wide text-black md:text-lg lg:text-xl">
                {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="text-xs font-bold uppercase tracking-wide text-black/55">Refresh 60s</div>
            </div>
          </header>

          <div className="mt-2 grid shrink-0 grid-cols-2 gap-2">
            <label className="text-sm font-bold tracking-wide text-black">
              Campus
              <select
                className="mt-1 h-9 w-full rounded-[7px] border border-white/50 bg-white/60 px-3 text-sm font-bold tracking-wide text-black shadow-lg outline-none backdrop-blur-lg focus:ring-2 focus:ring-white"
                onChange={(event) => setCampusName(event.target.value)}
                value={campusName}
              >
                <option>All Campuses</option>
                {campuses.map((campus) => (
                  <option key={campus}>{campus}</option>
                ))}
              </select>
            </label>

            <label className="text-sm font-bold tracking-wide text-black">
              Date
              <input
                className="mt-1 h-9 w-full rounded-[7px] border border-white/50 bg-white/60 px-3 text-sm font-bold tracking-wide text-black shadow-lg outline-none backdrop-blur-lg focus:ring-2 focus:ring-white"
                onChange={(event) => setSelectedBoardDate(event.target.value)}
                type="date"
                value={selectedBoardDate}
              />
            </label>
          </div>

          <div className="mt-2 min-h-0 flex-1 overflow-hidden">
            {error ? (
              <div className="flex h-full items-center justify-center rounded-[7px] border border-white/50 bg-white/60 text-center text-lg font-black tracking-wide text-black shadow-lg backdrop-blur-lg md:text-xl lg:text-2xl">
                {error}
              </div>
            ) : rows.length === 0 ? (
              <div className="flex h-full items-center justify-center rounded-[7px] border border-white/50 bg-white/60 text-center text-lg font-black tracking-wide text-black shadow-lg backdrop-blur-lg md:text-xl lg:text-2xl">
                No schedules for {dayName}
              </div>
            ) : (
              <div
                className="grid h-full gap-1.5 overflow-hidden"
                style={{ gridTemplateRows: `repeat(${roomRows.length}, minmax(0, 1fr))` }}
              >
                {roomRows.map((room) => (
                  <div className="flex min-h-0 gap-1.5" key={room.roomName}>
                    <aside className="flex w-[18%] min-w-[9.5rem] max-w-[15rem] shrink-0 flex-col justify-center rounded-[7px] border border-white/50 bg-white/55 px-2.5 py-2 text-black shadow-lg backdrop-blur-lg">
                      <div className="break-words font-black leading-tight tracking-wide" style={{ fontSize: roomFontSize }}>
                        {room.roomName}
                      </div>
                    </aside>

                    <div className="grid min-w-0 flex-1 auto-rows-fr gap-1.5 overflow-hidden rounded-[7px] border border-white/35 bg-white/20 p-1.5 backdrop-blur-md md:grid-cols-2 xl:grid-cols-3">
                      {room.sessions.length === 0 ? (
                        <div className="flex min-w-0 items-center justify-center rounded-[7px] border border-dashed border-white/50 bg-white/30 text-sm font-bold tracking-wide text-black/45 backdrop-blur-lg md:col-span-2 xl:col-span-3">
                          No sessions scheduled
                        </div>
                      ) : (
                        room.sessions.map((session) => {
                          const isLive =
                            isViewingToday &&
                            Number.isFinite(session.startMinutes) &&
                            currentMinutes >= session.startMinutes &&
                            currentMinutes <= session.endMinutes;

                          return (
                            <article
                              className={[
                                'led-session-card relative flex min-w-0 flex-col justify-center overflow-hidden rounded-[7px] border border-white/50 bg-white/60 px-2.5 py-2 text-black shadow-lg backdrop-blur-lg',
                                isLive ? 'led-session-live' : '',
                              ].join(' ')}
                              key={session.id || `${room.roomName}-${session.time_slot}-${session.topic_batch}`}
                            >
                              <div
                                className="relative z-10 break-words font-black uppercase leading-tight tracking-wide text-black/85"
                                style={{ fontSize: timeFontSize }}
                              >
                                {session.time_slot}
                              </div>
                              <div
                                className="relative z-10 mt-1 break-words font-black leading-tight tracking-wide text-black"
                                style={{ fontSize: topicFontSize }}
                              >
                                {session.topic_batch}
                              </div>
                              {session.student_service_name ? (
                                <div
                                  className="relative z-10 mt-1 break-words font-bold leading-tight tracking-wide text-black/65"
                                  style={{ fontSize: sseFontSize }}
                                >
                                  SSE-{session.student_service_name}
                                </div>
                              ) : null}
                            </article>
                          );
                        })
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

const analyticsCampusOptions = [
  { label: 'All', value: '' },
  ...campusRoomDefinitions.map((campus) => ({ label: campus.label, value: campus.value })),
];

function getAnalyticsCampusLabel(campusName) {
  return getCampusLabel(campusName);
}

function formatReportDateRangeLabel(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();

  if (sameMonth) {
    return `${start.toLocaleDateString(undefined, {
      month: 'long',
    })} ${start.getDate()}-${end.getDate()}, ${start.getFullYear()}`;
  }

  if (sameYear) {
    return `${start.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })} - ${end.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })}`;
  }

  return `${start.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })} - ${end.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;
}

function getExcelSafeSheetName(name) {
  return String(name || 'Sheet')
    .replace(/[:\\/?*[\]]/g, ' ')
    .slice(0, 31);
}

function getRoomCapacity(row) {
  return row.room_capacity || row.capacity || '';
}

function styleHeaderRow(worksheet, headerCount) {
  for (let columnIndex = 0; columnIndex < headerCount; columnIndex += 1) {
    const address = XLSX.utils.encode_cell({ r: 0, c: columnIndex });

    if (worksheet[address]) {
      worksheet[address].s = {
        font: { bold: true },
      };
    }
  }
}

function getUtilizationMeta(hoursUsed) {
  const hours = Number(hoursUsed || 0);

  if (hours > 100) {
    return {
      badgeClass: 'bg-orange-100 text-orange-800 ring-orange-200',
      barClass: 'bg-orange-500',
      label: 'High',
    };
  }

  if (hours >= 40) {
    return {
      badgeClass: 'bg-amber-100 text-amber-800 ring-amber-200',
      barClass: 'bg-amber-500',
      label: 'Moderate',
    };
  }

  return {
    badgeClass: 'bg-sky-100 text-sky-800 ring-sky-200',
    barClass: 'bg-sky-500',
    label: 'Low',
  };
}

function ManagerAnalytics() {
  const [selectedCampus, setSelectedCampus] = useState('');
  const [startDate, setStartDate] = useState(getStartOfCurrentMonthInput);
  const [endDate, setEndDate] = useState(getTodayDateInput);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState({ type: 'loading', message: 'Loading manager analytics...' });
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadAnalytics() {
      setStatus({ type: 'loading', message: 'Loading manager analytics...' });

      try {
        const params = new URLSearchParams({ start_date: startDate, end_date: endDate });

        if (selectedCampus) {
          params.set('campus_name', selectedCampus);
        }

        const response = await fetch(`/api/room-usage-history/summary?${params.toString()}`, {
          signal: controller.signal,
        });
        const payload = await readJsonResponse(response);

        if (!response.ok) {
          throw new Error(payload.error || 'Failed to load manager analytics.');
        }

        setRows(payload.rows || []);
        setStatus({ type: 'idle', message: '' });
      } catch (error) {
        if (error.name !== 'AbortError') {
          setRows([]);
          setStatus({ type: 'error', message: error.message });
        }
      }
    }

    if (!startDate || !endDate || startDate > endDate) {
      setRows([]);
      setStatus({ type: 'error', message: 'Choose a valid report date range.' });
      return () => controller.abort();
    }

    loadAnalytics();

    return () => controller.abort();
  }, [selectedCampus, startDate, endDate]);

  const campusGroups = useMemo(() => {
    const groupedRows = new Map();

    rows.forEach((row) => {
      const campusName = row.campus_name || 'Unknown Campus';
      const campusRows = groupedRows.get(campusName) || [];

      campusRows.push(row);
      groupedRows.set(campusName, campusRows);
    });

    return Array.from(groupedRows.entries())
      .sort(([firstCampus], [secondCampus]) =>
        getAnalyticsCampusLabel(firstCampus).localeCompare(getAnalyticsCampusLabel(secondCampus)),
      )
      .map(([campusName, campusRows]) => ({
        campusName,
        rows: campusRows.sort((firstRow, secondRow) => {
          const timesDifference = Number(secondRow.total_times_used || 0) - Number(firstRow.total_times_used || 0);

          if (timesDifference !== 0) {
            return timesDifference;
          }

          return Number(secondRow.total_hours_used || 0) - Number(firstRow.total_hours_used || 0);
        }),
      }));
  }, [rows]);

  async function exportRangeReport() {
    setIsExporting(true);

    try {
      if (!startDate || !endDate || startDate > endDate) {
        throw new Error('Choose a valid report date range.');
      }

      const params = new URLSearchParams({ start_date: startDate, end_date: endDate });

      if (selectedCampus) {
        params.set('campus_name', selectedCampus);
      }

      const response = await fetch(`/api/room-usage-history/summary?${params.toString()}`);
      const payload = await readJsonResponse(response);

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load export data.');
      }

      const exportRows = Array.isArray(payload.rows) ? payload.rows : [];
      const includedCampuses = analyticsCampusOptions.filter((campus) =>
        selectedCampus ? campus.value === selectedCampus : campus.value,
      );
      const exportCampusGroups = includedCampuses
        .map((campus) => ({
          ...campus,
          rows: (() => {
            const campusRows = exportRows.filter((row) => row.campus_name === campus.value);
            const fixedRooms = getFixedRoomNames(campus.value);

            if (fixedRooms.length === 0) {
              return campusRows.sort((firstRow, secondRow) =>
                String(firstRow.room_name).localeCompare(String(secondRow.room_name), undefined, { numeric: true }),
              );
            }

            const rowMap = new Map(campusRows.map((row) => [row.room_name, row]));

            return fixedRooms.map((roomName) => ({
              campus_name: campus.value,
              room_name: roomName,
              room_capacity: rowMap.get(roomName)?.room_capacity || '',
              total_times_used: Number(rowMap.get(roomName)?.total_times_used || 0),
              total_hours_used: Number(rowMap.get(roomName)?.total_hours_used || 0),
            }));
          })(),
        }))
        .filter((group) => group.rows.length > 0);
      const workbook = XLSX.utils.book_new();
      const totalRooms = exportCampusGroups.reduce((total, group) => total + group.rows.length, 0);
      const totalTimesUsed = exportCampusGroups.reduce(
        (total, group) => total + group.rows.reduce((groupTotal, row) => groupTotal + Number(row.total_times_used || 0), 0),
        0,
      );
      const totalHoursUsed = exportCampusGroups.reduce(
        (total, group) => total + group.rows.reduce((groupTotal, row) => groupTotal + Number(row.total_hours_used || 0), 0),
        0,
      );
      const summaryRows = [
        ['KPI', 'Value'],
        ['Total Rooms Reported', totalRooms],
        ['Total Times Used', totalTimesUsed],
        ['Total Hours Used', Number(totalHoursUsed.toFixed(2))],
        [],
        ['Campus', 'Rooms Reported', 'Total Times Used', 'Total Hours Used'],
        ...exportCampusGroups.map((group) => [
          group.label,
          group.rows.length,
          group.rows.reduce((total, row) => total + Number(row.total_times_used || 0), 0),
          Number(group.rows.reduce((total, row) => total + Number(row.total_hours_used || 0), 0).toFixed(2)),
        ]),
      ];
      const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
      styleHeaderRow(summarySheet, 2);
      ['A6', 'B6', 'C6', 'D6'].forEach((cell) => {
        if (summarySheet[cell]) {
          summarySheet[cell].s = { font: { bold: true } };
        }
      });
      summarySheet['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Overall Summary');

      exportCampusGroups.forEach((group) => {
        const sheetRows = [
          ['Room Name', 'Room Capacity', 'Total Times Used', 'Total Hours Occupied'],
          ...group.rows.map((row) => [
            row.room_name,
            getRoomCapacity(row),
            Number(row.total_times_used || 0),
            Number(Number(row.total_hours_used || 0).toFixed(2)),
          ]),
        ];
        const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
        styleHeaderRow(worksheet, 4);
        worksheet['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 18 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(workbook, worksheet, getExcelSafeSheetName(group.label));
      });

      const fileRange = `${startDate}_to_${endDate}`;
      XLSX.writeFile(workbook, `University_Room_KPI_Report_${fileRange}.xlsx`, { cellStyles: true });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <section className="mx-auto max-w-[1500px] px-5 py-5">
      <div className="mb-5 border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_220px_220px_220px_auto] lg:items-end">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Manager Analytics</h1>
            <p className="mt-1 text-sm text-zinc-600">Filter room utilization by campus and exact date range.</p>
          </div>

          <label className="text-sm font-semibold text-zinc-700">
            Select Campus
            <select
              className="mt-2 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-950 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
              onChange={(event) => setSelectedCampus(event.target.value)}
              value={selectedCampus}
            >
              {analyticsCampusOptions.map((campus) => (
                <option key={campus.label} value={campus.value}>
                  {campus.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-semibold text-zinc-700">
            Start Date
            <input
              className="mt-2 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-950 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
              onChange={(event) => setStartDate(event.target.value)}
              type="date"
              value={startDate}
            />
          </label>

          <label className="text-sm font-semibold text-zinc-700">
            End Date
            <input
              className="mt-2 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-950 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
              min={startDate}
              onChange={(event) => setEndDate(event.target.value)}
              type="date"
              value={endDate}
            />
          </label>

          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-emerald-500/30 bg-white/80 px-4 text-sm font-bold text-zinc-800 shadow-sm backdrop-blur-md transition hover:border-emerald-500/50 hover:bg-white hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isExporting}
            onClick={exportRangeReport}
            type="button"
          >
            <span aria-hidden="true">📗</span>
            {isExporting ? 'Preparing...' : 'Export Excel Report'}
          </button>
        </div>
      </div>

      {status.type === 'error' ? (
        <div className="border border-red-200 bg-white px-4 py-10 text-center text-sm font-medium text-red-700 shadow-sm">
          {status.message}
        </div>
      ) : status.type === 'loading' ? (
        <div className="border border-zinc-200 bg-white px-4 py-10 text-center text-sm font-medium text-zinc-600 shadow-sm">
          {status.message}
        </div>
      ) : campusGroups.length === 0 ? (
        <div className="border border-zinc-200 bg-white px-4 py-10 text-center text-sm font-medium text-zinc-600 shadow-sm">
          No room usage history found for this campus and date range.
        </div>
      ) : (
        <div className="grid gap-5">
          {campusGroups.map((group) => (
            <div className="border border-zinc-200 bg-white shadow-sm" key={group.campusName}>
              <div className="border-b border-zinc-200 px-5 py-4">
                <h2 className="text-lg font-bold text-zinc-950">
                  {getAnalyticsCampusLabel(group.campusName)} Analytics
                </h2>
                <p className="mt-1 text-sm text-zinc-600">
                  {group.rows.length} room{group.rows.length === 1 ? '' : 's'} from {formatReportDateRangeLabel(startDate, endDate)}.
                </p>
              </div>

              <div className="divide-y divide-zinc-100">
                <div className="hidden grid-cols-[1.5fr_0.9fr_0.9fr_1.2fr] bg-zinc-50 px-5 py-3 text-xs font-semibold uppercase text-zinc-500 lg:grid">
                  <div>Room Name</div>
                  <div className="text-right">Total Times Used</div>
                  <div className="text-right">Total Hours Used</div>
                  <div>Utilization</div>
                </div>

                {group.rows.map((row) => {
                  const hoursUsed = Number(row.total_hours_used || 0);
                  const utilization = getUtilizationMeta(hoursUsed);
                  const progressWidth = `${Math.min(100, Math.round((hoursUsed / 120) * 100))}%`;

                  return (
                    <div
                      className="grid gap-3 px-5 py-4 lg:grid-cols-[1.5fr_0.9fr_0.9fr_1.2fr] lg:items-center"
                      key={`${group.campusName}-${row.room_name}`}
                    >
                      <div>
                        <div className="text-sm font-semibold text-zinc-950">{row.room_name}</div>
                        <div className="mt-1 text-xs text-zinc-500 lg:hidden">
                          Used {row.total_times_used} times
                        </div>
                      </div>
                      <div className="hidden text-right text-sm font-semibold text-zinc-950 lg:block">
                        {row.total_times_used}
                      </div>
                      <div className="hidden text-right text-sm font-semibold text-zinc-950 lg:block">
                        {hoursUsed.toFixed(2)}
                      </div>
                      <div>
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${utilization.badgeClass}`}
                          >
                            {utilization.label}
                          </span>
                          <span className="text-xs font-semibold text-zinc-600 lg:hidden">{hoursUsed.toFixed(2)} hrs</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                          <div className={`h-full rounded-full ${utilization.barClass}`} style={{ width: progressWidth }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState('schedule');
  const [selectedCampus, setSelectedCampus] = useState(campuses[0]);
  const [selectedScheduleDate, setSelectedScheduleDate] = useState(getTodayDateInput);
  const [schedules, setSchedules] = useState(() => ({
    [scheduleKey(getTodayDateInput(), campuses[0])]: createSchedule(campuses[0]),
  }));
  const [loadedKeys, setLoadedKeys] = useState({});
  const [modalRoomId, setModalRoomId] = useState(null);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [expandedSessionId, setExpandedSessionId] = useState(null);
  const [sessionDraft, setSessionDraft] = useState(() => createSessionDraft(getDayNameForDate(getTodayDateInput()), getTodayDateInput()));
  const [status, setStatus] = useState({ type: 'idle', message: '' });
  const [undoStack, setUndoStack] = useState([]);
  const [deletedRecurringGroupIdsByKey, setDeletedRecurringGroupIdsByKey] = useState({});

  const selectedDay = getDayNameForDate(selectedScheduleDate);
  const activeKey = scheduleKey(selectedScheduleDate, selectedCampus);
  const activeSchedule = schedules[activeKey] || createSchedule(selectedCampus);
  const activeSessions = activeSchedule.sessions;
  const deletedRecurringGroupIds = deletedRecurringGroupIdsByKey[activeKey] || [];
  const activeUndoActionIndex = getLastActionIndexForKey(undoStack, activeKey);
  const activeUndoAction = activeUndoActionIndex === -1 ? null : undoStack[activeUndoActionIndex];

  useEffect(() => {
    if (loadedKeys[activeKey]) {
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      schedule_date: selectedScheduleDate,
      campus_name: selectedCampus,
    });

    async function loadSchedule() {
      setStatus({ type: 'loading', message: `Loading ${selectedScheduleDate} schedule...` });

      try {
        const response = await fetch(`/api/weekly-kpi/schedule?${params.toString()}`, {
          signal: controller.signal,
        });
        const payload = await readJsonResponse(response);

        if (!response.ok) {
          throw new Error(payload.error || 'Load failed.');
        }

        setSchedules((currentSchedules) => {
          const currentSchedule = ensureSchedule(currentSchedules, activeKey);
          const savedRooms =
            Array.isArray(payload.rooms) && payload.rooms.length > 0 ? payload.rooms : getFixedRoomNames(selectedCampus);

          return {
            ...currentSchedules,
            [activeKey]: scheduleFromRows(payload.rows || [], savedRooms),
          };
        });
        setLoadedKeys((currentLoadedKeys) => ({
          ...currentLoadedKeys,
          [activeKey]: true,
        }));
        setStatus({ type: 'idle', message: '' });
      } catch (error) {
        if (error.name !== 'AbortError') {
          setStatus({ type: 'error', message: error.message });
        }
      }
    }

    loadSchedule();

    return () => controller.abort();
  }, [activeKey, loadedKeys, selectedCampus, selectedScheduleDate]);

  const rowsToPublish = useMemo(
    () =>
      activeSessions.map((session) => {
        const room = activeSchedule.rooms.find((candidate) => candidate.id === session.roomId);
        const roomName = room?.name.trim();

        return {
          schedule_date: selectedScheduleDate,
          day_name: selectedDay,
          campus_name: selectedCampus,
          room_name: roomName || 'Enter room name',
          time_slot: `${timeInputToLabel(session.startTime)} - ${timeInputToLabel(session.endTime)}`,
          topic_batch: session.topicBatch,
          num_students: session.numStudents,
          student_service_name: session.studentServiceName,
          recurrence_group_id: session.recurrenceGroupId || null,
          recurrence_days: session.recurrenceDays || [],
          recurrence_start_date: session.recurrenceStartDate || null,
          recurrence_end_date: session.recurrenceEndDate || null,
          recurrence_exception_dates: session.recurrenceExceptionDates || [],
        };
      }),
    [activeSchedule.rooms, activeSessions, selectedCampus, selectedDay, selectedScheduleDate],
  );

  const seriesRowsToPublish = useMemo(() => {
    const seriesMap = new Map();

    Object.entries(schedules).forEach(([key, schedule]) => {
      if (getCampusFromScheduleKey(key) !== selectedCampus) {
        return;
      }

      schedule.sessions.forEach((session) => {
        if (!session.recurrenceGroupId || seriesMap.has(session.recurrenceGroupId)) {
          return;
        }

        const room = schedule.rooms.find((candidate) => candidate.id === session.roomId);
        const roomName = room?.name.trim();

        if (!roomName) {
          return;
        }

        seriesMap.set(session.recurrenceGroupId, {
          schedule_date: session.recurrenceStartDate || selectedScheduleDate,
          day_name: session.recurrenceDays?.[0] || selectedDay,
          campus_name: selectedCampus,
          room_name: roomName,
          time_slot: `${timeInputToLabel(session.startTime)} - ${timeInputToLabel(session.endTime)}`,
          topic_batch: session.topicBatch,
          num_students: session.numStudents,
          student_service_name: session.studentServiceName,
          recurrence_group_id: session.recurrenceGroupId,
          recurrence_days: session.recurrenceDays || [],
          recurrence_start_date: session.recurrenceStartDate || null,
          recurrence_end_date: session.recurrenceEndDate || null,
          recurrence_exception_dates: session.recurrenceExceptionDates || [],
        });
      });
    });

    return Array.from(seriesMap.values());
  }, [schedules, selectedCampus, selectedDay, selectedScheduleDate]);

  function ensureSchedule(currentSchedules, key) {
    return currentSchedules[key] || createSchedule(getCampusFromScheduleKey(key));
  }

  function pushUndoAction(action) {
    setUndoStack((currentStack) => [...currentStack, action].slice(-30));
  }

  function removeUndoActionsForKey(key) {
    setUndoStack((currentStack) => currentStack.filter((action) => action.key !== key));
  }

  function invalidateCampusScheduleCache(campusName, keepKey = null) {
    setLoadedKeys((currentLoadedKeys) =>
      Object.fromEntries(
        Object.entries(currentLoadedKeys).filter(([key]) => {
          const sameCampus = getCampusFromScheduleKey(key) === campusName;
          return sameCampus ? key === keepKey : true;
        }),
      ),
    );
  }

  function undoLastCanvasAction() {
    const actionIndex = getLastActionIndexForKey(undoStack, activeKey);

    if (actionIndex === -1) {
      return;
    }

    const actionToRestore = undoStack[actionIndex];
    setUndoStack((currentStack) => currentStack.filter((_, index) => index !== actionIndex));

    setSchedules((currentSchedules) => {
      const currentSchedule = ensureSchedule(currentSchedules, actionToRestore.key);

      if (actionToRestore.type === 'recurring-session-delete') {
        const exceptionDate = actionToRestore.exceptionDate;
        const recurrenceGroupId = actionToRestore.recurrenceGroupId;

        return Object.fromEntries(
          Object.entries(currentSchedules).map(([key, schedule]) => {
            if (getCampusFromScheduleKey(key) !== getCampusFromScheduleKey(actionToRestore.key)) {
              return [key, schedule];
            }

            const nextSessions = schedule.sessions.map((session) => {
              if (session.recurrenceGroupId !== recurrenceGroupId) {
                return session;
              }

              return {
                ...session,
                recurrenceExceptionDates: normalizeRecurrenceExceptionDates(
                  (session.recurrenceExceptionDates || []).filter((date) => date !== exceptionDate),
                ),
              };
            });

            if (key !== actionToRestore.key) {
              return [key, { ...schedule, sessions: nextSessions }];
            }

            if (nextSessions.some((session) => session.id === actionToRestore.session.id)) {
              return [key, { ...schedule, sessions: nextSessions }];
            }

            return [
              key,
              {
                ...schedule,
                sessions: insertAtIndex(nextSessions, actionToRestore.sessionIndex, {
                  ...actionToRestore.session,
                  recurrenceExceptionDates: normalizeRecurrenceExceptionDates(
                    (actionToRestore.session.recurrenceExceptionDates || []).filter((date) => date !== exceptionDate),
                  ),
                }),
              },
            ];
          }),
        );
      }

      if (actionToRestore.type === 'session-delete') {
        if (currentSchedule.sessions.some((session) => session.id === actionToRestore.session.id)) {
          return currentSchedules;
        }

        return {
          ...currentSchedules,
          [actionToRestore.key]: {
            ...currentSchedule,
            sessions: insertAtIndex(currentSchedule.sessions, actionToRestore.sessionIndex, actionToRestore.session),
          },
        };
      }

      return currentSchedules;
    });

    setExpandedSessionId(null);
    setStatus({ type: 'success', message: `Undid ${actionToRestore.label}.` });
  }

  useEffect(() => {
    function handleUndoShortcut(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey && !isTypingTarget(event.target)) {
        event.preventDefault();
        undoLastCanvasAction();
      }
    }

    window.addEventListener('keydown', handleUndoShortcut);
    return () => window.removeEventListener('keydown', handleUndoShortcut);
  }, [activeKey, undoStack]);

  function switchScheduleDate(scheduleDate) {
    setSelectedScheduleDate(scheduleDate);
    setStatus({ type: 'idle', message: '' });
  }

  function switchCampus(campus) {
    setSelectedCampus(campus);
    setStatus({ type: 'idle', message: '' });
  }

  function toggleRecurrenceDay(dayName) {
    setSessionDraft((draft) => {
      const alreadySelected = draft.recurrenceDays.includes(dayName);
      const nextDays = alreadySelected
        ? draft.recurrenceDays.filter((currentDay) => currentDay !== dayName)
        : [...draft.recurrenceDays, dayName];

      return {
        ...draft,
        recurrenceDays: normalizeRecurrenceDays(nextDays),
      };
    });
  }

  function applySessionSave(updateScope = 'single') {
    if (!modalRoomId || !sessionDraft.topicBatch.trim()) {
      return;
    }

    const recurrenceDays = normalizeRecurrenceDays(sessionDraft.recurrenceDays);
    const isSeriesUpdate = updateScope === 'series';

    if (sessionDraft.repeatEnabled && isSeriesUpdate) {
      if (!sessionDraft.recurrenceStartDate || !sessionDraft.recurrenceEndDate || recurrenceDays.length === 0) {
        setStatus({ type: 'error', message: 'Choose at least one weekday and a valid repeat date range.' });
        return;
      }

      if (sessionDraft.recurrenceStartDate > sessionDraft.recurrenceEndDate) {
        setStatus({ type: 'error', message: 'Repeat end date must be on or after the repeat start date.' });
        return;
      }
    }

    const normalizedTime = clampSession(sessionDraft.startTime, sessionDraft.endTime);
    const existingSession = editingSessionId
      ? activeSchedule.sessions.find((session) => session.id === editingSessionId)
      : null;
    const recurrenceGroupId =
      sessionDraft.repeatEnabled && isSeriesUpdate ? sessionDraft.recurrenceGroupId || createRecurringGroupId() : null;
    const nextSession = {
      roomId: modalRoomId,
      startTime: normalizedTime.startTime,
      endTime: normalizedTime.endTime,
      topicBatch: sessionDraft.topicBatch.trim(),
      numStudents: sessionDraft.numStudents.trim(),
      studentServiceName: sessionDraft.studentServiceName.trim(),
      recurrenceGroupId,
      recurrenceDays: sessionDraft.repeatEnabled && isSeriesUpdate ? recurrenceDays : [],
      recurrenceStartDate: sessionDraft.repeatEnabled && isSeriesUpdate ? sessionDraft.recurrenceStartDate : null,
      recurrenceEndDate: sessionDraft.repeatEnabled && isSeriesUpdate ? sessionDraft.recurrenceEndDate : null,
      recurrenceExceptionDates:
        sessionDraft.repeatEnabled && isSeriesUpdate ? normalizeRecurrenceExceptionDates(sessionDraft.recurrenceExceptionDates) : [],
    };
    const recurrenceScheduleDates =
      sessionDraft.repeatEnabled && isSeriesUpdate
        ? buildRecurringScheduleDates(sessionDraft.recurrenceStartDate, sessionDraft.recurrenceEndDate, recurrenceDays).filter(
            (scheduleDate) => !nextSession.recurrenceExceptionDates.includes(scheduleDate),
          )
        : [selectedScheduleDate];

    if (sessionDraft.repeatEnabled && isSeriesUpdate && recurrenceScheduleDates.length === 0) {
      setStatus({ type: 'error', message: 'No matching dates were found in the selected repeat range.' });
      return;
    }

    if (existingSession?.recurrenceGroupId && isSeriesUpdate && existingSession.recurrenceGroupId !== recurrenceGroupId) {
      setDeletedRecurringGroupIdsByKey((currentState) => ({
        ...currentState,
        [activeKey]: [...new Set([...(currentState[activeKey] || []), existingSession.recurrenceGroupId])],
      }));
    }

    setSchedules((currentSchedules) => {
      if (existingSession?.recurrenceGroupId && !isSeriesUpdate) {
        const exceptionDate = selectedScheduleDate;
        const nextSchedules = Object.fromEntries(
          Object.entries(currentSchedules).map(([key, schedule]) => {
            if (getCampusFromScheduleKey(key) !== selectedCampus) {
              return [key, schedule];
            }

            const scheduleDate = key.split('::')[0];
            const nextSessions = [];

            schedule.sessions.forEach((session) => {
              if (session.recurrenceGroupId !== existingSession.recurrenceGroupId) {
                nextSessions.push(session);
                return;
              }

              const nextExceptionDates = normalizeRecurrenceExceptionDates([
                ...(session.recurrenceExceptionDates || []),
                exceptionDate,
              ]);

              if (scheduleDate !== exceptionDate) {
                nextSessions.push({
                  ...session,
                  recurrenceExceptionDates: nextExceptionDates,
                });
              }
            });

            return [
              key,
              {
                ...schedule,
                sessions: nextSessions,
              },
            ];
          }),
        );

        const currentSchedule = ensureSchedule(nextSchedules, activeKey);

        nextSchedules[activeKey] = {
          ...currentSchedule,
          sessions: [
            ...currentSchedule.sessions,
            {
              id: editingSessionId || `session-${Date.now()}`,
              ...nextSession,
            },
          ],
        };

        return nextSchedules;
      }

      const schedulesWithoutPreviousSeries =
        existingSession?.recurrenceGroupId && existingSession.recurrenceGroupId !== recurrenceGroupId
          ? Object.fromEntries(
              Object.entries(currentSchedules).map(([key, schedule]) => {
                if (getCampusFromScheduleKey(key) !== selectedCampus) {
                  return [key, schedule];
                }

                return [
                  key,
                  {
                    ...schedule,
                    sessions: schedule.sessions.filter(
                      (session) => session.recurrenceGroupId !== existingSession.recurrenceGroupId,
                    ),
                  },
                ];
              }),
            )
          : currentSchedules;

      if (isSeriesUpdate) {
        const nextSchedules = Object.fromEntries(
          Object.entries(schedulesWithoutPreviousSeries).map(([key, schedule]) => {
            if (getCampusFromScheduleKey(key) !== selectedCampus) {
              return [key, schedule];
            }

            return [
              key,
              {
                ...schedule,
                sessions: schedule.sessions.filter((session) => session.recurrenceGroupId !== recurrenceGroupId),
              },
            ];
          }),
        );

        recurrenceScheduleDates.forEach((scheduleDate) => {
          const scheduleKeyValue = scheduleKey(scheduleDate, selectedCampus);
          const scheduleForDate = ensureSchedule(nextSchedules, scheduleKeyValue);

          nextSchedules[scheduleKeyValue] = {
            ...scheduleForDate,
            sessions: [
              ...scheduleForDate.sessions.filter((session) => session.id !== editingSessionId),
              {
                id: scheduleDate === selectedScheduleDate && editingSessionId ? editingSessionId : `session-${Date.now()}-${scheduleDate}`,
                ...nextSession,
              },
            ],
          };
        });

        return nextSchedules;
      }

      const currentSchedule = ensureSchedule(schedulesWithoutPreviousSeries, activeKey);

      return {
        ...schedulesWithoutPreviousSeries,
        [activeKey]: {
          ...currentSchedule,
          sessions: editingSessionId
            ? currentSchedule.sessions.map((session) =>
                session.id === editingSessionId
                  ? {
                      ...session,
                      ...nextSession,
                    }
                  : session,
              )
            : [
                ...currentSchedule.sessions,
                {
                  id: `session-${Date.now()}`,
                  ...nextSession,
                },
              ],
        },
      };
    });

    if (isSeriesUpdate) {
      setStatus({
        type: 'success',
        message: `Prepared ${recurrenceScheduleDates.length} repeated date${recurrenceScheduleDates.length === 1 ? '' : 's'}. Click Save Schedule to store them.`,
      });
    } else if (existingSession?.recurrenceGroupId) {
      setStatus({ type: 'success', message: 'Prepared a one-time update for this date only. Click Save Schedule to store it.' });
    }

    closeSessionModal();
  }

  function openSessionModal(roomId) {
    setModalRoomId(roomId);
    setEditingSessionId(null);
    setSessionDraft(createSessionDraft(selectedDay, selectedScheduleDate));
  }

  function closeSessionModal() {
    setModalRoomId(null);
    setEditingSessionId(null);
    setSessionDraft(createSessionDraft(selectedDay, selectedScheduleDate));
  }

  function openEditSession(session) {
    setModalRoomId(session.roomId);
    setEditingSessionId(session.id);
    setExpandedSessionId(null);
    setSessionDraft(
      createSessionDraft(selectedDay, selectedScheduleDate, {
        startTime: session.startTime,
        endTime: session.endTime,
        topicBatch: session.topicBatch,
        numStudents: session.numStudents,
        studentServiceName: session.studentServiceName,
        repeatEnabled: Boolean(session.recurrenceGroupId),
        recurrenceDays: session.recurrenceDays?.length ? session.recurrenceDays : [selectedDay],
        recurrenceStartDate: normalizeDateInputValue(session.recurrenceStartDate) || selectedScheduleDate,
        recurrenceEndDate: normalizeDateInputValue(session.recurrenceEndDate) || selectedScheduleDate,
        recurrenceGroupId: session.recurrenceGroupId,
        recurrenceExceptionDates: session.recurrenceExceptionDates || [],
      }),
    );
  }

  function saveSession(event) {
    event.preventDefault();
    applySessionSave(sessionDraft.repeatEnabled ? 'series' : 'single');
  }

  function removeSession(sessionId) {
    const deletedSessionIndex = activeSchedule.sessions.findIndex((session) => session.id === sessionId);
    const deletedSession = activeSchedule.sessions[deletedSessionIndex];

    if (!deletedSession) {
      return;
    }

    if (deletedSession.recurrenceGroupId) {
      const exceptionDate = selectedScheduleDate;

      pushUndoAction({
        key: activeKey,
        type: 'recurring-session-delete',
        label: `${deletedSession.topicBatch} repeated schedule deletion`,
        session: deletedSession,
        sessionIndex: deletedSessionIndex,
        recurrenceGroupId: deletedSession.recurrenceGroupId,
        exceptionDate,
      });

      setSchedules((currentSchedules) =>
        Object.fromEntries(
          Object.entries(currentSchedules).map(([key, schedule]) => {
            if (getCampusFromScheduleKey(key) !== selectedCampus) {
              return [key, schedule];
            }

            const scheduleDate = key.split('::')[0];
            const nextSessions = [];

            schedule.sessions.forEach((session) => {
              if (session.recurrenceGroupId !== deletedSession.recurrenceGroupId) {
                nextSessions.push(session);
                return;
              }

              const nextExceptionDates = normalizeRecurrenceExceptionDates([
                ...(session.recurrenceExceptionDates || []),
                exceptionDate,
              ]);

              if (scheduleDate !== exceptionDate) {
                nextSessions.push({
                  ...session,
                  recurrenceExceptionDates: nextExceptionDates,
                });
              }
            });

            return [
              key,
              {
                ...schedule,
                sessions: nextSessions,
              },
            ];
          }),
        ),
      );
      setDeletedRecurringGroupIdsByKey((currentState) => ({
        ...currentState,
        [activeKey]: (currentState[activeKey] || []).filter((groupId) => groupId !== deletedSession.recurrenceGroupId),
      }));
      setStatus({ type: 'success', message: 'Removed this repeated schedule only. Save Schedule to apply the exception date.' });
      return;
    }

    pushUndoAction({
      key: activeKey,
      type: 'session-delete',
      label: `${deletedSession.topicBatch} session deletion`,
      session: deletedSession,
      sessionIndex: deletedSessionIndex,
    });

    setSchedules((currentSchedules) => {
      const currentSchedule = ensureSchedule(currentSchedules, activeKey);

      return {
        ...currentSchedules,
        [activeKey]: {
          ...currentSchedule,
          sessions: currentSchedule.sessions.filter((session) => session.id !== sessionId),
        },
      };
    });
  }

  function getSessionStyle(session) {
    const dayStart = timeToMinutes('08:00');
    const visualDayEnd = timeToMinutes('19:00');
    const start = timeToMinutes(session.startTime);
    const end = Math.min(timeToMinutes(session.endTime), visualDayEnd);
    const left = ((start - dayStart) / (visualDayEnd - dayStart)) * 100;
    const width = ((end - start) / (visualDayEnd - dayStart)) * 100;

    return {
      left: `${Math.max(0, left)}%`,
      width: `${Math.min(100 - Math.max(0, left), Math.max(5, width))}%`,
    };
  }

  async function saveScheduleSnapshot() {
    const response = await fetch('/api/weekly-kpi/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schedule_date: selectedScheduleDate,
        day_name: selectedDay,
        campus_name: selectedCampus,
        rooms: activeSchedule.rooms.map((room) => room.name.trim()).filter(Boolean),
        rows: rowsToPublish,
        series_rows: seriesRowsToPublish,
        deleted_recurrence_group_ids: deletedRecurringGroupIds,
      }),
    });

    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(payload.error || 'Publish failed.');
    }

    invalidateCampusScheduleCache(selectedCampus);
    setLoadedKeys((currentLoadedKeys) => ({
      ...currentLoadedKeys,
      [activeKey]: true,
    }));
    setDeletedRecurringGroupIdsByKey((currentState) => ({
      ...currentState,
      [activeKey]: [],
    }));
    removeUndoActionsForKey(activeKey);

    return payload;
  }

  async function publishSchedule() {
    setStatus({ type: 'loading', message: `Saving ${selectedScheduleDate} at ${selectedCampus}...` });

    try {
      const payload = await saveScheduleSnapshot();
      const repeatedSuffix =
        payload.repeatedRows > payload.sourceRows
          ? ` Expanded to ${payload.repeatedRows} dated session${payload.repeatedRows === 1 ? '' : 's'}.`
          : '';

      setStatus({
        type: 'success',
        message: `Saved ${payload.sourceRows} session${payload.sourceRows === 1 ? '' : 's'}.${repeatedSuffix} Room usage history will auto-finalize at 11:00 PM.`,
      });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    }
  }

  const modalRoom = activeSchedule.rooms.find((room) => room.id === modalRoomId);
  const editingSession = editingSessionId ? activeSchedule.sessions.find((session) => session.id === editingSessionId) : null;
  const editingRecurringSession = Boolean(editingSession?.recurrenceGroupId);

  return (
    <main className="min-h-screen bg-zinc-100 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-[1500px] px-5 py-5">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase text-zinc-500">Staff Dashboard</div>
              <div className="mt-1 flex items-center gap-2">
                <div className="text-xl font-semibold text-zinc-950">
                  {activeTab === 'schedule' ? 'Weekly Schedule' : 'Manager Analytics'}
                </div>
                {activeTab === 'schedule' ? (
                  <button
                    aria-label="Open LED board"
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50 hover:text-zinc-950"
                    onClick={() => {
                      window.location.href = `/entrance-led?campus_name=${encodeURIComponent(selectedCampus)}`;
                    }}
                    title="Open LED board"
                    type="button"
                  >
                    →
                  </button>
                ) : null}
              </div>
            </div>

            <div className="flex w-full rounded-md border border-zinc-300 bg-zinc-50 p-1 sm:w-fit">
              {[
                { id: 'schedule', label: 'Weekly Schedule' },
                { id: 'analytics', label: 'Manager Analytics' },
              ].map((tab) => (
                <button
                  className={[
                    'flex-1 rounded px-4 py-2 text-sm font-semibold sm:flex-none',
                    activeTab === tab.id ? 'bg-zinc-900 text-white shadow-sm' : 'text-zinc-700 hover:bg-white',
                  ].join(' ')}
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {activeTab === 'schedule' ? (
            <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="text-sm font-semibold text-zinc-700">
                  Campus
                  <select
                    className="mt-2 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-950 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                    onChange={(event) => switchCampus(event.target.value)}
                    value={selectedCampus}
                  >
                    {campuses.map((campus) => (
                      <option key={campus}>{campus}</option>
                    ))}
                  </select>
                </label>

                <label className="text-sm font-semibold text-zinc-700">
                  Schedule Date
                  <input
                    className="mt-2 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-950 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                    onChange={(event) => switchScheduleDate(event.target.value)}
                    type="date"
                    value={selectedScheduleDate}
                  />
                </label>

                <label className="text-sm font-semibold text-zinc-700">
                  Day
                  <div className="mt-2 flex h-11 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm font-semibold text-zinc-700">
                    {selectedDay}
                  </div>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {status.message ? (
                  <p
                    className={[
                      'rounded-md px-3 py-2 text-sm font-medium',
                      status.type === 'success' ? 'bg-emerald-50 text-emerald-800' : '',
                      status.type === 'error' ? 'bg-red-50 text-red-800' : '',
                      status.type === 'loading' ? 'bg-blue-50 text-blue-800' : '',
                    ].join(' ')}
                  >
                    {status.message}
                  </p>
                ) : null}
                <button
                  className="rounded-md border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-400"
                  disabled={!activeUndoAction || status.type === 'loading'}
                  onClick={undoLastCanvasAction}
                  title={activeUndoAction ? `Undo ${activeUndoAction.label}` : 'Nothing to undo'}
                  type="button"
                >
                  Undo
                </button>
                <button
                  className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
                  disabled={status.type === 'loading'}
                  onClick={publishSchedule}
                  type="button"
                >
                  Save Schedule
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </header>

      {activeTab === 'analytics' ? (
        <ManagerAnalytics />
      ) : (
        <section className="mx-auto max-w-[1500px] px-5 py-5">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">Fixed Room Timeline</h1>
              <p className="mt-1 text-sm text-zinc-600">
                {selectedCampus} - {selectedScheduleDate} ({selectedDay}) - {activeSessions.length} active session
                {activeSessions.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>

        <div className="overflow-x-scroll border border-zinc-300 bg-white pb-3 shadow-sm">
          <div className="min-w-[1480px]">
            <div className="grid grid-cols-[220px_1fr] border-b border-zinc-300 bg-zinc-900 text-white">
              <div className="border-r border-zinc-700 px-4 py-3 text-sm font-semibold">Rooms</div>
              <div className="relative h-14 overflow-hidden">
                <div className="absolute inset-x-0 bottom-0 top-6 grid grid-cols-11">
                  {timelineHours.map((hour) => (
                    <div className="border-r border-zinc-700" key={hour} />
                  ))}
                </div>
                {timelineBoundaryHours.map((hour, index) => {
                  const position = `${(index / (timelineBoundaryHours.length - 1)) * 100}%`;
                  const alignmentClass =
                    index === 0
                      ? 'translate-x-0'
                      : index === timelineBoundaryHours.length - 1
                        ? '-translate-x-full'
                        : '-translate-x-1/2';

                  return (
                    <div
                      className={`absolute top-2 text-xs font-semibold whitespace-nowrap text-white/90 ${alignmentClass}`}
                      key={hour}
                      style={{ left: position }}
                    >
                      {hour}
                    </div>
                  );
                })}
              </div>
            </div>

            {activeSchedule.rooms.map((room, roomIndex) => {
              const roomSessions = activeSessions.filter((session) => session.roomId === room.id);

              return (
                <div className="grid grid-cols-[220px_1fr] border-b border-zinc-200" key={room.id}>
                  <aside className="flex min-h-28 flex-col justify-center border-r border-zinc-200 bg-zinc-50 px-4 py-3">
                    <div className="min-w-0 px-1 py-0.5 text-sm font-semibold text-zinc-950">{room.name}</div>
                    <div className="mt-1 text-xs font-medium text-zinc-500">{roomSessions.length} session blocks</div>
                    <button
                      className="mt-3 w-fit rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-zinc-50"
                      onClick={() => openSessionModal(room.id)}
                      type="button"
                    >
                      + Add Session Block
                    </button>
                  </aside>

                  <div className="relative min-h-28 bg-white">
                    <div className="absolute inset-0 grid grid-cols-11">
                      {timelineHours.map((hour) => (
                        <div className="border-r border-zinc-200" key={`${room.id}-${hour}`} />
                      ))}
                    </div>

                    {roomSessions.map((session, sessionIndex) => (
                      <div
                        className={`absolute top-4 h-20 rounded-md px-3 py-2 text-left text-white shadow-sm ${
                          blockColors[(roomIndex + sessionIndex) % blockColors.length]
                        }`}
                        key={session.id}
                        style={getSessionStyle(session)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1">
                              <div className="truncate text-sm font-semibold">{session.topicBatch}</div>
                              {session.topicBatch.length > 18 ? (
                                <button
                                  className="shrink-0 rounded px-1 text-sm font-bold leading-none text-white/90 hover:bg-white/20"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setExpandedSessionId((currentId) =>
                                      currentId === session.id ? null : session.id,
                                    );
                                  }}
                                  type="button"
                                >
                                  ...
                                </button>
                              ) : null}
                            </div>
                            <div className="mt-1 truncate text-xs opacity-90">
                              {timeInputToLabel(session.startTime)} - {timeInputToLabel(session.endTime)}
                            </div>
                            <div className="mt-1 truncate text-xs opacity-90">
                              {session.numStudents || '-'} students
                            </div>
                            {session.recurrenceGroupId ? (
                              <div className="mt-1 truncate text-[11px] font-semibold uppercase tracking-wide text-white/90">
                                Repeats: {session.recurrenceDays.join(', ')}
                              </div>
                            ) : null}
                          </div>
                          <button
                            aria-label={`Edit ${session.topicBatch}`}
                            className="shrink-0 rounded bg-white/20 px-2 py-0.5 text-xs font-bold hover:bg-white/30"
                            onClick={() => openEditSession(session)}
                            type="button"
                          >
                            Edit
                          </button>
                          <button
                            aria-label={`Delete ${session.topicBatch}`}
                            className="shrink-0 rounded bg-white/20 px-2 py-0.5 text-xs font-bold hover:bg-white/30"
                            onClick={() => removeSession(session.id)}
                            type="button"
                          >
                            X
                          </button>
                        </div>
                        {expandedSessionId === session.id ? (
                          <div className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-72 rounded-md border border-zinc-200 bg-white p-3 text-zinc-950 shadow-lg">
                            <div className="text-xs font-semibold uppercase text-zinc-500">Topic/Batch</div>
                            <div className="mt-1 text-sm font-semibold leading-5">{session.topicBatch}</div>
                            <div className="mt-3 text-xs text-zinc-600">
                              {timeInputToLabel(session.startTime)} - {timeInputToLabel(session.endTime)}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        </section>
      )}

      {modalRoom ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4">
          <form className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-xl" onSubmit={saveSession}>
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-zinc-950">
                {editingSessionId ? 'Edit Session Block' : 'Add Session Block'}
              </h2>
              <p className="mt-1 text-sm text-zinc-600">{modalRoom.name}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-zinc-700">
                Start Time
                <input
                  className="mt-2 h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                  max="18:00"
                  min="08:00"
                  onChange={(event) => setSessionDraft((draft) => ({ ...draft, startTime: event.target.value }))}
                  required
                  type="time"
                  value={sessionDraft.startTime}
                />
              </label>

              <label className="text-sm font-semibold text-zinc-700">
                End Time
                <input
                  className="mt-2 h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                  max="18:00"
                  min="08:00"
                  onChange={(event) => setSessionDraft((draft) => ({ ...draft, endTime: event.target.value }))}
                  required
                  type="time"
                  value={sessionDraft.endTime}
                />
              </label>
            </div>

            <label className="mt-4 block text-sm font-semibold text-zinc-700">
              Topic/Batch Name
              <input
                className="mt-2 h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                onChange={(event) => setSessionDraft((draft) => ({ ...draft, topicBatch: event.target.value }))}
                placeholder="GED Batch 7"
                required
                value={sessionDraft.topicBatch}
              />
            </label>

            <label className="mt-4 block text-sm font-semibold text-zinc-700">
              Number of Students
              <input
                className="mt-2 h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                onChange={(event) => setSessionDraft((draft) => ({ ...draft, numStudents: event.target.value }))}
                placeholder="42"
                value={sessionDraft.numStudents}
              />
            </label>

            <label className="mt-4 block text-sm font-semibold text-zinc-700">
              Student Service Name (optional)
              <input
                className="mt-2 h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                onChange={(event) =>
                  setSessionDraft((draft) => ({ ...draft, studentServiceName: event.target.value }))
                }
                placeholder="Enter name"
                value={sessionDraft.studentServiceName}
              />
            </label>

            <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-800">Repeat Schedule</div>
                  <div className="mt-1 text-xs text-zinc-600">
                    Repeat this session for selected weekdays across a date range.
                  </div>
                </div>
                <button
                  className={[
                    'rounded-md px-3 py-2 text-xs font-semibold',
                    sessionDraft.repeatEnabled ? 'bg-zinc-900 text-white' : 'border border-zinc-300 bg-white text-zinc-800',
                  ].join(' ')}
                  onClick={() =>
                    setSessionDraft((draft) => ({
                      ...draft,
                      repeatEnabled: !draft.repeatEnabled,
                      recurrenceDays: draft.recurrenceDays?.length ? draft.recurrenceDays : [selectedDay],
                      recurrenceStartDate: draft.recurrenceStartDate || selectedScheduleDate,
                      recurrenceEndDate: draft.recurrenceEndDate || selectedScheduleDate,
                    }))
                  }
                  type="button"
                >
                  {sessionDraft.repeatEnabled ? 'Repeating On' : 'Set Repeat'}
                </button>
              </div>

              {sessionDraft.repeatEnabled ? (
                <div className="mt-4 grid gap-4">
                  <div>
                    <div className="text-sm font-semibold text-zinc-700">Repeat On</div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {days.map((dayName) => {
                        const isSelected = sessionDraft.recurrenceDays.includes(dayName);

                        return (
                          <button
                            className={[
                              'rounded-md border px-3 py-2 text-left text-sm font-medium',
                              isSelected
                                ? 'border-zinc-900 bg-zinc-900 text-white'
                                : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50',
                            ].join(' ')}
                            key={dayName}
                            onClick={() => toggleRecurrenceDay(dayName)}
                            type="button"
                          >
                            {dayName}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-semibold text-zinc-700">
                      Repeat Start Date
                      <input
                        className="mt-2 h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                        onChange={(event) =>
                          setSessionDraft((draft) => ({ ...draft, recurrenceStartDate: event.target.value }))
                        }
                        type="date"
                        value={sessionDraft.recurrenceStartDate}
                      />
                    </label>

                    <label className="text-sm font-semibold text-zinc-700">
                      Repeat End Date
                      <input
                        className="mt-2 h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                        onChange={(event) =>
                          setSessionDraft((draft) => ({ ...draft, recurrenceEndDate: event.target.value }))
                        }
                        type="date"
                        value={sessionDraft.recurrenceEndDate}
                      />
                    </label>
                  </div>
                  <p className="text-xs text-zinc-600">
                    Save this session, then click <span className="font-semibold">Save Schedule</span> to apply the repeated dates.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-zinc-50"
                onClick={closeSessionModal}
                type="button"
              >
                Cancel
              </button>
              {editingRecurringSession ? (
                <>
                  <button
                    className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
                    onClick={() => applySessionSave('single')}
                    type="button"
                  >
                    Update This Schedule
                  </button>
                  <button
                    className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                    onClick={() => applySessionSave('series')}
                    type="button"
                  >
                    Update All Repeat Range
                  </button>
                </>
              ) : (
                <button
                  className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                  type="submit"
                >
                  {editingSessionId ? 'Update Session' : 'Save Session'}
                </button>
              )}
            </div>
          </form>
        </div>
      ) : null}

    </main>
  );
}

createRoot(document.getElementById('root')).render(
  window.location.pathname === '/entrance-led' ? <LedScheduleBoard /> : <App />,
);
