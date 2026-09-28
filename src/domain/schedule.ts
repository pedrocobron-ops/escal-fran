// Escala efetiva de um dia (5.1) e validações (5.2).

import type {
  Absence,
  Alert,
  AppData,
  Asb,
  Dentist,
  EffectiveDay,
  EffectiveSlot,
  ExtraShift,
  Id,
  IsoDate,
  Person,
  Slot,
  SlotOrigin,
  UncoveredSlot,
} from './types';
import { HOURS, SLOT_KIND_LABEL } from './types';
import { diffDays, weekdayOf } from './dates';
import { absencesOn, dentistAbsencesOn, extraShiftsOn, isExternalSubstitute, isTeamSubstitute } from './absences';
import { formatHour, formatRange, groupHours, hoursBetween } from './time';
import { dataForDate } from './history';

const DEFAULT_DAYS = [1, 2, 3, 4, 5];

/** O CEO abre nessa data? (dia da semana de funcionamento e não é feriado/data fechada) */
export function isOpenOn(data: Pick<AppData, 'openDays' | 'closedDates'>, date: IsoDate): boolean {
  return data.openDays.includes(weekdayOf(date)) && !(data.closedDates ?? []).some((c) => c.date === date);
}

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

/** Hora extra cobre esse bloco? */
export function inExtraShift(extras: ExtraShift[], asbId: Id, hour: number): boolean {
  return extras.some((e) => e.asbId === asbId && hour >= e.start && hour < e.end);
}

/** Contrato ou hora extra da data: onde a ASB pode ter slot nesse dia. */
export function canAssignOn(asb: Asb, hour: number, extras: ExtraShift[]): boolean {
  return canAssign(asb, hour) || inExtraShift(extras, asb.id, hour);
}

