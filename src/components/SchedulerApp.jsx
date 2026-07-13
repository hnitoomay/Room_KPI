import React, { useEffect, useMemo, useState } from 'react';
import { campuses, getFixedRoomNames } from '../../shared/campusRooms.js';
import ManagerAnalytics from './ManagerAnalytics.jsx';
import {
  blockColors,
  buildRecurringScheduleDates,
  clampSession,
  createRecurringGroupId,
  createSchedule,
  createSessionDraft,
  days,
  getCampusFromScheduleKey,
  getDayNameForDate,
  getLastActionIndexForKey,
  getTodayDateInput,
  insertAtIndex,
  isTypingTarget,
  normalizeDateInputValue,
  normalizeRecurrenceDays,
  normalizeRecurrenceExceptionDates,
  readJsonResponse,
  scheduleFromRows,
  scheduleKey,
  timeInputToLabel,
  timeToMinutes,
  timelineBoundaryHours,
  timelineHours,
} from '../utils/schedule.js';

export default function SchedulerApp() {
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
                    &rarr;
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
