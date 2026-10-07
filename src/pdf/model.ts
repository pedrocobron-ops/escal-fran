// Preparação (pura) dos dados dos PDFs do mês e do dia. Sem React aqui.

import type { Absence, AppData, Asb, EffectiveDay, IsoDate, Task } from '../domain';
import {
  HOURS, OPEN_END, OPEN_START, SLOT_KIND_LABEL, WEEKDAY_LABEL, WEEKDAY_SHORT, absencesBetween, baseDay, dentistAbsencesBetween, dentistsAt, validExtraShiftsBetween,
  effectiveDay, firstOfMonth, formatDate, formatDayMonth, formatHour, formatMonth, formatRange, isExternalSubstitute, isTeamSubstitute,
  addDays, adjustedSlotCount, dataForDate, findAsbAnywhere, findDentistAnywhere, isOpenOn, lastOfMonth, monthRotation, rotationTasksInMonth, resolveTask, todayIso, weekdayOf, weeksOfMonth,
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
  /** Feriados e dias fechados do mês, em texto. */
  closedDays?: string;
  asbRows: AsbRow[];
  roomNames: string[];
  roomRows: RoomRow[];
  weekHeaders: string[];
  weeklyRows: RotationRow[];
  monthlyRows: Array<{ task: string; when: string; holder: string }>;
  /** Tarefas que não são rodízio (conferência de prótese, CME etc.): quem faz no mês. */
  taskRows: Array<{ task: string; when: string; who: string }>;
  rules: string[];
  absences: AbsenceRow[];
  dentistAbsences: Array<{ dentist: string; period: string; reason: string }>;
  extras: Array<{ asb: string; date: string; hours: string; note: string }>;
  /** Trocas de horário do mês. */
  shiftChanges: Array<{ asb: string; period: string; hours: string; note: string }>;
  /** Total de horas extras (fora do contrato) por ASB no mês. */
  extraTotals: Array<{ asb: string; hours: number }>;
  generatedAt: string;
}

/** Marcas curtas depois do nome: remanejada, hora extra, ajuste. */
/** Só a hora extra é marcada no quadro impresso; o resto é o nome (pedido do cliente). */
function slotMarks(s: EffectiveDay['slots'][number]): string {
  return s.extra ? ' (extra)' : '';
}

/** Horas extras pagas por ASB no período, com o contrato valendo em cada data. */
/**
 * Total de horas extras para pagamento por ASB no período: só blocos fora do contrato,
 * cada bloco contado uma vez (registros sobrepostos não dobram), sem dias em que a ASB
 * está ausente ou inativa e sem dias em que o CEO não abre.
 */
export function extraTotalsByAsb(current: AppData, from: IsoDate, to: IsoDate): Array<{ asb: string; hours: number }> {
  const blocks = new Map<string, Set<string>>();
  for (const e of validExtraShiftsBetween(current, from, to)) {
    const d = dataForDate(current, e.date);
    if (!isOpenOn(d, e.date)) continue;
    const asb = d.asbs.find((a) => a.id === e.asbId) ?? findAsbAnywhere(current, e.asbId);
    if (!asb || asb.active === false) continue;
    const set = blocks.get(e.asbId) ?? new Set<string>();
    for (let h = e.start; h < e.end; h++) {
      if (h < asb.start || h >= asb.end) set.add(`${e.date}@${h}`);
    }
    blocks.set(e.asbId, set);
  }
  return [...blocks.entries()]
    .filter(([, set]) => set.size > 0)
    .map(([id, set]) => ({ asb: findAsbAnywhere(current, id)?.name ?? '?', hours: set.size }))
    .sort((a, b) => b.hours - a.hours || a.asb.localeCompare(b.asb));
}

