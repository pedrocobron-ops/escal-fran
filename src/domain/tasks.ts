// Responsável por tarefa numa data (5.3) e rodízios por mês (5.4).

import type { AppData, EffectiveDay, Id, IsoDate, PeriodHolder, Person, Task, TaskMode } from './types';
import { lastOfMonth, mod, monthsSince, todayIso, weekdayOf, weeksOfMonth, weeksSince, type MonthWeek } from './dates';
import { absenceFor, isExternalSubstitute, isTeamSubstitute } from './absences';
import { effectiveDay, isOpenOn } from './schedule';
import { dataForDate } from './history';
import { formatHour, formatRange, groupHours } from './time';
import { formatDate } from './dates';

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
export function resolveTask(current: AppData, taskNow: Task, date: IsoDate, day?: EffectiveDay): TaskResolution {
  // Dia passado: tarefas, ordem dos rodízios e nomes como eram nesse dia.
  const data = dataForDate(current, date);
  const task = data.tasks.find((t) => t.id === taskNow.id) ?? taskNow;
  const weekday = weekdayOf(date);
  const base: TaskResolution = { taskId: task.id, applies: true, holders: [], reason: '' };
  if (!isOpenOn(data, date) || !task.days.includes(weekday)) {
    return { ...base, applies: false, reason: 'Não acontece nesse dia.' };
  }
  // Alguém fixo no período (ex.: um mês inteiro na conferência de prótese) tem prioridade.
  const fixed = periodHolderOn(task, date);
  if (fixed) {
    const asb = data.asbs.find((x) => x.id === fixed.asbId);
    const eff = day ?? effectiveDay(data, date);
    if (asb && asb.active && eff.presentAsbIds.includes(asb.id)) {
      return { ...base, holders: [{ type: 'asb', asbId: asb.id }], reason: `${asb.name} fica fixa nesta tarefa de ${formatDate(fixed.from)} a ${formatDate(fixed.to)}.` };
    }
    const why = !asb ? 'saiu da equipe' : !asb.active ? 'está inativa' : 'está ausente';
    const rest = resolveByMode(data, task, date, base, day);
    return { ...rest, reason: `${asb?.name ?? 'A responsável fixa'} (fixa de ${formatDate(fixed.from)} a ${formatDate(fixed.to)}) ${why}. ${rest.reason}` };
  }
  return resolveByMode(data, task, date, base, day);
}

/** Responsável fixo que vale na data, se houver. */
export function periodHolderOn(task: Task, date: IsoDate): PeriodHolder | undefined {
  return (task.holdersByPeriod ?? []).find((h) => h.from <= date && date <= h.to);
}