export function allowedHours(asb: Asb, extras: ExtraShift[]): number[] {
  return HOURS.filter((h) => canAssignOn(asb, h, extras));
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

/** Quantos horários (ASB e hora) têm ajuste: uma hora com duas salas conta uma vez. */
export function adjustedSlotCount(overrides: Array<{ asbId: string; hour: number }>): number {
  return new Set(overrides.map((o) => `${o.asbId}@${o.hour}`)).size;
}

/**
 * Escala efetiva de um dia: parte da base, tira ausentes, aplica substitutas,
 * aplica os ajustes do dia e remaneja automaticamente ASBs livres (dentista de
 * folga ou hora extra) para salas com dentista e sem ASB.
 * Não resolve tarefas (ver tasks.ts).
 */
export function effectiveDay(current: AppData, date: IsoDate): EffectiveDay {
  // Dia passado: usa a estrutura (salas, dentistas, ASBs, escala base) como era nesse dia.
  const data = dataForDate(current, date);
  const weekday = weekdayOf(date);
  const open = isOpenOn(data, date);
  const closedDate = (data.closedDates ?? []).find((c) => c.date === date);
  const closedNote = closedDate ? closedDate.note?.trim() || 'Feriado ou dia fechado' : undefined;
  const activeIds = new Set(data.asbs.filter((a) => a.active).map((a) => a.id));
  const asbById = new Map(data.asbs.map((a) => [a.id, a]));
  // Uma ausência por ASB no dia: se houver sobreposição, vale a primeira cadastrada.
  const absences: Absence[] = [];
  for (const a of absencesOn(data, date)) {
    if (activeIds.has(a.asbId) && !absences.some((x) => x.asbId === a.asbId)) absences.push(a);
  }
  const absentIds = new Set(absences.map((a) => a.asbId));
  const extraShifts = extraShiftsOn(data, date).filter((e) => activeIds.has(e.asbId) && !absentIds.has(e.asbId));
  const dentistAbsences = dentistAbsencesOn(data, date);
  const offIds = new Set(dentistAbsences.map((a) => a.dentistId));
  const scheduled = data.dentists.filter((d) => dentistWorksOn(d, weekday));
  const dentists = scheduled.filter((d) => !offIds.has(d.id));
  const dentistsOff = scheduled.filter((d) => offIds.has(d.id));
  const isExtra = (asbId: Id, hour: number) => inExtraShift(extraShifts, asbId, hour);

  // 1. O que cada ASB faria no dia: escala base com os ajustes do dia por cima.
  //    Vale também para quem está ausente (a substituta cobre o que foi combinado para o dia).
  const overrides = (data.dayOverrides ?? []).filter((o) => o.date === date && activeIds.has(o.asbId));
  const key = (asbId: Id, hour: number) => `${asbId}@${hour}`;
  const overriddenKeys = new Set(overrides.map((o) => key(o.asbId, o.hour)));
  const holdKeys = new Set(overrides.filter((o) => o.hold).map((o) => key(o.asbId, o.hour)));
  const placedKeys = new Set(overrides.filter((o) => o.kind !== 'livre').map((o) => key(o.asbId, o.hour)));
  const planned: Array<Slot & { origin: SlotOrigin }> = [];
  for (const s of data.base.slots) {
    if (!activeIds.has(s.asbId) || overriddenKeys.has(key(s.asbId, s.hour))) continue;
    planned.push({ ...s, origin: 'base' });
  }
  for (const o of overrides) {
    if (o.kind === 'livre') continue;
    const asb = asbById.get(o.asbId);
    if (!asb || !canAssignOn(asb, o.hour, absentIds.has(o.asbId) ? [] : extraShifts)) continue;
    planned.push({ asbId: o.asbId, hour: o.hour, kind: o.kind, roomId: o.roomId, origin: 'override' });
  }
  let slots: EffectiveSlot[] = planned
    .filter((s) => !absentIds.has(s.asbId))
    .map((s) => ({ hour: s.hour, kind: s.kind, roomId: s.roomId, who: { type: 'asb', asbId: s.asbId }, origin: s.origin }));

  const uncovered: UncoveredSlot[] = [];

  // Sala só precisa de ASB quando tem dentista atendendo naquela hora.
  const roomActive = (roomId: Id | undefined, hour: number) => !!roomId && dentistsAt(dentists, roomId, hour).length > 0;
  const needsCoverNow = (s: Pick<Slot, 'kind' | 'roomId' | 'hour'>) => needsCover(s.kind) && (s.kind !== 'sala' || roomActive(s.roomId, s.hour));
  // Livre para cobrir: sem atribuição, apoio/recepção, ou parada numa sala sem dentista atendendo.
  const isFreeSlot = (e: EffectiveSlot) => isFreeKind(e.kind) || (e.kind === 'sala' && !roomActive(e.roomId, e.hour));

  // 2. Substituições, na ordem das ausências.
  for (const absence of absences) {
    const absentSlots: Slot[] = planned.filter((s) => s.asbId === absence.asbId).map(({ origin: _o, ...s }) => s);
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
        if (needsCoverNow(s)) uncovered.push({ slot: s, absenceId: absence.id, reason: 'sem-substituta' });
      }
      continue;
    }
    const subId = absence.substitute.asbId;
    const sub = asbById.get(subId);
    for (const s of absentSlots) {
      if (!needsCoverNow(s)) continue; // almoço, apoio ou sala sem dentista: nada a cobrir
      if (!sub || !sub.active) {
        uncovered.push({ slot: s, absenceId: absence.id, reason: 'substituta-inativa', substituteId: subId });
        continue;
      }
      if (absentIds.has(subId)) {
        uncovered.push({ slot: s, absenceId: absence.id, reason: 'substituta-ausente', substituteId: subId });
        continue;
      }
      if (!canAssignOn(sub, s.hour, extraShifts)) {
        uncovered.push({ slot: s, absenceId: absence.id, reason: 'substituta-fora-do-contrato', substituteId: subId });
        continue;
      }
      if (holdKeys.has(key(subId, s.hour))) {
        uncovered.push({ slot: s, absenceId: absence.id, reason: 'substituta-retirada', substituteId: subId });
        continue;
      }
      const mine = slots.filter((e) => e.hour === s.hour && e.who.type === 'asb' && e.who.asbId === subId);
      const busy = mine.find((e) => !isFreeSlot(e));
      if (busy) {
        uncovered.push({ slot: s, absenceId: absence.id, reason: 'substituta-ocupada', busyWith: busy.kind, substituteId: subId });
        continue;
      }
      slots = slots.filter((e) => !(e.hour === s.hour && e.who.type === 'asb' && e.who.asbId === subId));
      slots.push({
        hour: s.hour,
        kind: s.kind,
        roomId: s.roomId,
        who: { type: 'asb', asbId: subId },
        origin: 'substitute',
        coveringFor: absence.asbId,
        movedFrom: mine.find((e) => e.kind === 'sala')?.roomId,
      });
    }
  }

  // 3. Remanejamento automático. Recebe quem está livre: a ASB de um dentista de folga
  //    (prioridade 1), alguém de hora extra sem atribuição (2) e, só para cobrir quem
  //    faltou, quem está no apoio geral (3). Quem foi ajustado à mão naquele horário
  //    não é mexido. Entre iguais, prefere quem já estava ali na hora anterior.
  const presentAsbs = data.asbs.filter((a) => a.active && !absentIds.has(a.id)).sort((a, b) => a.name.localeCompare(b.name));
  const roomsInOrder = [...data.rooms].sort((a, b) => a.order - b.order);
  type Target = { kind: Slot['kind']; roomId?: Id };
  type Candidate = { asb: Asb; priority: number; from?: Id; fromKind?: Slot['kind']; stays: boolean };
  const pickFree = (hour: number, allowApoio: boolean, same: (e: EffectiveSlot) => boolean): Candidate | undefined => {
    let best: Candidate | undefined;
    for (const asb of presentAsbs) {
      if (!canAssignOn(asb, hour, extraShifts)) continue;
      if (holdKeys.has(key(asb.id, hour)) || placedKeys.has(key(asb.id, hour))) continue;
      const mine = slots.filter((e) => e.hour === hour && e.who.type === 'asb' && e.who.asbId === asb.id);
      let priority: number | undefined;
      let from: Id | undefined;
      let fromKind: Slot['kind'] | undefined;
      if (mine.length === 0 && isExtra(asb.id, hour)) priority = 2;
      else if (
        mine.length > 0 &&
        mine.every((e) => e.kind === 'sala' && e.roomId && !roomActive(e.roomId, hour) && dentistsAt(dentistsOff, e.roomId, hour).length > 0)
      ) {
        priority = 1;
        from = mine[0].roomId;
      } else if (allowApoio && mine.length > 0 && mine.every((e) => (e.kind === 'apoio' && !e.roomId) || e.kind === 'recepcao')) {
        priority = 3;
        fromKind = mine[0].kind;
      }
      if (priority === undefined) continue;
      const stays = slots.some((e) => e.hour === hour - 1 && e.origin === 'auto' && e.who.type === 'asb' && e.who.asbId === asb.id && same(e));
      if (!best || priority < best.priority || (priority === best.priority && stays && !best.stays)) best = { asb, priority, from, fromKind, stays };
    }
    return best;
  };
  const place = (hour: number, best: Candidate, slot: Target & { coveringFor?: Id }) => {
    slots = slots.filter((e) => !(e.hour === hour && e.who.type === 'asb' && e.who.asbId === best.asb.id));
    slots.push({ hour, ...slot, who: { type: 'asb', asbId: best.asb.id }, origin: 'auto', movedFrom: best.from, movedFromKind: best.fromKind });
  };
  for (const hour of HOURS) {
    // Continuidade: primeiro as salas que já receberam alguém do app na hora anterior.
    const hadAuto = (roomId: Id) => slots.some((e) => e.hour === hour - 1 && e.origin === 'auto' && e.kind === 'sala' && e.roomId === roomId);
    const roomsThisHour = [...roomsInOrder].sort((a, b) => Number(hadAuto(b.id)) - Number(hadAuto(a.id)));
    for (const room of roomsThisHour) {
      if (!roomActive(room.id, hour)) continue;
      if (slots.some((e) => e.kind === 'sala' && e.roomId === room.id && e.hour === hour)) continue;
      const gap = uncovered.find((u) => u.slot.kind === 'sala' && u.slot.roomId === room.id && u.slot.hour === hour);
      const best = pickFree(hour, !!gap, (e) => e.kind === 'sala' && e.roomId === room.id);
      if (!best) continue;
      place(hour, best, { kind: 'sala', roomId: room.id, coveringFor: gap?.slot.asbId });
    }
    // CME e almoxarifado de quem faltou também recebem quem está livre.
    for (const u of uncovered) {
      if (u.slot.hour !== hour || (u.slot.kind !== 'cme' && u.slot.kind !== 'almox')) continue;
      if (slots.some((e) => e.hour === hour && e.kind === u.slot.kind && (e.coveringFor === u.slot.asbId || e.origin === 'override'))) continue;
      const best = pickFree(hour, true, (e) => e.kind === u.slot.kind);
      if (!best) continue;
      place(hour, best, { kind: u.slot.kind, coveringFor: u.slot.asbId });
    }
  }

  // "Hora extra" só nos blocos fora do contrato.
  for (const e of slots) {
    if (e.who.type !== 'asb') continue;
    const asb = asbById.get(e.who.asbId);
    if (asb && isExtra(asb.id, e.hour) && !canAssign(asb, e.hour)) e.extra = true;
  }
  slots.sort((a, b) => a.hour - b.hour);

  if (!open) {
    // CEO fechado: ninguém escalado. Os ajustes continuam listados para poderem ser limpos.
    return {
      date, weekday, open, closedNote, slots: [], absences, uncovered: [], presentAsbIds: [], dentists: [], dentistsOff: [],
      dentistAbsences, extraShifts: [], overrides,
    };
  }

  return {
    date,
    weekday,
    open,
    closedNote,
    slots,
    absences,
    uncovered,
    presentAsbIds: presentAsbs.map((a) => a.id),
    dentists,
    dentistsOff,
    dentistAbsences,
    extraShifts,
    overrides,
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
    dentistsOff: [],
    dentistAbsences: [],
    extraShifts: [],
    overrides: [],
  };
}

