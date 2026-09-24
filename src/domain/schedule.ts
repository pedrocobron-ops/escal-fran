// Escala efetiva de um dia (5.1) e validações (5.2).

import type {
  Alert,
  AppData,
  Asb,
  Dentist,
  EffectiveDay,
  EffectiveSlot,
  Id,
  IsoDate,
  Person,
  Slot,
  UncoveredSlot,
} from './types';
import { HOURS, SLOT_KIND_LABEL } from './types';
import { weekdayOf, monthsSince } from './dates';
import { absencesOn, isExternalSubstitute, isTeamSubstitute } from './absences';
import { formatHour, formatRange, hoursBetween } from './time';

const DEFAULT_DAYS = [1, 2, 3, 4, 5];

/** Dentista atende nesse dia da semana? Lista vazia ou ausente = segunda a sexta. */
export function dentistWorksOn(d: Dentist, weekday: number): boolean {
  const days = d.days && d.days.length > 0 ? d.days : DEFAULT_DAYS;
  return days.includes(weekday);
}

/** Dentistas atendendo numa sala num bloco. */
export function dentistsAt(dentists: Dentist[], roomId: Id, hour: number): Dentist[] {
  return dentists.filter((d) => d.roomId === roomId && hour >= d.start && hour < d.end);
}

/** A ASB pode ter slot nesse bloco? (dentro do contrato) */
export function canAssign(asb: Pick<Asb, 'start' | 'end'>, hour: number): boolean {
  return hour >= asb.start && hour < asb.end;
}

/** Blocos válidos para a ASB dentro do horário de funcionamento. */
export function validHours(asb: Pick<Asb, 'start' | 'end'>): number[] {
  return HOURS.filter((h) => canAssign(asb, h));
}

function personKey(p: Person): string {
  return p.type === 'asb' ? `asb:${p.asbId}` : `ext:${p.name}`;
}

export function samePerson(a: Person, b: Person): boolean {
  return personKey(a) === personKey(b);
}

/** Slot livre para herdar cobertura: apoio, recepção ou sem slot. */
function isFreeKind(kind: Slot['kind'] | undefined): boolean {
  return kind === undefined || kind === 'apoio' || kind === 'recepcao';
}

/** Slots que precisam de cobertura quando a ASB falta. */
function needsCover(kind: Slot['kind']): boolean {
  return kind === 'sala' || kind === 'cme' || kind === 'almox';
}

/**
 * Escala efetiva de um dia: parte da base, tira ausentes, aplica substitutas.
 * Não resolve tarefas (ver tasks.ts).
 */
export function effectiveDay(data: AppData, date: IsoDate): EffectiveDay {
  const weekday = weekdayOf(date);
  const open = data.openDays.includes(weekday);
  const activeIds = new Set(data.asbs.filter((a) => a.active).map((a) => a.id));
  const asbById = new Map(data.asbs.map((a) => [a.id, a]));
  const absences = absencesOn(data, date).filter((a) => activeIds.has(a.asbId));
  const absentIds = new Set(absences.map((a) => a.asbId));

  // 1. Base, só de ASBs ativas e presentes.
  const slots: EffectiveSlot[] = data.base.slots
    .filter((s) => activeIds.has(s.asbId) && !absentIds.has(s.asbId))
    .map((s) => ({
      hour: s.hour,
      kind: s.kind,
      roomId: s.roomId,
      who: { type: 'asb', asbId: s.asbId },
      origin: 'base',
    }));

  const uncovered: UncoveredSlot[] = [];

  // 2. Substituições, na ordem das ausências.
  for (const absence of absences) {
    const absentSlots = data.base.slots.filter((s) => s.asbId === absence.asbId);
    if (isExternalSubstitute(absence)) {
      for (const s of absentSlots) {
        slots.push({
          hour: s.hour,
          kind: s.kind,
          roomId: s.roomId,
          who: { type: 'external', name: absence.substitute.externalName },
          origin: 'external',
          coveringFor: absence.asbId,
        });
      }
      continue;
    }
    if (!isTeamSubstitute(absence)) {
      for (const s of absentSlots) {
        if (needsCover(s.kind)) uncovered.push({ slot: s, absenceId: absence.id, reason: 'sem-substituta' });
      }
      continue;
    }
    const subId = absence.substitute.asbId;
    const sub = asbById.get(subId);
    const subAvailable = sub !== undefined && sub.active && !absentIds.has(subId);
    for (const s of absentSlots) {
      if (s.kind === 'almoco') continue; // almoço da ausente não precisa de cobertura
      if (!subAvailable) {
        if (needsCover(s.kind)) uncovered.push({ slot: s, absenceId: absence.id, reason: 'substituta-ausente', substituteId: subId });
        continue;
      }
      if (!canAssign(sub, s.hour)) {
        if (needsCover(s.kind)) uncovered.push({ slot: s, absenceId: absence.id, reason: 'substituta-fora-do-contrato', substituteId: subId });
        continue;
      }
      const idx = slots.findIndex((e) => e.hour === s.hour && e.who.type === 'asb' && e.who.asbId === subId);
      const current = idx >= 0 ? slots[idx] : undefined;
      if (!isFreeKind(current?.kind)) {
        if (needsCover(s.kind)) {
          uncovered.push({ slot: s, absenceId: absence.id, reason: 'substituta-ocupada', busyWith: current?.kind, substituteId: subId });
        }
        continue;
      }
      if (!needsCover(s.kind)) continue; // apoio da ausente: a substituta já está livre, nada a herdar
      const inherited: EffectiveSlot = {
        hour: s.hour,
        kind: s.kind,
        roomId: s.roomId,
        who: { type: 'asb', asbId: subId },
        origin: 'substitute',
        coveringFor: absence.asbId,
      };
      if (idx >= 0) slots[idx] = inherited;
      else slots.push(inherited);
    }
  }

  slots.sort((a, b) => a.hour - b.hour);

  return {
    date,
    weekday,
    open,
    slots,
    absences,
    uncovered,
    presentAsbIds: data.asbs.filter((a) => a.active && !absentIds.has(a.id)).map((a) => a.id),
    dentists: data.dentists.filter((d) => dentistWorksOn(d, weekday)),
  };
}

