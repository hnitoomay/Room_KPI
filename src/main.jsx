import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';
import './styles.css';

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const campuses = [
  'Pyay Campus Room',
  'PanChan Tower Room',
  'U Wisara Campus Room KPI',
  'Student Experience Room',
  'Time City Room',
  'Sule Room',
];
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
const defaultRooms = [
  { id: 'room-placeholder', name: '' },
];
const blockColors = ['bg-sky-600', 'bg-emerald-600', 'bg-amber-600', 'bg-violet-600', 'bg-rose-600'];

function getCampusFromUrl() {
  return 'Pyay Campus Room';
}

const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function scheduleKey(scheduleDate, campus) {
  return `${scheduleDate}::${campus}`;
}

function createSchedule() {
  return {
    rooms: [...defaultRooms],
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

function scheduleFromRows(rows, existingRooms = defaultRooms) {
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

  rows.forEach((row) => {
    if (!roomMap.has(row.room_name)) {
      roomMap.set(row.room_name, {
        id: roomIdFromName(row.room_name),
        name: row.room_name,
      });
    }
  });

  const rooms = Array.from(roomMap.values());
  const sessions = rows
    .filter((row) => row.room_name && row.time_slot && row.topic_batch)
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
      };
    });

  return { rooms, sessions };
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
  const [rooms, setRooms] = useState(defaultRooms.map((room) => room.name));
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
            : [],
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
    const sourceRooms = rooms.length > 0 ? rooms : defaultRooms.map((room) => room.name);
    const roomMap = sourceRooms.reduce((roomList, roomName) => {
      roomList.set(roomName, []);
      return roomList;
    }, new Map());

    rows.forEach((row) => {
      const roomName = row.room_name || 'Unassigned Room';

      if (!roomMap.has(roomName)) {
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
                    <aside className="flex w-[13%] min-w-24 shrink-0 flex-col justify-center rounded-[7px] border border-white/50 bg-white/55 px-2.5 py-2 text-black shadow-lg backdrop-blur-lg">
                      <div className="truncate font-black tracking-wide" style={{ fontSize: roomFontSize }}>
                        {room.roomName}
                      </div>
                    </aside>

                    <div className="flex min-w-0 flex-1 gap-1.5 overflow-hidden rounded-[7px] border border-white/35 bg-white/20 p-1.5 backdrop-blur-md">
                      {room.sessions.length === 0 ? (
                        <div className="flex min-w-0 flex-1 items-center justify-center rounded-[7px] border border-dashed border-white/50 bg-white/30 text-sm font-bold tracking-wide text-black/45 backdrop-blur-lg">
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
                                'led-session-card relative flex min-w-0 flex-1 flex-col justify-center overflow-hidden rounded-[7px] border border-white/50 bg-white/60 px-2 py-1.5 text-black shadow-lg backdrop-blur-lg',
                                isLive ? 'led-session-live' : '',
                              ].join(' ')}
                              key={session.id || `${room.roomName}-${session.time_slot}-${session.topic_batch}`}
                            >
                              <div
                                className="relative z-10 truncate font-black uppercase tracking-wide text-black/85"
                                style={{ fontSize: timeFontSize }}
                              >
                                {session.time_slot}
                              </div>
                              <div
                                className="relative z-10 mt-1 overflow-hidden break-words font-black leading-tight tracking-wide text-black"
                                style={{ fontSize: topicFontSize }}
                              >
                                {session.topic_batch}
                              </div>
                              {session.student_service_name ? (
                                <div
                                  className="relative z-10 mt-1 truncate text-[0.65em] font-bold tracking-wide text-black/65"
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
  { label: 'Pyay Campus', value: 'Pyay Campus Room' },
  { label: 'U Wisara Campus', value: 'U Wisara Campus Room KPI' },
  { label: 'Times City', value: 'Time City Room' },
  { label: 'Sule Campus', value: 'Sule Room' },
  { label: 'Pan Chan Tower', value: 'PanChan Tower Room' },
];

function getAnalyticsCampusLabel(campusName) {
  return analyticsCampusOptions.find((campus) => campus.value === campusName)?.label || campusName || 'All';
}

function getReportMonthLabel(monthInput) {
  return new Date(`${monthInput}-01T00:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

function getExcelSafeSheetName(name) {
  return String(name || 'Sheet')
    .replace(/[:\\/?*[\]]/g, ' ')
    .slice(0, 31);
}

function getRoomFloor(roomName) {
  const floorMatch = String(roomName).match(/\b(\d)\d{2}\b/);
  return floorMatch ? `Floor ${floorMatch[1]}` : '';
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
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthInput);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState({ type: 'loading', message: 'Loading manager analytics...' });
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadAnalytics() {
      setStatus({ type: 'loading', message: 'Loading manager analytics...' });

      try {
        const params = new URLSearchParams({ month: selectedMonth });

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

    loadAnalytics();

    return () => controller.abort();
  }, [selectedCampus, selectedMonth]);

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

  async function exportMonthlyReport() {
    setIsExporting(true);

    try {
      const params = new URLSearchParams({ month: selectedMonth });
      const response = await fetch(`/api/room-usage-history/summary?${params.toString()}`);
      const payload = await readJsonResponse(response);

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load export data.');
      }

      const exportRows = Array.isArray(payload.rows) ? payload.rows : [];
      const exportCampusGroups = analyticsCampusOptions
        .filter((campus) => campus.value)
        .map((campus) => ({
          ...campus,
          rows: exportRows
            .filter((row) => row.campus_name === campus.value)
            .sort((firstRow, secondRow) => String(firstRow.room_name).localeCompare(String(secondRow.room_name), undefined, { numeric: true })),
        }));
      const workbook = XLSX.utils.book_new();
      const totalRooms = exportRows.length;
      const totalTimesUsed = exportRows.reduce((total, row) => total + Number(row.total_times_used || 0), 0);
      const totalHoursUsed = exportRows.reduce((total, row) => total + Number(row.total_hours_used || 0), 0);
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
          ['Room Name', 'Floor', 'Room Capacity', 'Total Times Used', 'Total Hours Occupied'],
          ...group.rows.map((row) => [
            row.room_name,
            getRoomFloor(row.room_name),
            getRoomCapacity(row),
            Number(row.total_times_used || 0),
            Number(Number(row.total_hours_used || 0).toFixed(2)),
          ]),
        ];
        const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
        styleHeaderRow(worksheet, 5);
        worksheet['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(workbook, worksheet, getExcelSafeSheetName(group.label));
      });

      const fileMonth = getReportMonthLabel(selectedMonth).replace(/\s+/g, '_');
      XLSX.writeFile(workbook, `University_Room_KPI_Report_${fileMonth}.xlsx`, { cellStyles: true });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <section className="mx-auto max-w-[1500px] px-5 py-5">
      <div className="mb-5 border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_260px_220px_auto] lg:items-end">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Manager Analytics</h1>
            <p className="mt-1 text-sm text-zinc-600">Filter monthly room utilization by campus.</p>
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
            Month
            <input
              className="mt-2 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-950 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
              onChange={(event) => setSelectedMonth(event.target.value)}
              type="month"
              value={selectedMonth}
            />
          </label>

          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-emerald-500/30 bg-white/80 px-4 text-sm font-bold text-zinc-800 shadow-sm backdrop-blur-md transition hover:border-emerald-500/50 hover:bg-white hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isExporting}
            onClick={exportMonthlyReport}
            type="button"
          >
            <span aria-hidden="true">📗</span>
            {isExporting ? 'Preparing...' : 'Export Monthly Report'}
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
          No room usage history found for this campus and month.
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
                  {group.rows.length} room{group.rows.length === 1 ? '' : 's'} sorted from most used to least used.
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
    [scheduleKey(getTodayDateInput(), campuses[0])]: createSchedule(),
  }));
  const [loadedKeys, setLoadedKeys] = useState({});
  const [roomDraft, setRoomDraft] = useState('');
  const [modalRoomId, setModalRoomId] = useState(null);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [expandedSessionId, setExpandedSessionId] = useState(null);
  const [roomPendingDelete, setRoomPendingDelete] = useState(null);
  const [sessionDraft, setSessionDraft] = useState({
    startTime: '08:00',
    endTime: '09:00',
    topicBatch: '',
    numStudents: '',
    studentServiceName: '',
  });
  const [status, setStatus] = useState({ type: 'idle', message: '' });
  const [undoStack, setUndoStack] = useState([]);

  const selectedDay = getDayNameForDate(selectedScheduleDate);
  const activeKey = scheduleKey(selectedScheduleDate, selectedCampus);
  const activeSchedule = schedules[activeKey] || createSchedule();
  const activeSessions = activeSchedule.sessions;
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
          const savedRooms = Array.isArray(payload.rooms) && payload.rooms.length > 0 ? payload.rooms : currentSchedule.rooms;

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
        };
      }),
    [activeSchedule.rooms, activeSessions, selectedCampus, selectedDay, selectedScheduleDate],
  );

  function ensureSchedule(currentSchedules, key) {
    return currentSchedules[key] || createSchedule();
  }

  function pushUndoAction(action) {
    setUndoStack((currentStack) => [...currentStack, action].slice(-30));
  }

  function removeUndoActionsForKey(key) {
    setUndoStack((currentStack) => currentStack.filter((action) => action.key !== key));
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

      if (actionToRestore.type === 'room-delete') {
        const restoredSessions = actionToRestore.sessions.filter(
          ({ session }) => !currentSchedule.sessions.some((currentSession) => currentSession.id === session.id),
        );

        return {
          ...currentSchedules,
          [actionToRestore.key]: {
            rooms: currentSchedule.rooms.some((room) => room.id === actionToRestore.room.id)
              ? currentSchedule.rooms
              : insertAtIndex(currentSchedule.rooms, actionToRestore.roomIndex, actionToRestore.room),
            sessions: restoredSessions.reduce(
              (sessions, { session, sessionIndex }) => insertAtIndex(sessions, sessionIndex, session),
              currentSchedule.sessions,
            ),
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

  function addRoom() {
    const name = roomDraft.trim();

    if (!name) {
      return;
    }

    setSchedules((currentSchedules) => {
      const currentSchedule = ensureSchedule(currentSchedules, activeKey);

      return {
        ...currentSchedules,
        [activeKey]: {
          ...currentSchedule,
          rooms: [
            ...currentSchedule.rooms,
            {
              id: roomIdFromName(`${name}-${Date.now()}`),
              name,
            },
          ],
        },
      };
    });
    setRoomDraft('');
  }

  function renameRoom(roomId, name) {
    setSchedules((currentSchedules) => {
      const currentSchedule = ensureSchedule(currentSchedules, activeKey);

      return {
        ...currentSchedules,
        [activeKey]: {
          ...currentSchedule,
          rooms: currentSchedule.rooms.map((room) => (room.id === roomId ? { ...room, name: name.trimStart() } : room)),
        },
      };
    });
  }

  function deleteRoom(roomId) {
    const deletedRoom = activeSchedule.rooms.find((room) => room.id === roomId);
    const deletedSessions = activeSchedule.sessions
      .map((session, sessionIndex) => ({ session, sessionIndex }))
      .filter(({ session }) => session.roomId === roomId);

    if (!deletedRoom) {
      return;
    }

    pushUndoAction({
      key: activeKey,
      type: 'room-delete',
      label: `${deletedRoom.name} room deletion`,
      room: deletedRoom,
      roomIndex: activeSchedule.rooms.findIndex((room) => room.id === roomId),
      sessions: deletedSessions,
    });

    setSchedules((currentSchedules) => {
      const currentSchedule = ensureSchedule(currentSchedules, activeKey);

      return {
        ...currentSchedules,
        [activeKey]: {
          rooms: currentSchedule.rooms.filter((room) => room.id !== roomId),
          sessions: currentSchedule.sessions.filter((session) => session.roomId !== roomId),
        },
      };
    });
    setRoomPendingDelete(null);
  }

  function openSessionModal(roomId) {
    setModalRoomId(roomId);
    setEditingSessionId(null);
    setSessionDraft({
      startTime: '08:00',
      endTime: '09:00',
      topicBatch: '',
      numStudents: '',
      studentServiceName: '',
    });
  }

  function closeSessionModal() {
    setModalRoomId(null);
    setEditingSessionId(null);
    setSessionDraft({
      startTime: '08:00',
      endTime: '09:00',
      topicBatch: '',
      numStudents: '',
      studentServiceName: '',
    });
  }

  function openEditSession(session) {
    setModalRoomId(session.roomId);
    setEditingSessionId(session.id);
    setExpandedSessionId(null);
    setSessionDraft({
      startTime: session.startTime,
      endTime: session.endTime,
      topicBatch: session.topicBatch,
      numStudents: session.numStudents,
      studentServiceName: session.studentServiceName,
    });
  }

  function saveSession(event) {
    event.preventDefault();

    if (!modalRoomId || !sessionDraft.topicBatch.trim()) {
      return;
    }

    const normalizedTime = clampSession(sessionDraft.startTime, sessionDraft.endTime);

    setSchedules((currentSchedules) => {
      const currentSchedule = ensureSchedule(currentSchedules, activeKey);

      return {
        ...currentSchedules,
        [activeKey]: {
          ...currentSchedule,
          sessions: editingSessionId
            ? currentSchedule.sessions.map((session) =>
                session.id === editingSessionId
                  ? {
                      ...session,
                      roomId: modalRoomId,
                      startTime: normalizedTime.startTime,
                      endTime: normalizedTime.endTime,
                      topicBatch: sessionDraft.topicBatch.trim(),
                      numStudents: sessionDraft.numStudents.trim(),
                      studentServiceName: sessionDraft.studentServiceName.trim(),
                    }
                  : session,
              )
            : [
                ...currentSchedule.sessions,
                {
                  id: `session-${Date.now()}`,
                  roomId: modalRoomId,
                  startTime: normalizedTime.startTime,
                  endTime: normalizedTime.endTime,
                  topicBatch: sessionDraft.topicBatch.trim(),
                  numStudents: sessionDraft.numStudents.trim(),
                  studentServiceName: sessionDraft.studentServiceName.trim(),
                },
              ],
        },
      };
    });
    closeSessionModal();
  }

  function removeSession(sessionId) {
    const deletedSessionIndex = activeSchedule.sessions.findIndex((session) => session.id === sessionId);
    const deletedSession = activeSchedule.sessions[deletedSessionIndex];

    if (!deletedSession) {
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
    const end = Math.min(timeToMinutes(session.endTime) + 60, visualDayEnd);
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
      }),
    });

    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(payload.error || 'Publish failed.');
    }

    setLoadedKeys((currentLoadedKeys) => ({
      ...currentLoadedKeys,
      [activeKey]: true,
    }));
    removeUndoActionsForKey(activeKey);

    return payload;
  }

  async function publishSchedule() {
    setStatus({ type: 'loading', message: `Saving ${selectedScheduleDate} at ${selectedCampus}...` });

    try {
      const payload = await saveScheduleSnapshot();

      setStatus({
        type: 'success',
        message: `Saved ${payload.inserted} session${payload.inserted === 1 ? '' : 's'}.`,
      });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    }
  }

  async function finalizeSchedule() {
    setStatus({ type: 'loading', message: `Finalizing ${selectedScheduleDate} at ${selectedCampus}...` });

    try {
      await saveScheduleSnapshot();

      const response = await fetch('/api/weekly-kpi/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schedule_date: selectedScheduleDate,
          campus_name: selectedCampus,
        }),
      });
      const payload = await readJsonResponse(response);

      if (!response.ok) {
        throw new Error(payload.error || 'Finalize failed.');
      }

      setStatus({
        type: 'success',
        message: `Finalized ${payload.finalizedRows} session${payload.finalizedRows === 1 ? '' : 's'} for analytics.`,
      });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    }
  }

  const modalRoom = activeSchedule.rooms.find((room) => room.id === modalRoomId);

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
                <button
                  className="rounded-md bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
                  disabled={status.type === 'loading'}
                  onClick={finalizeSchedule}
                  type="button"
                >
                  Finalize Day
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
              <h1 className="text-2xl font-semibold tracking-normal">Dynamic Timeline Lanes</h1>
              <p className="mt-1 text-sm text-zinc-600">
                {selectedCampus} - {selectedScheduleDate} ({selectedDay}) - {activeSessions.length} active session
                {activeSessions.length === 1 ? '' : 's'}
              </p>
            </div>

            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <input
                className="h-10 min-w-64 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                onChange={(event) => setRoomDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    addRoom();
                  }
                }}
                placeholder="New room name"
                value={roomDraft}
              />
              <button
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-zinc-50"
                onClick={addRoom}
                type="button"
              >
                + Add Room
              </button>
            </div>
          </div>

        <div className="overflow-x-scroll border border-zinc-300 bg-white pb-3 shadow-sm">
          <div className="min-w-[1480px]">
            <div className="grid grid-cols-[220px_1fr] border-b border-zinc-300 bg-zinc-900 text-white">
              <div className="border-r border-zinc-700 px-4 py-3 text-sm font-semibold">Rooms</div>
              <div className="grid grid-cols-11">
                {timelineHours.map((hour) => (
                  <div className="border-r border-zinc-700 px-3 py-3 text-center text-xs font-semibold" key={hour}>
                    {hour}
                  </div>
                ))}
              </div>
            </div>

            {activeSchedule.rooms.map((room, roomIndex) => {
              const roomSessions = activeSessions.filter((session) => session.roomId === room.id);

              return (
                <div className="grid grid-cols-[220px_1fr] border-b border-zinc-200" key={room.id}>
                  <aside className="flex min-h-28 flex-col justify-center border-r border-zinc-200 bg-zinc-50 px-4 py-3">
                    <div className="flex items-start gap-2">
                      <input
                        aria-label={`Edit ${room.name}`}
                        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-zinc-950 outline-none focus:border-zinc-300 focus:bg-white focus:ring-2 focus:ring-zinc-900/10"
                        onChange={(event) => renameRoom(room.id, event.target.value)}
                        placeholder="Enter room name"
                        value={room.name}
                      />
                      <button
                        aria-label={`Delete ${room.name}`}
                        className="rounded border border-red-200 bg-white px-2 py-0.5 text-xs font-bold text-red-700 hover:bg-red-50"
                        onClick={() => setRoomPendingDelete(room)}
                        type="button"
                      >
                        X
                      </button>
                    </div>
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
          <form className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl" onSubmit={saveSession}>
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

            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-zinc-50"
                onClick={closeSessionModal}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                type="submit"
              >
                {editingSessionId ? 'Update Session' : 'Save Session'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {roomPendingDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-zinc-950">Delete room?</h2>
            <p className="mt-2 text-sm text-zinc-600">
              Are you sure you want to delete {roomPendingDelete.name}? This will also remove its session blocks.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-zinc-50"
                onClick={() => setRoomPendingDelete(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
                onClick={() => deleteRoom(roomPendingDelete.id)}
                type="button"
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  window.location.pathname === '/entrance-led' ? <LedScheduleBoard /> : <App />,
);
