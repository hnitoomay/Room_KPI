import { campuses, getFixedRoomNames } from '../../shared/campusRooms.js';

export const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const timelineHours = [
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
export const timelineBoundaryHours = [...timelineHours, '07:00 PM'];
export const blockColors = ['bg-sky-600', 'bg-emerald-600', 'bg-amber-600', 'bg-violet-600', 'bg-rose-600'];

const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function getCampusFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const campusName = params.get('campus_name');
  return campuses.includes(campusName) ? campusName : campuses[0];
}

export function scheduleKey(scheduleDate, campus) {
  return `${scheduleDate}::${campus}`;
}

export function roomIdFromName(roomName) {
  return `room-${roomName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || Date.now()}`;
}

export function getRoomRecords(campusName) {
  return getFixedRoomNames(campusName).map((roomName) => ({
    id: roomIdFromName(roomName),
    name: roomName,
  }));
}

export function createSchedule(campusName = campuses[0]) {
  return {
    rooms: getRoomRecords(campusName),
    sessions: [],
  };
}

export function insertAtIndex(items, index, item) {
  const nextItems = [...items];
  nextItems.splice(Math.min(Math.max(index, 0), nextItems.length), 0, item);
  return nextItems;
}

export function isTypingTarget(target) {
  const tagName = target?.tagName?.toLowerCase();
  return tagName === 'input' || tagName === 'select' || tagName === 'textarea' || target?.isContentEditable;
}

export function getLastActionIndexForKey(actions, key) {
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    if (actions[index].key === key) {
      return index;
    }
  }

  return -1;
}

export function getCampusFromScheduleKey(key) {
  return String(key).split('::').slice(1).join('::');
}

export function createRecurringGroupId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `series-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeRecurrenceDays(value) {
  const sourceValues = Array.isArray(value)
    ? value
    : String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

  return days.filter((dayName) => sourceValues.includes(dayName));
}

export function normalizeRecurrenceExceptionDates(value) {
  const sourceValues = Array.isArray(value)
    ? value
    : String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

  return [...new Set(sourceValues)].sort();
}

export function normalizeDateInputValue(value) {
  const match = String(value || '')
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (!match) {
    return '';
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function createSessionDraft(selectedDay, selectedScheduleDate, overrides = {}) {
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

export function buildRecurringScheduleDates(startDate, endDate, recurrenceDays) {
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

export function timeToMinutes(time) {
  const [rawHour, rawMinute] = time.split(':');
  return Number(rawHour) * 60 + Number(rawMinute);
}

export function minutesToTimeInput(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function timeInputToLabel(time) {
  const [hourText, minuteText] = time.split(':');
  const hour = Number(hourText);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${String(displayHour).padStart(2, '0')}:${minuteText} ${suffix}`;
}

export function labelToTimeInput(label) {
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

export function clampSession(startTime, endTime) {
  const dayStart = timeToMinutes('08:00');
  const dayEnd = timeToMinutes('18:00');
  const start = Math.max(dayStart, Math.min(timeToMinutes(startTime), dayEnd - 15));
  const end = Math.max(start + 15, Math.min(timeToMinutes(endTime), dayEnd));

  return {
    startTime: minutesToTimeInput(start),
    endTime: minutesToTimeInput(end),
  };
}

export function parseTimeSlot(timeSlot) {
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

export function scheduleFromRows(rows, existingRooms = []) {
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

export async function readJsonResponse(response) {
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

export function getCurrentMonthInput() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function getStartOfCurrentMonthInput() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export function getDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function getTodayDateInput() {
  return getDateInput(new Date());
}

export function getDayNameForDate(scheduleDate) {
  return weekdayNames[new Date(`${scheduleDate}T00:00:00Z`).getUTCDay()];
}

export function parseBoardTimeSlot(timeSlot) {
  const [startLabel, endLabel] = String(timeSlot).split(' - ');
  const startTime = labelToTimeInput(startLabel);
  const endTime = labelToTimeInput(endLabel);

  return {
    startMinutes: startTime ? timeToMinutes(startTime) : Number.MAX_SAFE_INTEGER,
    endMinutes: endTime ? timeToMinutes(endTime) : Number.MAX_SAFE_INTEGER,
  };
}

export function formatBoardDate(scheduleDate) {
  return new Date(`${scheduleDate}T00:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