/**
 * Dia genérico a partir da escala base, sem data: todas as ASBs ativas presentes e
 * todos os dentistas atendendo. Usado pelo Quadro no modo base.
 */
export function baseDay(data: AppData): EffectiveDay {
  const activeIds = new Set(data.asbs.filter((a) => a.active).map((a) => a.id));
  return {
    date: '',
    weekday: -1,
    open: true,
    slots: data.base.slots
      .filter((s) => activeIds.has(s.asbId))
      .map((s) => ({ hour: s.hour, kind: s.kind, roomId: s.roomId, who: { type: 'asb', asbId: s.asbId }, origin: 'base' })),
    absences: [],
    uncovered: [],
    presentAsbIds: [...activeIds],
    dentists: data.dentists,
  };
}

function personName(data: AppData, p: Person): string {
  if (p.type === 'external') return `${p.name} (externa)`;
  return data.asbs.find((a) => a.id === p.asbId)?.name ?? p.asbId;
}

/** Validações da seção 5.2 sobre um dia (efetivo ou base). */
export function analyze(data: AppData, day: EffectiveDay): Alert[] {
  const alerts: Alert[] = [];
  if (!day.open) return alerts;
  const roomName = (id: Id) => data.rooms.find((r) => r.id === id)?.name ?? id;
  const asbById = new Map(data.asbs.map((a) => [a.id, a]));

  // Sala com dentista e nenhuma ASB (crítico) e duas ASBs na mesma sala (aviso).
  for (const room of data.rooms) {
    for (const hour of HOURS) {
      const dentists = dentistsAt(day.dentists, room.id, hour);
      const here = day.slots.filter((s) => s.kind === 'sala' && s.roomId === room.id && s.hour === hour);
      if (dentists.length > 0 && here.length === 0) {
        alerts.push({
          level: 'critico',
          code: 'sala-sem-asb',
          message: `${room.name} às ${formatHour(hour)}: ${dentists.map((d) => d.name).join(' e ')} atendendo sem ASB.`,
          hour,
          roomId: room.id,
        });
      }
      if (here.length > 1) {
        alerts.push({
          level: 'aviso',
          code: 'duas-asbs-mesma-sala',
          message: `${room.name} às ${formatHour(hour)}: ${here.map((s) => personName(data, s.who)).join(' e ')} na mesma sala.`,
          hour,
          roomId: room.id,
        });
      }
    }
  }

  // ASB em sala sem dentista (aviso).
  for (const s of day.slots) {
    if (s.kind !== 'sala' || !s.roomId) continue;
    if (dentistsAt(day.dentists, s.roomId, s.hour).length === 0) {
      alerts.push({
        level: 'aviso',
        code: 'sala-sem-dentista',
        message: `${personName(data, s.who)} na ${roomName(s.roomId)} às ${formatHour(s.hour)}, sem dentista atendendo.`,
        hour: s.hour,
        roomId: s.roomId,
        asbId: s.who.type === 'asb' ? s.who.asbId : undefined,
      });
    }
  }

  // Por ASB presente: almoço obrigatório e blocos do contrato sem atribuição.
  for (const asbId of day.presentAsbIds) {
    const asb = asbById.get(asbId);
    if (!asb) continue;
    const mine = day.slots.filter((s) => s.who.type === 'asb' && s.who.asbId === asbId);
    if (asb.lunch && !mine.some((s) => s.kind === 'almoco')) {
      alerts.push({
        level: 'critico',
        code: 'sem-almoco',
        message: `${asb.name} precisa de 1 hora de almoço e não tem bloco de almoço.`,
        asbId,
      });
    }
    for (const hour of hoursBetween(asb.start, asb.end)) {
      if (!HOURS.includes(hour)) continue;
      if (!mine.some((s) => s.hour === hour)) {
        alerts.push({
          level: 'aviso',
          code: 'bloco-sem-atribuicao',
          message: `${asb.name} sem atribuição às ${formatHour(hour)} (contrato ${formatRange(asb.start, asb.end)}).`,
          hour,
          asbId,
        });
      }
    }
  }

  // Ausências: sem substituta ou substituta com choque.
  for (const u of day.uncovered) {
    const absent = asbById.get(u.slot.asbId)?.name ?? u.slot.asbId;
    const where = u.slot.kind === 'sala' && u.slot.roomId ? roomName(u.slot.roomId) : SLOT_KIND_LABEL[u.slot.kind];
    if (u.reason === 'sem-substituta') {
      alerts.push({
        level: 'aviso',
        code: 'ausente-sem-substituta',
        message: `${absent} ausente às ${formatHour(u.slot.hour)} (${where}) sem substituta.`,
        hour: u.slot.hour,
        roomId: u.slot.roomId,
        asbId: u.slot.asbId,
      });
      continue;
    }
    const sub = u.substituteId ? (asbById.get(u.substituteId)?.name ?? u.substituteId) : 'substituta';
    const why =
      u.reason === 'substituta-ausente'
        ? 'também está ausente'
        : u.reason === 'substituta-fora-do-contrato'
          ? 'está fora do horário de contrato'
          : u.busyWith === 'almoco'
            ? 'está no almoço'
            : u.busyWith === 'sala'
              ? 'já está em outra sala'
              : u.busyWith
                ? `já está no ${SLOT_KIND_LABEL[u.busyWith]}`
                : 'já está em outra atividade';
    alerts.push({
      level: 'aviso',
      code: 'substituta-choque',
      message: `${sub} cobre ${absent} mas ${why} às ${formatHour(u.slot.hour)} (${where} fica descoberta).`,
      hour: u.slot.hour,
      roomId: u.slot.roomId,
      asbId: u.substituteId,
    });
  }

  return alerts;
}

