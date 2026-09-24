// Preparação (pura) dos dados dos PDFs do mês e do dia. Sem React aqui.

import type { Absence, AppData, Asb, EffectiveDay, IsoDate, Task } from '../domain';
import {
  HOURS, OPEN_END, OPEN_START, SLOT_KIND_LABEL, WEEKDAY_LABEL, WEEKDAY_SHORT, absencesBetween, analyze, baseDay, dentistsAt,
  effectiveDay, firstOfMonth, formatDate, formatDayMonth, formatMonth, formatRange, isExternalSubstitute, isTeamSubstitute,
  lastOfMonth, monthRotation, resolveTask, todayIso, weekdayOf, weeksOfMonth,
} from '../domain';

const AFTERNOON_START = 13;

export interface AsbRow {
  name: string;
  contract: string;
  morning: string;
  lunch: string;
  afternoon: string;
}

export interface RoomCell {
  dentist: string;
  asb: string;
}

export interface RoomRow {
  hour: string;
  cells: RoomCell[];
}

export interface RotationRow {
  task: string;
  when: string;
  cells: string[];
}

export interface AbsenceRow {
  asb: string;
  period: string;
  reason: string;
  cover: string;
}

export interface MonthPdfModel {
  title: string;
  monthLabel: string;
  hoursLabel: string;
  asbRows: AsbRow[];
  roomNames: string[];
  roomRows: RoomRow[];
  weekHeaders: string[];
  weeklyRows: RotationRow[];
  monthlyRows: Array<{ task: string; when: string; holder: string }>;
  rules: string[];
  absences: AbsenceRow[];
  generatedAt: string;
}

export function openingLabel(data: AppData): string {
  const days = [...data.openDays].sort();
  const weekdays = [1, 2, 3, 4, 5];
  const isMonFri = weekdays.every((d) => days.includes(d)) && days.every((d) => weekdays.includes(d));
  const daysLabel = isMonFri ? 'segunda a sexta' : days.map((d) => WEEKDAY_SHORT[d]).join(', ');
  return `Horário de funcionamento: ${formatRange(OPEN_START, OPEN_END)}, ${daysLabel}`;
}

function asbName(data: AppData, id: string): string {
  return data.asbs.find((a) => a.id === id)?.name ?? id;
}

function coverLabel(data: AppData, a: Absence): string {
  if (isTeamSubstitute(a)) return asbName(data, a.substitute.asbId);
  if (isExternalSubstitute(a)) return `${a.substitute.externalName} (externa)`;
  return 'sem substituta';
}

function periodLabel(a: Absence): string {
  return a.from === a.to ? formatDate(a.from) : `${formatDate(a.from)} a ${formatDate(a.to)}`;
}

/** Texto corrido de um período: "Sala 4 (Dra. Juliana, 07h–11h), Apoio / Recepção (11h–12h)". */
export function describePeriod(data: AppData, day: EffectiveDay, asb: Asb, hours: number[]): string {
  const mine = day.slots.filter((s) => s.who.type === 'asb' && s.who.asbId === asb.id && hours.includes(s.hour) && s.kind !== 'almoco');
  const labelAt = (hour: number): string | undefined => {
    const s = mine.find((x) => x.hour === hour);
    if (!s) return undefined;
    if (s.kind === 'sala') {
      const room = data.rooms.find((r) => r.id === s.roomId)?.name ?? 'Sala';
      const ds = dentistsAt(day.dentists, s.roomId ?? '', hour).map((d) => d.name);
      return `${room}|${ds.join(' e ') || 'sala vazia'}`;
    }
    return `${SLOT_KIND_LABEL[s.kind]}|`;
  };
  const parts: string[] = [];
  let i = 0;
  const sorted = [...hours].sort((a, b) => a - b);
  while (i < sorted.length) {
    const label = labelAt(sorted[i]);
    if (!label) { i++; continue; }
    const start = sorted[i];
    let end = start + 1;
    while (i + 1 < sorted.length && sorted[i + 1] === end && labelAt(sorted[i + 1]) === label) { i++; end++; }
    const [place, who] = label.split('|');
    parts.push(who ? `${place} (${who}, ${formatRange(start, end)})` : `${place} (${formatRange(start, end)})`);
    i++;
  }
  return parts.join(', ') || '-';
}

export function asbRows(data: AppData, day: EffectiveDay = baseDay(data)): AsbRow[] {
  return [...data.asbs]
    .filter((a) => a.active)
    .sort((a, b) => a.start - b.start || a.name.localeCompare(b.name))
    .map((asb) => {
      const absence = day.absences.find((a) => a.asbId === asb.id);
      if (absence) {
        return { name: asb.name, contract: formatRange(asb.start, asb.end), morning: `Ausente (${absence.reason})`, lunch: '-', afternoon: `Ausente (${absence.reason})` };
      }
      const lunch = day.slots.find((s) => s.who.type === 'asb' && s.who.asbId === asb.id && s.kind === 'almoco');
      const morning = HOURS.filter((h) => h < AFTERNOON_START);
      const afternoon = HOURS.filter((h) => h >= AFTERNOON_START);
      return {
        name: asb.name,
        contract: formatRange(asb.start, asb.end),
        morning: describePeriod(data, day, asb, morning),
        lunch: lunch ? formatRange(lunch.hour, lunch.hour + 1) : asb.lunch ? 'sem bloco' : 'não sai',
        afternoon: describePeriod(data, day, asb, afternoon),
      };
    });
}

function personLabel(data: AppData, who: EffectiveDay['slots'][number]['who']): string {
  return who.type === 'asb' ? asbName(data, who.asbId) : `${who.name} (externa)`;
}