export function openingLabel(data: AppData): string {
  const days = [...data.openDays].sort();
  const weekdays = [1, 2, 3, 4, 5];
  const isMonFri = weekdays.every((d) => days.includes(d)) && days.every((d) => weekdays.includes(d));
  const daysLabel = isMonFri ? 'segunda a sexta' : days.map((d) => WEEKDAY_SHORT[d]).join(', ');
  return `Horário de funcionamento: ${formatRange(OPEN_START, OPEN_END)}, ${daysLabel}`;
}

function asbName(data: AppData, id: string): string {
  return findAsbAnywhere(data, id)?.name ?? '?';
}

function coverLabel(data: AppData, a: Absence): string {
  if (isTeamSubstitute(a)) return asbName(data, a.substitute.asbId);
  if (isExternalSubstitute(a)) return `${a.substitute.externalName} (externa)`;
  return 'sem substituta';
}

/**
 * Período para mostrar num dia: junta registros encostados da mesma ASB e motivo (por
 * exemplo, férias divididas quando a substituta saiu da equipe), para o dia passado
 * continuar dizendo "21/09 a 09/10".
 */
function mergedPeriodLabel(data: AppData, a: Absence): string {
  let from = a.from;
  let to = a.to;
  for (let changed = true; changed; ) {
    changed = false;
    for (const x of data.absences) {
      if (x.asbId !== a.asbId || x.reason !== a.reason) continue;
      if (x.to === addDays(from, -1)) { from = x.from; changed = true; }
      if (x.from === addDays(to, 1)) { to = x.to; changed = true; }
    }
  }
  return from === to ? formatDate(from) : `${formatDate(from)} a ${formatDate(to)}`;
}

/** "Dias fechados no mês: 12/10 (Nossa Senhora Aparecida)", ou undefined se não houver. */
function closedDaysLabel(current: AppData, year: number, month: number): string | undefined {
  const first = firstOfMonth(year, month);
  const last = lastOfMonth(year, month);
  const list = (current.closedDates ?? []).filter((c) => c.date >= first && c.date <= last).sort((a, b) => a.date.localeCompare(b.date));
  if (list.length === 0) return undefined;
  return `Feriados e dias fechados no mês: ${list.map((c) => `${formatDayMonth(c.date)}${c.note ? ` (${c.note})` : ''}`).join(', ')}.`;
}

/**
 * Quem faz uma tarefa (que não é rodízio) no período: responsável fixo quando há
 * ("Laura, 01/10 a 31/10"), senão a regra ("quem estiver na Sala 1 com Dra. Priscila").
 */
export function describeTaskHolder(current: AppData, task: Task, from: IsoDate, to: IsoDate): string {
  const fixed = (task.holdersByPeriod ?? [])
    .filter((h) => h.from <= to && h.to >= from)
    .sort((a, b) => a.from.localeCompare(b.from))
    .flatMap((h) => {
      const asb = findAsbAnywhere(current, h.asbId);
      // Quem saiu da equipe ou está inativa não faz mais a tarefa: vale a regra normal.
      if (!asb || current.asbs.find((a) => a.id === h.asbId)?.active === false) return [];
      const start = h.from < from ? from : h.from;
      const end = h.to > to ? to : h.to;
      const whole = h.from <= from && h.to >= to;
      const away = absencesBetween(current, start, end)
        .filter((a) => a.asbId === h.asbId)
        .map((a) => (a.from === a.to ? formatDayMonth(a.from) : `${formatDayMonth(a.from < start ? start : a.from)} a ${formatDayMonth(a.to > end ? end : a.to)}`));
      const absent = away.length > 0 ? `; ausente ${away.join(', ')}` : '';
      return [whole ? `${asb.name} (o mês inteiro${absent})` : `${asb.name} (${formatDayMonth(start)} a ${formatDayMonth(end)}${absent})`];
    });
  const a = task.assignment;
  let rule = '';
  if (a.mode === 'dentist') {
    const d = findDentistAnywhere(current, a.dentistId);
    const room = current.rooms.find((r) => r.id === d?.roomId)?.name;
    rule = d ? `quem estiver ${room ? `na ${room} ` : ''}com ${d.name} (${formatRange(d.start, d.end)})` : 'quem estiver com o dentista';
  } else if (a.mode === 'room') {
    rule = `quem estiver na ${current.rooms.find((r) => r.id === a.roomId)?.name ?? 'sala'} às ${formatHour(a.hour)}`;
  } else if (a.mode === 'fixed') {
    rule = a.asbIds.map((id) => findAsbAnywhere(current, id)?.name ?? '?').join(' e ') || 'ninguém definido';
  }
  if (fixed.length === 0) return rule;
  return `${fixed.join('; ')}${rule ? `. Fora desse período: ${rule}` : ''}`;
}