/** Atalhos: analisar a base ou uma data. */
export function analyzeBase(data: AppData): Alert[] {
  return analyze(data, baseDay(data));
}

export function analyzeDate(data: AppData, date: IsoDate): Alert[] {
  return analyze(data, effectiveDay(data, date));
}

// ---- Regra da Prótese (1 mês fixa) ----

export function isProteseDentist(d: Dentist): boolean {
  return /pr[oó]tese/i.test(d.specialty);
}

/** ASB que mais aparece na sala do dentista durante o horário dele, na escala base. */
export function asbWithDentistInBase(data: AppData, dentist: Dentist): Id | undefined {
  const count = new Map<Id, number>();
  for (const s of data.base.slots) {
    if (s.kind !== 'sala' || s.roomId !== dentist.roomId) continue;
    if (s.hour < dentist.start || s.hour >= dentist.end) continue;
    count.set(s.asbId, (count.get(s.asbId) ?? 0) + 1);
  }
  let best: Id | undefined;
  let bestN = 0;
  for (const [id, n] of count) {
    if (n > bestN) {
      best = id;
      bestN = n;
    }
  }
  return best;
}

/** Aviso quando a ASB da Prótese mudou antes de completar 1 mês. */
export function proteseAlerts(data: AppData, today: IsoDate): Alert[] {
  const alerts: Alert[] = [];
  for (const rec of data.protese ?? []) {
    const dentist = data.dentists.find((d) => d.id === rec.dentistId);
    if (!dentist) continue;
    const current = asbWithDentistInBase(data, dentist);
    if (!current || current === rec.asbId) continue;
    if (monthsSince(rec.since, today) >= 1) continue;
    const prev = data.asbs.find((a) => a.id === rec.asbId)?.name ?? rec.asbId;
    const now = data.asbs.find((a) => a.id === current)?.name ?? current;
    alerts.push({
      level: 'aviso',
      code: 'protese-trocou-antes-do-mes',
      message: `Prótese (${dentist.name}): ${prev} foi trocada por ${now} antes de completar 1 mês.`,
      roomId: dentist.roomId,
      asbId: current,
    });
  }
  return alerts;
}

/**
 * Histórico da Prótese atualizado: registra a ASB atual quando não há registro
 * ou quando o registro já completou 1 mês. Mantém o registro antigo enquanto o
 * mês não fecha, para o aviso continuar aparecendo.
 */
export function nextProteseRecords(data: AppData, today: IsoDate): AppData['protese'] {
  const out: NonNullable<AppData['protese']> = [];
  for (const dentist of data.dentists.filter(isProteseDentist)) {
    const current = asbWithDentistInBase(data, dentist);
    const rec = (data.protese ?? []).find((r) => r.dentistId === dentist.id);
    if (!current) {
      if (rec) out.push(rec);
      continue;
    }
    if (!rec || (rec.asbId !== current && monthsSince(rec.since, today) >= 1)) {
      out.push({ dentistId: dentist.id, asbId: current, since: today });
    } else {
      out.push(rec);
    }
  }
  return out;
}
