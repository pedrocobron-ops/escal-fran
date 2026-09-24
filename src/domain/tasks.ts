// Responsável por tarefa numa data (5.3) e rodízios por mês (5.4).

import type { AppData, EffectiveDay, Id, IsoDate, Person, Task, TaskMode } from './types';
import { mod, monthsSince, weekdayOf, weeksOfMonth, weeksSince, type MonthWeek } from './dates';
import { absenceFor, isExternalSubstitute, isTeamSubstitute } from './absences';
import { effectiveDay } from './schedule';
import { formatHour, formatRange } from './time';

export type RotationAssignment = Extract<TaskMode, { mode: 'rotation' }>;

/** Índice na ordem do rodízio para uma data. Datas antes de startDate contam para trás. */
export function rotationIndex(r: RotationAssignment, date: IsoDate): number {
  if (r.order.length === 0) return -1;
  const n = r.period === 'week' ? weeksSince(r.startDate, date) : monthsSince(r.startDate, date);
  return mod(n, r.order.length);
}

/** Titular do rodízio na data, sem considerar ausências. */
export function rotationTitular(r: RotationAssignment, date: IsoDate): Id | undefined {
  const i = rotationIndex(r, date);
  return i < 0 ? undefined : r.order[i];
}

export interface TaskResolution {
  taskId: Id;
  /** false quando a tarefa não acontece nesse dia da semana. */
  applies: boolean;
  /** Quem faz. Vazio = ninguém resolvido. */
  holders: Person[];
  /** Rodízio: titular da vez, mesmo se ausente. */
  titularId?: Id;
  titularAbsent?: boolean;
  /** Rodízio: titular ausente e sem substituta (ou substituta também ausente). */
  noSubstitute?: boolean;
  /** Rodízio: titular está inativa mas continua na ordem. */
  titularInactive?: boolean;
  /** Explicação curta em português. */
  reason: string;
}

function asbName(data: AppData, id: Id): string {
  return data.asbs.find((a) => a.id === id)?.name ?? id;
}

function personName(data: AppData, p: Person): string {
  return p.type === 'asb' ? asbName(data, p.asbId) : `${p.name} (externa)`;
}