function resolveByMode(data: AppData, task: Task, date: IsoDate, base: TaskResolution, day?: EffectiveDay): TaskResolution {
  const a = task.assignment;
  switch (a.mode) {
    case 'dentist': {
      const dentist = data.dentists.find((d) => d.id === a.dentistId);
      if (!dentist) return { ...base, reason: 'Dentista não encontrado.' };
      const eff = day ?? effectiveDay(data, date);
      const roomName = data.rooms.find((r) => r.id === dentist.roomId)?.name ?? dentist.roomId;
      if (eff.dentistsOff.some((d) => d.id === dentist.id)) {
        // Folga: a tarefa continua com quem normalmente está com esse dentista, se veio trabalhar.
        const usual = uniquePersons(
          data.base.slots
            .filter((s) => s.kind === 'sala' && s.roomId === dentist.roomId && s.hour >= dentist.start && s.hour < dentist.end)
            .filter((s) => eff.presentAsbIds.includes(s.asbId))
            .map((s) => ({ type: 'asb', asbId: s.asbId }) as Person),
        );
        return {
          ...base,
          holders: usual,
          reason: usual.length > 0
            ? `${dentist.name} está de folga; fica com quem normalmente trabalha nesse atendimento: ${usual.map((p) => personName(data, p)).join(' e ')}.`
            : `${dentist.name} está de folga e quem normalmente trabalha nesse atendimento também não veio.`,
        };
      }
      if (!eff.dentists.some((d) => d.id === dentist.id)) {
        return { ...base, reason: `${dentist.name} não atende nesse dia.` };
      }
      const inRoom = eff.slots.filter((s) => s.kind === 'sala' && s.roomId === dentist.roomId && s.hour >= dentist.start && s.hour < dentist.end);
      const holders = uniquePersons(inRoom.map((s) => s.who));
      if (holders.length === 0) return { ...base, holders, reason: `Ninguém na ${roomName} com ${dentist.name} (${formatRange(dentist.start, dentist.end)}).` };
      // Horas de cada uma na sala, para diferenciar quem fica o turno de quem só cobre um horário.
      const parts = holders.map((p) => {
        const hours = inRoom.filter((s) => (p.type === 'asb' ? s.who.type === 'asb' && s.who.asbId === p.asbId : s.who.type === 'external' && s.who.name === p.name)).map((s) => s.hour);
        return `${personName(data, p)} (${groupHours(hours).map(([a, b]) => formatRange(a, b)).join(', ')})`;
      });
      return {
        ...base,
        holders,
        reason: `Na ${roomName} com ${dentist.name}: ${parts.join(' e ')}.`,
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
export function resolveTasksForDate(current: AppData, date: IsoDate): TaskResolution[] {
  const data = dataForDate(current, date);
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

/**
 * Titulares dos rodízios nas semanas do mês (5.4). Cada semana usa o rodízio como
 * estava no fim dela (ou hoje, na semana corrente), igual ao que Tarefas mostra para
 * esses dias; mudar a ordem hoje não reescreve as semanas que já passaram. Semanas sem
 * nenhum dia da tarefa dentro do mês ficam de fora.
 */
export function monthRotation(current: AppData, task: Task, year: number, month: number, today: IsoDate = todayIso()): MonthRotation | undefined {
  if (task.assignment.mode !== 'rotation') return undefined;
  const weeks = weeksOfMonth(year, month);
  const asOf = (date: IsoDate) => {
    const t = dataForDate(current, date < today ? date : today).tasks.find((x) => x.id === task.id);
    return t && t.assignment.mode === 'rotation' ? t.assignment : undefined;
  };
  if (task.assignment.period === 'month') {
    const first = weeks[0]?.days[0] ?? `${year}-${String(month).padStart(2, '0')}-01`;
    const a = asOf(lastOfMonth(year, month));
    return a ? { taskId: task.id, period: 'month', weeks: [], monthTitularId: rotationTitular(a, first) } : undefined;
  }
  const entries: RotationWeekEntry[] = [];
  for (const week of weeks) {
    const taskDays = week.days.filter((d) => task.days.includes(weekdayOf(d)));
    if (taskDays.length === 0) continue;
    const a = asOf(taskDays[taskDays.length - 1]);
    if (!a) continue;
    const titularId = rotationTitular(a, week.monday);
    if (!titularId) continue;
    const absentDays = taskDays.filter((d) => absenceFor(current, titularId, d) !== undefined);
    entries.push({ week, titularId, absentDays });
  }
  return { taskId: task.id, period: 'week', weeks: entries };
}

/**
 * Rodízios que existiram em algum momento do mês (um removido no meio do mês continua
 * aparecendo nas semanas em que existia). Vale a versão mais recente de cada um.
 */
export function rotationTasksInMonth(current: AppData, year: number, month: number, today: IsoDate = todayIso()): Task[] {
  const byId = new Map<string, Task>();
  const dates = [...weeksOfMonth(year, month).map((w) => w.days[w.days.length - 1]), lastOfMonth(year, month)];
  for (const d of dates) {
    for (const t of dataForDate(current, d < today ? d : today).tasks) {
      if (t.assignment.mode === 'rotation') byId.set(t.id, t);
    }
  }
  const order = current.tasks.map((t) => t.id);
  return [...byId.values()].sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
}
