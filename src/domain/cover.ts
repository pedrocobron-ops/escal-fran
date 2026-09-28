// Sugestão de cobertura: quem pode cobrir uma ASB ausente num período.

import type { AppData, EffectiveDay, EffectiveSlot, Id, IsoDate, Slot } from './types';
import { addDays, diffDays, parseIso, weekdayOf } from './dates';
import { absenceFor } from './absences';
import { canAssignOn, dentistsAt, effectiveDay } from './schedule';
import { dataForDate } from './history';

/** Limite de dias analisados de uma vez (evita travar com datas digitadas pela metade). */
export const MAX_COVER_DAYS = 400;

export interface CoverSuggestion {
  asbId: Id;
  name: string;
  /** Blocos de sala/CME/almoxarifado da ausente que essa ASB consegue cobrir no período. */
  covered: number;
  /** Total de blocos da ausente que precisam de cobertura no período. */
  total: number;
  /** Blocos em que a candidata precisaria de hora extra (fora do contrato). */
  needsExtra: number;
}

/** Período razoável para calcular: datas completas entre 2000 e 2100 e até MAX_COVER_DAYS. */
export function isReasonablePeriod(from: IsoDate, to: IsoDate): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return false;
  const y1 = parseIso(from).year;
  const y2 = parseIso(to).year;
  return y1 >= 2000 && y2 <= 2100 && diffDays(from, to) <= MAX_COVER_DAYS;
}

/** Slots da ausente que precisam de alguém nesse dia (sala só se tem dentista atendendo). */
function slotsToCover(data: AppData, day: EffectiveDay, absentId: Id): Slot[] {
  return data.base.slots.filter(
    (s) =>
      s.asbId === absentId &&
      (s.kind === 'cme' || s.kind === 'almox' || (s.kind === 'sala' && !!s.roomId && dentistsAt(day.dentists, s.roomId, s.hour).length > 0)),
  );
}

/** A candidata está livre nesse bloco? (sem atribuição, apoio/recepção ou sala sem dentista) */
function isFreeAt(day: EffectiveDay, asbId: Id, hour: number): boolean {
  const mine = day.slots.filter((e: EffectiveSlot) => e.hour === hour && e.who.type === 'asb' && e.who.asbId === asbId);
  return mine.every(
    (e) => e.kind === 'apoio' || e.kind === 'recepcao' || (e.kind === 'sala' && !!e.roomId && dentistsAt(day.dentists, e.roomId, hour).length === 0),
  );
}

/**
 * Para cada ASB ativa (menos a ausente), conta quantos blocos da ausente ela
 * cobriria estando livre e dentro do contrato ou hora extra. Ordena da melhor
 * para a pior. Ignora dias em que o CEO não abre.
 */
export function coverageSuggestions(data: AppData, absentId: Id, from: IsoDate, to: IsoDate, exceptAbsenceId?: Id): CoverSuggestion[] {
  if (!isReasonablePeriod(from, to)) return [];
  const scoped: AppData = { ...data, absences: data.absences.filter((a) => a.id !== exceptAbsenceId) };
  const candidates = data.asbs.filter((a) => a.active && a.id !== absentId);
  const stats = new Map<Id, CoverSuggestion>(candidates.map((a) => [a.id, { asbId: a.id, name: a.name, covered: 0, total: 0, needsExtra: 0 }]));
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const dated = dataForDate(scoped, date);
    if (!dated.openDays.includes(weekdayOf(date))) continue;
    const day = effectiveDay(scoped, date);
    const toCover = slotsToCover(dated, day, absentId);
    for (const c of candidates) {
      const st = stats.get(c.id)!;
      const absentToday = absenceFor(scoped, c.id, date) !== undefined;
      for (const s of toCover) {
        st.total++;
        if (absentToday || !isFreeAt(day, c.id, s.hour)) continue;
        if (canAssignOn(c, s.hour, day.extraShifts)) st.covered++;
        else st.needsExtra++;
      }
    }
  }
  return [...stats.values()].sort((a, b) => b.covered - a.covered || b.needsExtra - a.needsExtra || a.name.localeCompare(b.name));
}

export interface ExtraNeed {
  date: IsoDate;
  start: number;
  end: number;
}

/**
 * Horas extras que a substituta precisaria para cobrir os blocos da ausente que
 * caem fora do contrato dela. Só conta blocos em que ela estaria livre e que ainda
 * não têm hora extra. Agrupa horas seguidas. `ignoreExtraIds`: horas extras a
 * desconsiderar (as que a própria ausência criou, ao editar).
 */
export function extraNeededToCover(
  data: AppData,
  absentId: Id,
  subId: Id,
  from: IsoDate,
  to: IsoDate,
  exceptAbsenceId?: Id,
  ignoreExtraIds: Id[] = [],
): ExtraNeed[] {
  const sub = data.asbs.find((a) => a.id === subId);
  if (!sub || !isReasonablePeriod(from, to)) return [];
  const ignore = new Set(ignoreExtraIds);
  const scoped: AppData = {
    ...data,
    absences: data.absences.filter((a) => a.id !== exceptAbsenceId),
    extraShifts: (data.extraShifts ?? []).filter((e) => !ignore.has(e.id)),
  };
  const out: ExtraNeed[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const dated = dataForDate(scoped, date);
    if (!dated.openDays.includes(weekdayOf(date))) continue;
    if (absenceFor(scoped, subId, date)) continue;
    const day = effectiveDay(scoped, date);
    const hours = [...new Set(slotsToCover(dated, day, absentId).map((s) => s.hour))]
      .filter((h) => !canAssignOn(sub, h, day.extraShifts))
      .filter((h) => isFreeAt(day, subId, h))
      .sort((a, b) => a - b);
    for (const h of hours) {
      const last = out[out.length - 1];
      if (last && last.date === date && last.end === h) last.end = h + 1;
      else out.push({ date, start: h, end: h + 1 });
    }
  }
  return out;
}

/** Blocos da ausente que continuam sem ninguém no período (depois de substituta e remanejamentos). */
export function stillUncovered(data: AppData, absentId: Id, from: IsoDate, to: IsoDate): Array<{ date: IsoDate; hours: number[] }> {
  if (!isReasonablePeriod(from, to)) return [];
  const out: Array<{ date: IsoDate; hours: number[] }> = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const dated = dataForDate(data, date);
    if (!dated.openDays.includes(weekdayOf(date))) continue;
    const day = effectiveDay(data, date);
    const hours = day.uncovered
      .filter((u) => u.slot.asbId === absentId)
      .filter((u) =>
        u.slot.kind === 'sala'
          ? !day.slots.some((s) => s.kind === 'sala' && s.roomId === u.slot.roomId && s.hour === u.slot.hour)
          : !day.slots.some((s) => s.hour === u.slot.hour && s.kind === u.slot.kind && s.coveringFor === absentId),
      )
      .map((u) => u.slot.hour);
    if (hours.length > 0) out.push({ date, hours: [...new Set(hours)].sort((a, b) => a - b) });
  }
  return out;
}