function uniquePersons(list: Person[]): Person[] {
  const seen = new Set<string>();
  const out: Person[] = [];
  for (const p of list) {
    const k = p.type === 'asb' ? `a:${p.asbId}` : `e:${p.name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/** Quem cobre a titular de um rodízio numa data (ausência com substituta). */
function rotationHolder(
  data: AppData,
  titularId: Id,
  date: IsoDate,
): Pick<TaskResolution, 'holders' | 'titularAbsent' | 'noSubstitute' | 'titularInactive'> & { substituteUnavailable?: string } {
  const titular = data.asbs.find((a) => a.id === titularId);
  if (!titular || !titular.active) return { holders: [], titularAbsent: false, noSubstitute: false, titularInactive: true };
  const absence = absenceFor(data, titularId, date);
  if (!absence) return { holders: [{ type: 'asb', asbId: titularId }], titularAbsent: false, noSubstitute: false };
  if (isTeamSubstitute(absence)) {
    const sub = data.asbs.find((a) => a.id === absence.substitute.asbId);
    if (!sub || !sub.active) return { holders: [], titularAbsent: true, noSubstitute: true, substituteUnavailable: `${sub?.name ?? 'a substituta'} está inativa` };
    if (absenceFor(data, sub.id, date)) return { holders: [], titularAbsent: true, noSubstitute: true, substituteUnavailable: `${sub.name} também está ausente` };
    return { holders: [{ type: 'asb', asbId: sub.id }], titularAbsent: true, noSubstitute: false };
  }
  if (isExternalSubstitute(absence)) {
    return { holders: [{ type: 'external', name: absence.substitute.externalName }], titularAbsent: true, noSubstitute: false };
  }
  return { holders: [], titularAbsent: true, noSubstitute: true };
}

/**
 * Resolve quem faz a tarefa numa data. `day` pode ser passado para reaproveitar
 * a escala efetiva já calculada.
 */
export function resolveTask(data: AppData, task: Task, date: IsoDate, day?: EffectiveDay): TaskResolution {
  const weekday = weekdayOf(date);
  const base: TaskResolution = { taskId: task.id, applies: true, holders: [], reason: '' };
  if (!data.openDays.includes(weekday) || !task.days.includes(weekday)) {
    return { ...base, applies: false, reason: 'Não acontece nesse dia.' };
  }
  const a = task.assignment;
  switch (a.mode) {
    case 'dentist': {
      const dentist = data.dentists.find((d) => d.id === a.dentistId);
      if (!dentist) return { ...base, reason: 'Dentista não encontrado.' };
      const eff = day ?? effectiveDay(data, date);
      if (!eff.dentists.some((d) => d.id === dentist.id)) {
        return { ...base, reason: `${dentist.name} não atende nesse dia.` };
      }
      const roomName = data.rooms.find((r) => r.id === dentist.roomId)?.name ?? dentist.roomId;
      const holders = uniquePersons(
        eff.slots
          .filter((s) => s.kind === 'sala' && s.roomId === dentist.roomId && s.hour >= dentist.start && s.hour < dentist.end)
          .map((s) => s.who),
      );
      const who = holders.length > 0 ? holders.map((p) => personName(data, p)).join(' e ') : 'Ninguém';
      return {
        ...base,
        holders,
        reason: `${who} na ${roomName} com ${dentist.name} (${formatRange(dentist.start, dentist.end)}).`,
      };
    }
    case 'room': {
      const eff = day ?? effectiveDay(data, date);
      const roomName = data.rooms.find((r) => r.id === a.roomId)?.name ?? a.roomId;
      const holders = uniquePersons(
        eff.slots.filter((s) => s.kind === 'sala' && s.roomId === a.roomId && s.hour === a.hour).map((s) => s.who),
      );
      const who = holders.length > 0 ? holders.map((p) => personName(data, p)).join(' e ') : 'Ninguém';
      return { ...base, holders, reason: `${who} na ${roomName} às ${formatHour(a.hour)}.` };
    }
    case 'rotation': {
      const titularId = rotationTitular(a, date);
      if (!titularId) return { ...base, reason: 'Rodízio sem ordem definida.' };
      const { substituteUnavailable, ...r } = rotationHolder(data, titularId, date);
      const label = a.period === 'week' ? 'da semana' : 'do mês';
      let reason = `${asbName(data, titularId)} é a titular ${label}.`;
      if (r.titularInactive) reason += ' Está inativa: ajuste a ordem do rodízio.';
      else if (r.titularAbsent) {
        reason += r.noSubstitute
          ? ` Está ausente, sem substituta${substituteUnavailable ? ` (${substituteUnavailable})` : ''}.`
          : ` Está ausente, cobre ${r.holders.map((p) => personName(data, p)).join(' e ')}.`;
      }
      return { ...base, ...r, titularId, reason };
    }
    case 'fixed': {
      const holders: Person[] = a.asbIds
        .filter((id) => data.asbs.find((x) => x.id === id)?.active)
        .map((id) => ({ type: 'asb', asbId: id }));
      return { ...base, holders, reason: 'Lista fixa.' };
    }
  }
}

/** Todas as tarefas de uma data, reaproveitando a escala efetiva. */
export function resolveTasksForDate(data: AppData, date: IsoDate): TaskResolution[] {
  const day = effectiveDay(data, date);
  return data.tasks.map((t) => resolveTask(data, t, date, day));
}

export interface RotationWeekEntry {
  week: MonthWeek;
  titularId: Id;
  /** Dias da semana (dentro do mês) em que a titular está ausente. */
  absentDays: IsoDate[];
}

export interface MonthRotation {
  taskId: Id;
  period: 'week' | 'month';
  /** Rodízio semanal: uma entrada por semana do mês. */
  weeks: RotationWeekEntry[];
  /** Rodízio mensal: titular do mês. */
  monthTitularId?: Id;
}

/** Titulares dos rodízios nas semanas do mês (5.4). */
export function monthRotation(data: AppData, task: Task, year: number, month: number): MonthRotation | undefined {
  const a = task.assignment;
  if (a.mode !== 'rotation') return undefined;
  const weeks = weeksOfMonth(year, month);
  if (a.period === 'month') {
    const first = weeks[0]?.days[0] ?? `${year}-${String(month).padStart(2, '0')}-01`;
    return { taskId: task.id, period: 'month', weeks: [], monthTitularId: rotationTitular(a, first) };
  }
  const entries: RotationWeekEntry[] = [];
  for (const week of weeks) {
    const titularId = rotationTitular(a, week.monday);
    if (!titularId) continue;
    const absentDays = week.days.filter((d) => task.days.includes(weekdayOf(d)) && absenceFor(data, titularId, d) !== undefined);
    entries.push({ week, titularId, absentDays });
  }
  return { taskId: task.id, period: 'week', weeks: entries };
}