function periodLabel(a: Absence): string {
  return a.from === a.to ? formatDate(a.from) : `${formatDate(a.from)} a ${formatDate(a.to)}`;
}

/**
 * Texto corrido de um período: "Sala 4 (Dra. Juliana, 07h–11h), Apoio / Recepção (11h–12h)".
 * Quem está em dois lugares na mesma hora aparece com os dois: "Sala 1 (...) + Sala 2 (...)".
 */
export function describePeriod(data: AppData, day: EffectiveDay, asb: Asb, hours: number[]): string {
  const mine = day.slots.filter((s) => s.who.type === 'asb' && s.who.asbId === asb.id && hours.includes(s.hour) && s.kind !== 'almoco');
  const placeOf = (s: EffectiveDay['slots'][number], hour: number): string => {
    const room = data.rooms.find((r) => r.id === s.roomId)?.name ?? 'Sala';
    if (s.kind === 'sala') {
      const ds = dentistsAt(day.dentists, s.roomId ?? '', hour).map((d) => d.name);
      const off = dentistsAt(day.dentistsOff, s.roomId ?? '', hour).map((d) => d.name);
      return `${room}|${ds.join(' e ') || (off.length > 0 ? `${off.join(' e ')} de folga, disponível` : 'sala vazia')}`;
    }
    if (s.kind === 'apoio' && s.roomId) return `Apoio da ${room}|`;
    return `${SLOT_KIND_LABEL[s.kind]}|`;
  };
  const labelsAt = (hour: number): string[] => [...new Set(mine.filter((x) => x.hour === hour).map((x) => placeOf(x, hour)))].sort();
  const parts: string[] = [];
  let i = 0;
  const sorted = [...hours].sort((a, b) => a - b);
  while (i < sorted.length) {
    const labels = labelsAt(sorted[i]);
    if (labels.length === 0) { i++; continue; }
    const key = labels.join('+');
    const start = sorted[i];
    let end = start + 1;
    while (i + 1 < sorted.length && sorted[i + 1] === end && labelsAt(sorted[i + 1]).join('+') === key) { i++; end++; }
    parts.push(
      labels
        .map((label) => {
          const [place, who] = label.split('|');
          return who ? `${place} (${who}, ${formatRange(start, end)})` : `${place} (${formatRange(start, end)})`;
        })
        .join(' + '),
    );
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
        contract: formatRange(asb.start, asb.end) + (asb.originalHours ? ' (trocado)' : '') + day.extraShifts.filter((e) => e.asbId === asb.id).map((e) => ` + extra ${formatRange(e.start, e.end)}`).join(''),
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
      const off = dentistsAt(day.dentistsOff, room.id, hour);
      const asbs = day.slots
        .filter((s) => s.kind === 'sala' && s.roomId === room.id && s.hour === hour)
        .map((s) => personLabel(data, s.who) + slotMarks(s));
      const dentist = ds.length > 0 ? ds.map((d) => `${d.name} (${d.specialty})`).join(', ') : off.length > 0 ? `${off.map((d) => d.name).join(', ')} de folga` : 'sala vazia';
      const support = day.slots
        .filter((s) => s.kind === 'apoio' && s.roomId === room.id && s.hour === hour)
        .map((s) => personLabel(data, s.who));
      // Quem está de apoio conta como presença: a sala só fica "SEM ASB" se não houver ninguém.
      const main = asbs.length > 0 ? `ASB: ${asbs.join(', ')}` : support.length > 0 ? `ASB: ${support.join(', ')} (apoio)` : ds.length > 0 ? 'SEM ASB' : '';
      const asb = asbs.length > 0 && support.length > 0 ? `${main} (apoio: ${support.join(', ')})` : main;
      return { dentist, asb };
    }),
  }));
  return { roomNames: rooms.map((r) => r.name), rows };
}

