import React, { useEffect, useMemo, useState } from 'react';
import { campuses, getFixedRoomNames } from '../../shared/campusRooms.js';
import {
  formatBoardDate,
  getCampusFromUrl,
  getDayNameForDate,
  getTodayDateInput,
  parseBoardTimeSlot,
  readJsonResponse,
} from '../utils/schedule.js';

export default function LedScheduleBoard() {
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
  }, [rows, rooms, campusName]);

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

            <div className="flex items-stretch gap-2">
              <button
                aria-label="Back to admin panel"
                className="flex w-11 items-center justify-center rounded-[7px] border border-white/50 bg-white/60 text-xl font-black text-black shadow-lg backdrop-blur-lg transition hover:bg-white/80"
                onClick={() => {
                  window.location.href = '/';
                }}
                title="Back to admin panel"
                type="button"
              >
                &larr;
              </button>
              <div className="rounded-[7px] border border-white/50 bg-white/60 px-3 py-2 text-right shadow-lg backdrop-blur-lg">
                <div className="text-base font-black tracking-wide text-black md:text-lg lg:text-xl">
                  {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="text-xs font-bold uppercase tracking-wide text-black/55">Refresh 60s</div>
              </div>
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
