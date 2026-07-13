import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { campusRoomDefinitions, getCampusLabel, getFixedRoomNames } from '../../shared/campusRooms.js';
import { getStartOfCurrentMonthInput, getTodayDateInput, readJsonResponse } from '../utils/schedule.js';

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

export default function ManagerAnalytics() {
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
            <span aria-hidden="true">Export</span>
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