export function monthPdfModel(current: AppData, year: number, month: number, now: Date = new Date()): MonthPdfModel {
  // Mês passado: escala base, tarefas e nomes como estavam no fim do mês.
  const data = dataForDate(current, lastOfMonth(year, month));
  const weeks = weeksOfMonth(year, month);
  const day = baseDay(data);
  const rotations = rotationTasksInMonth(current, year, month).filter((t): t is Task & { assignment: { mode: 'rotation' } } => t.assignment.mode === 'rotation');
  const weeklyRows: RotationRow[] = rotations
    .filter((t) => t.assignment.period === 'week')
    .map((t) => {
      const r = monthRotation(current, t, year, month);
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
      const r = monthRotation(current, t, year, month);
      return { task: t.name, when: t.when, holder: r?.monthTitularId ? asbName(data, r.monthTitularId) : '-' };
    });
  const { roomNames, rows } = roomRows(data, day);
  const absences = absencesBetween(data, firstOfMonth(year, month), lastOfMonth(year, month))
    .sort((a, b) => a.from.localeCompare(b.from))
    .map((a) => ({ asb: asbName(data, a.asbId), period: periodLabel(a), reason: a.reason, cover: coverLabel(data, a) }));
  const first = firstOfMonth(year, month);
  const last = lastOfMonth(year, month);
  const dentistAbsences = dentistAbsencesBetween(data, first, last)
    .sort((a, b) => a.from.localeCompare(b.from))
    .map((a) => ({
      dentist: findDentistAnywhere(data, a.dentistId)?.name ?? '?',
      period: a.from === a.to ? formatDate(a.from) : `${formatDate(a.from)} a ${formatDate(a.to)}`,
      reason: a.reason,
    }));
  const extras = validExtraShiftsBetween(data, first, last)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)
    .map((e) => ({ asb: asbName(data, e.asbId), date: `${WEEKDAY_SHORT[weekdayOf(e.date)]}, ${formatDate(e.date)}`, hours: formatRange(e.start, e.end), note: e.note ?? '' }));
  const extraTotals = extraTotalsByAsb(current, first, last);
  const shiftChanges = (current.shiftChanges ?? [])
    .filter((c) => c.from <= last && c.to >= first)
    .sort((a, b) => a.from.localeCompare(b.from))
    .map((c) => ({ asb: asbName(current, c.asbId), period: c.from === c.to ? formatDate(c.from) : `${formatDate(c.from)} a ${formatDate(c.to)}`, hours: formatRange(c.start, c.end), note: c.note ?? '' }));
  return {
    title: 'Escala mensal de trabalho - CEO',
    monthLabel: formatMonth(year, month),
    hoursLabel: openingLabel(data),
    closedDays: closedDaysLabel(current, year, month),
    asbRows: asbRows(data, day),
    roomNames,
    roomRows: rows,
    weekHeaders: weeks.map((w) => `Semana ${w.index} (${formatDayMonth(w.days[0])} a ${formatDayMonth(w.days[w.days.length - 1])})`),
    weeklyRows,
    monthlyRows,
    taskRows: data.tasks.filter((t) => t.assignment.mode !== 'rotation').map((t) => ({ task: t.name, when: t.when, who: describeTaskHolder(current, t, first, last) })),
    rules: data.rules,
    absences,
    dentistAbsences,
    extras,
    extraTotals,
    shiftChanges,
    generatedAt: `Gerado em ${formatDate(todayIso(now))} às ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
  };
}

export interface DayPdfModel {
  title: string;
  dateLabel: string;
  hoursLabel: string;
  open: boolean;
  /** Motivo quando a data está marcada como fechada (feriado). */
  closedNote?: string;
  absences: AbsenceRow[];
  /** Folgas de dentista e horas extras do dia, em texto. */
  notes: string[];
  columns: string[];
  rows: Array<{ hour: string; cells: RoomCell[] }>;
  asbRows: AsbRow[];
  tasks: Array<{ task: string; when: string; holder: string; reason: string }>;
  generatedAt: string;
}

const SUPPORT: Array<{ label: string; kinds: Array<EffectiveDay['slots'][number]['kind']> }> = [
  { label: 'Apoio / Recepção', kinds: ['apoio', 'recepcao'] },
  { label: 'CME / Arsenal', kinds: ['cme'] },
  { label: 'Almoxarifado', kinds: ['almox'] },
  { label: 'Almoço', kinds: ['almoco'] },
];

export function dayPdfModel(current: AppData, date: IsoDate, now: Date = new Date()): DayPdfModel {
  const data = dataForDate(current, date);
  const day = effectiveDay(data, date);
  const { roomNames, rows } = roomRows(data, day);
  const fullRows = rows.map((r, i) => ({
    hour: r.hour,
    cells: [
      ...r.cells,
      ...SUPPORT.map((c) => ({
        dentist: '',
        asb: day.slots
          .filter((s) => c.kinds.includes(s.kind) && s.hour === HOURS[i] && !(s.kind === 'apoio' && s.roomId))
          .map((s) => personLabel(data, s.who) + slotMarks(s))
          .join(', '),
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
  const notes = [
    ...day.dentistsOff.map((d) => {
      const abs = day.dentistAbsences.find((x) => x.dentistId === d.id);
      return `${d.name} de folga${abs ? ` (${abs.reason})` : ''}, ${data.rooms.find((r) => r.id === d.roomId)?.name ?? ''} ${formatRange(d.start, d.end)}.`;
    }),
    ...day.extraShifts.map((e) => `${asbName(data, e.asbId)} faz hora extra ${formatRange(e.start, e.end)}${e.note ? ` (${e.note})` : ''}.`),
    ...data.asbs.filter((a) => a.originalHours).map((a) => `${a.name} com horário trocado: ${formatRange(a.start, a.end)} (normal ${formatRange(a.originalHours!.start, a.originalHours!.end)})${a.originalHours!.note ? `, ${a.originalHours!.note}` : ''}.`),
    ...(adjustedSlotCount(day.overrides) > 0
      ? [`${adjustedSlotCount(day.overrides)} ajuste${adjustedSlotCount(day.overrides) > 1 ? 's' : ''} feito${adjustedSlotCount(day.overrides) > 1 ? 's' : ''} só para este dia.`]
      : []),
  ];
  return {
    title: 'Escala do dia - CEO',
    dateLabel: `${WEEKDAY_LABEL[weekdayOf(date)]}, ${formatDate(date)}`,
    hoursLabel: openingLabel(data),
    open: day.open,
    closedNote: day.closedNote,
    absences: day.absences.map((a) => ({ asb: asbName(data, a.asbId), period: mergedPeriodLabel(data, a), reason: a.reason, cover: coverLabel(data, a) })),
    notes,
    columns: [...roomNames, ...SUPPORT.map((c) => c.label)],
    rows: fullRows,
    asbRows: asbRows(data, day),
    tasks,
    generatedAt: `Gerado em ${formatDate(todayIso(now))} às ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
  };
}