function personName(data: AppData, p: Person): string {
  if (p.type === 'external') return `${p.name} (externa)`;
  return data.asbs.find((a) => a.id === p.asbId)?.name ?? p.asbId;
}

/** Validações da seção 5.2 sobre um dia (efetivo ou base), mais os avisos dos ajustes do dia. */
export function analyze(current: AppData, day: EffectiveDay): Alert[] {
  const data = dataForDate(current, day.date);
  const alerts: Alert[] = [];
  if (!day.open) return alerts;
  const roomName = (id: Id) => data.rooms.find((r) => r.id === id)?.name ?? id;
  const asbById = new Map(data.asbs.map((a) => [a.id, a]));

  // Dentistas de folga e remanejamentos (informativo).
  for (const d of day.dentistsOff) {
    const abs = day.dentistAbsences.find((a) => a.dentistId === d.id);
    alerts.push({
      level: 'info',
      code: 'dentista-de-folga',
      message: `${d.name} de folga${abs ? ` (${abs.reason})` : ''}: ${roomName(d.roomId)} fica sem atendimento das ${formatHour(d.start)} às ${formatHour(d.end)}.`,
      roomId: d.roomId,
    });
  }
  const autos = day.slots.filter((s) => s.origin === 'auto' && s.who.type === 'asb');
  const autoGroups = new Map<string, { asbId: Id; kind: Slot['kind']; roomId?: Id; from?: Id; fromKind?: Slot['kind']; covering?: Id; hours: number[] }>();
  for (const s of autos) {
    if (s.who.type !== 'asb') continue;
    const k = `${s.who.asbId}|${s.kind}|${s.roomId}|${s.movedFrom ?? ''}|${s.movedFromKind ?? ''}|${s.coveringFor ?? ''}`;
    const g = autoGroups.get(k) ?? { asbId: s.who.asbId, kind: s.kind, roomId: s.roomId, from: s.movedFrom, fromKind: s.movedFromKind, covering: s.coveringFor, hours: [] };
    g.hours.push(s.hour);
    autoGroups.set(k, g);
  }
  for (const g of autoGroups.values()) {
    const name = asbById.get(g.asbId)?.name ?? g.asbId;
    const where = g.kind === 'sala' ? `na ${roomName(g.roomId ?? '')}` : `no ${SLOT_KIND_LABEL[g.kind]}`;
    const covering = g.covering ? `, cobrindo ${asbById.get(g.covering)?.name ?? '?'}` : '';
    for (const [a, b] of groupHours(g.hours)) {
      alerts.push({
        level: 'info',
        code: 'remanejada',
        message: g.from
          ? `${name} remanejada da ${roomName(g.from)} para ${g.kind === 'sala' ? 'a ' + roomName(g.roomId ?? '') : 'o ' + SLOT_KIND_LABEL[g.kind]} (${formatRange(a, b)})${covering}.`
          : g.fromKind
            ? `${name} saiu do ${SLOT_KIND_LABEL[g.fromKind]} para ${g.kind === 'sala' ? 'a ' + roomName(g.roomId ?? '') : 'o ' + SLOT_KIND_LABEL[g.kind]} (${formatRange(a, b)})${covering}.`
            : `${name} (hora extra) colocada ${where} (${formatRange(a, b)})${covering}.`,
        hour: a,
        roomId: g.roomId,
        asbId: g.asbId,
      });
    }
  }

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

  // ASB em sala sem dentista (aviso). Sala de dentista de folga não conta: a ASB só ficou onde estava.
  for (const s of day.slots) {
    if (s.kind !== 'sala' || !s.roomId) continue;
    if (dentistsAt(day.dentists, s.roomId, s.hour).length > 0) continue;
    if (dentistsAt(day.dentistsOff, s.roomId, s.hour).length > 0) continue;
    alerts.push({
      level: 'aviso',
      code: 'sala-sem-dentista',
      message: `${personName(data, s.who)} na ${roomName(s.roomId)} às ${formatHour(s.hour)}, sem dentista atendendo.`,
      hour: s.hour,
      roomId: s.roomId,
      asbId: s.who.type === 'asb' ? s.who.asbId : undefined,
    });
  }

  // Por ASB presente: almoço obrigatório, blocos do contrato e da hora extra sem atribuição, duas salas ao mesmo tempo.
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
    // Um aviso por bloco, mesmo com registros de hora extra sobrepostos.
    const extraHours = new Set(day.extraShifts.filter((x) => x.asbId === asbId).flatMap((e) => hoursBetween(e.start, e.end)));
    for (const hour of [...extraHours].sort((x, y) => x - y)) {
      if (!HOURS.includes(hour) || canAssign(asb, hour)) continue;
      if (!mine.some((s) => s.hour === hour)) {
        alerts.push({
          level: 'aviso',
          code: 'hora-extra-sem-atribuicao',
          message: `${asb.name} tem hora extra às ${formatHour(hour)} e nenhuma atribuição nesse bloco.`,
          hour,
          asbId,
        });
      }
    }
    for (const hour of HOURS) {
      // Sala ou apoio de sala: estar em duas salas diferentes no mesmo horário é dividir-se.
      const rooms = [...new Set(mine.filter((s) => s.hour === hour && s.roomId && (s.kind === 'sala' || s.kind === 'apoio')).map((s) => s.roomId as Id))];
      if (rooms.length > 1) {
        alerts.push({
          level: 'aviso',
          code: 'asb-duas-salas',
          message: `${asb.name} cobre ${rooms.map(roomName).join(' e ')} ao mesmo tempo às ${formatHour(hour)}.`,
          hour,
          asbId,
          roomIds: rooms,
        });
      }
    }
  }

  // Ausências: sem substituta ou substituta com choque.
  for (const u of day.uncovered) {
    const absent = asbById.get(u.slot.asbId)?.name ?? u.slot.asbId;
    const where = u.slot.kind === 'sala' && u.slot.roomId ? roomName(u.slot.roomId) : SLOT_KIND_LABEL[u.slot.kind];
    // Se alguém já cobriu (remanejamento automático ou ajuste do dia), não é mais um problema.
    if (u.slot.kind === 'sala' && day.slots.some((s) => s.kind === 'sala' && s.roomId === u.slot.roomId && s.hour === u.slot.hour)) continue;
    if (u.slot.kind !== 'sala' && day.slots.some((s) => s.hour === u.slot.hour && s.kind === u.slot.kind && s.coveringFor === u.slot.asbId)) continue;
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

/** "1 mês" contado em dias corridos, para 30/09 e 01/10 não valerem como um mês. */
export const PROTESE_MIN_DAYS = 30;

export function proteseMonthElapsed(since: IsoDate, today: IsoDate): boolean {
  return diffDays(since, today) >= PROTESE_MIN_DAYS;
}

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
    if (proteseMonthElapsed(rec.since, today)) continue;
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
 * mês não fecha, para o aviso continuar aparecendo. Deve rodar uma vez por
 * carregamento (não a cada mudança), senão um estado intermediário do quadro
 * vira o registro.
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
    if (!rec || (rec.asbId !== current && proteseMonthElapsed(rec.since, today))) {
      out.push({ dentistId: dentist.id, asbId: current, since: today });
    } else {
      out.push(rec);
    }
  }
  return out;
}