export function roomRows(data: AppData, day: EffectiveDay): { roomNames: string[]; rows: RoomRow[] } {
  const rooms = [...data.rooms].sort((a, b) => a.order - b.order);
  const rows = HOURS.map((hour) => ({
    hour: formatRange(hour, hour + 1),
    cells: rooms.map((room) => {
      const ds = dentistsAt(day.dentists, room.id, hour);
      const asbs = day.slots.filter((s) => s.kind === 'sala' && s.roomId === room.id && s.hour === hour).map((s) => personLabel(data, s.who));
      const dentist = ds.length > 0 ? ds.map((d) => `${d.name} (${d.specialty})`).join(', ') : 'sala vazia';
      const asb = asbs.length > 0 ? `ASB: ${asbs.join(', ')}` : ds.length > 0 ? 'SEM ASB' : '';
      return { dentist, asb };
    }),
  }));
  return { roomNames: rooms.map((r) => r.name), rows };
}

export function monthPdfModel(data: AppData, year: number, month: number, now: Date = new Date()): MonthPdfModel {
  const weeks = weeksOfMonth(year, month);
  const day = baseDay(data);
  const rotations = data.tasks.filter((t): t is Task & { assignment: { mode: 'rotation' } } => t.assignment.mode === 'rotation');
  const weeklyRows: RotationRow[] = rotations
    .filter((t) => t.assignment.period === 'week')
    .map((t) => {
      const r = monthRotation(data, t, year, month);
      return {
        task: t.name,
        when: t.when,
        cells: weeks.map((w) => {
          const e = r?.weeks.find((x) => x.week.index === w.index);
          if (!e) return '-';
          const name = asbName(data, e.titularId);
          return e.absentDays.length > 0 ? `${name} (ausente ${e.absentDays.map(formatDayMonth).join(', ')})` : name;
        }),
      };
    });
  const monthlyRows = rotations
    .filter((t) => t.assignment.period === 'month')
    .map((t) => {
      const r = monthRotation(data, t, year, month);
      return { task: t.name, when: t.when, holder: r?.monthTitularId ? asbName(data, r.monthTitularId) : '-' };
    });
  const { roomNames, rows } = roomRows(data, day);
  const absences = absencesBetween(data, firstOfMonth(year, month), lastOfMonth(year, month))
    .sort((a, b) => a.from.localeCompare(b.from))
    .map((a) => ({ asb: asbName(data, a.asbId), period: periodLabel(a), reason: a.reason, cover: coverLabel(data, a) }));
  return {
    title: 'Escala mensal de trabalho - CEO',
    monthLabel: formatMonth(year, month),
    hoursLabel: openingLabel(data),
    asbRows: asbRows(data, day),
    roomNames,
    roomRows: rows,
    weekHeaders: weeks.map((w) => `Semana ${w.index} (${formatDayMonth(w.days[0])} a ${formatDayMonth(w.days[w.days.length - 1])})`),
    weeklyRows,
    monthlyRows,
    rules: data.rules,
    absences,
    generatedAt: `Gerado em ${formatDate(todayIso(now))} às ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
  };
}

export interface DayPdfModel {
  title: string;
  dateLabel: string;
  hoursLabel: string;
  open: boolean;
  absences: AbsenceRow[];
  columns: string[];
  rows: Array<{ hour: string; cells: RoomCell[] }>;
  asbRows: AsbRow[];
  tasks: Array<{ task: string; when: string; holder: string; reason: string }>;
  alerts: string[];
  generatedAt: string;
}

const SUPPORT: Array<{ label: string; kinds: Array<EffectiveDay['slots'][number]['kind']> }> = [
  { label: 'Apoio / Recepção', kinds: ['apoio', 'recepcao'] },
  { label: 'CME / Arsenal', kinds: ['cme'] },
  { label: 'Almoxarifado', kinds: ['almox'] },
  { label: 'Almoço', kinds: ['almoco'] },
];

export function dayPdfModel(data: AppData, date: IsoDate, now: Date = new Date()): DayPdfModel {
  const day = effectiveDay(data, date);
  const { roomNames, rows } = roomRows(data, day);
  const fullRows = rows.map((r, i) => ({
    hour: r.hour,
    cells: [
      ...r.cells,
      ...SUPPORT.map((c) => ({
        dentist: '',
        asb: day.slots.filter((s) => c.kinds.includes(s.kind) && s.hour === HOURS[i]).map((s) => personLabel(data, s.who)).join(', '),
      })),
    ],
  }));
  const tasks = data.tasks
    .map((t) => ({ t, r: resolveTask(data, t, date, day) }))
    .filter(({ r }) => r.applies)
    .map(({ t, r }) => ({
      task: t.name,
      when: t.when,
      holder: r.holders.length > 0 ? r.holders.map((p) => personLabel(data, p)).join(' e ') : r.noSubstitute ? 'sem substituta' : 'ninguém',
      reason: r.reason,
    }));
  const alerts = analyze(data, day).map((a) => `${a.level === 'critico' ? 'CRÍTICO' : 'Aviso'}: ${a.message}`);
  return {
    title: 'Escala do dia - CEO',
    dateLabel: `${WEEKDAY_LABEL[weekdayOf(date)]}, ${formatDate(date)}`,
    hoursLabel: openingLabel(data),
    open: day.open,
    absences: day.absences.map((a) => ({ asb: asbName(data, a.asbId), period: periodLabel(a), reason: a.reason, cover: coverLabel(data, a) })),
    columns: [...roomNames, ...SUPPORT.map((c) => c.label)],
    rows: fullRows,
    asbRows: asbRows(data, day),
    tasks,
    alerts,
    generatedAt: `Gerado em ${formatDate(todayIso(now))} às ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
  };
}

