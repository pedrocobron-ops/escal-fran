// Sugestão de cobertura: quem pode cobrir uma ASB ausente num período.

import type { AppData, Id, IsoDate } from './types';
import { addDays, weekdayOf } from './dates';
import { absenceFor } from './absences';
import { canAssignOn, effectiveDay } from './schedule';

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

function needsCover(kind: string): boolean {
  return kind === 'sala' || kind === 'cme' || kind === 'almox';
}

/**
 * Para cada ASB ativa (menos a ausente), conta quantos blocos da ausente ela
 * cobriria estando livre (sem slot, apoio ou recepção) e dentro do contrato ou
 * hora extra. Ordena da melhor para a pior. Ignora dias em que o CEO não abre.
 */
export function coverageSuggestions(data: AppData, absentId: Id, from: IsoDate, to: IsoDate, exceptAbsenceId?: Id): CoverSuggestion[] {
  const absentSlots = data.base.slots.filter((s) => s.asbId === absentId && needsCover(s.kind));
  const candidates = data.asbs.filter((a) => a.active && a.id !== absentId);
  const stats = new Map<Id, CoverSuggestion>(candidates.map((a) => [a.id, { asbId: a.id, name: a.name, covered: 0, total: 0, needsExtra: 0 }]));
  const scoped: AppData = { ...data, absences: data.absences.filter((a) => a.id !== exceptAbsenceId) };
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (!data.openDays.includes(weekdayOf(date))) continue;
    const day = effectiveDay(scoped, date);
    for (const c of candidates) {
      const st = stats.get(c.id)!;
      const absentToday = absenceFor(scoped, c.id, date) !== undefined;
      for (const s of absentSlots) {
        st.total++;
        if (absentToday) continue;
        const mine = day.slots.filter((e) => e.hour === s.hour && e.who.type === 'asb' && e.who.asbId === c.id);
        const free = mine.every((e) => e.kind === 'apoio' || e.kind === 'recepcao');
        if (!free) continue;
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
 * caem fora do contrato dela. Só conta blocos em que ela estaria livre (sem
 * outra atribuição) e que ainda não têm hora extra. Agrupa horas seguidas.
 */
export function extraNeededToCover(data: AppData, absentId: Id, subId: Id, from: IsoDate, to: IsoDate, exceptAbsenceId?: Id): ExtraNeed[] {
  const sub = data.asbs.find((a) => a.id === subId);
  if (!sub) return [];
  const absentSlots = data.base.slots.filter((s) => s.asbId === absentId && needsCover(s.kind));
  const scoped: AppData = { ...data, absences: data.absences.filter((a) => a.id !== exceptAbsenceId) };
  const out: ExtraNeed[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (!data.openDays.includes(weekdayOf(date))) continue;
    if (absenceFor(scoped, subId, date)) continue;
    const day = effectiveDay(scoped, date);
    const hours = [...new Set(absentSlots.map((s) => s.hour))]
      .filter((h) => !canAssignOn(sub, h, day.extraShifts))
      .filter((h) => !day.slots.some((e) => e.hour === h && e.who.type === 'asb' && e.who.asbId === subId))
      .sort((a, b) => a - b);
    for (const h of hours) {
      const last = out[out.length - 1];
      if (last && last.date === date && last.end === h) last.end = h + 1;
      else out.push({ date, start: h, end: h + 1 });
    }
  }
  return out;
}
