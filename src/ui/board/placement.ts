// Regras de colocar uma ficha no quadro, sem React, para poder testar.
import type { AppData, IsoDate, SlotKind } from '../../domain';
import { baseEntriesAt, removeSlotAt, setBaseAt, setDaySlots, type CellTarget } from '../../store/useStore';

/** Ficha que está sendo movida (de onde ela saiu). */
export interface Origin {
  hour: number;
  kind: SlotKind;
  roomId?: string;
}

export interface Placement {
  asbId: string;
  hours: number[];
  target: CellTarget;
  /** Continua nas outras salas dessas horas (cobrir duas salas). */
  additive: boolean;
  orig?: Origin;
}

export const sameTarget = (a: CellTarget, b: CellTarget) => a.kind === b.kind && (a.roomId ?? '') === (b.roomId ?? '');
export const isRoomEntry = (x: CellTarget) => !!x.roomId && (x.kind === 'sala' || x.kind === 'apoio');

/**
 * O que a ASB mantém na hora `h`, além do destino. Sem `additive`, ela sai do que fazia;
 * com `additive`, continua nas outras salas. Numa ficha movida, na hora de onde ela saiu
 * só aquela ficha muda: os outros lugares da ASB nessa hora ficam como estavam.
 */
export function keptAt(p: Placement, h: number, current: CellTarget[]): CellTarget[] {
  const { target } = p;
  const orig = originOf(p);
  const origT: CellTarget | undefined = orig ? { kind: orig.kind, roomId: orig.roomId } : undefined;
  const rest = current.filter((e) => !sameTarget(e, target) && !(origT && orig && h === orig.hour && sameTarget(e, origT)));
  if (orig && h === orig.hour) return rest;
  if (!p.additive || !isRoomEntry(target)) return [];
  return rest.filter((e) => isRoomEntry(e) && e.roomId !== target.roomId);
}

/**
 * "Cobrir as duas" (additive) é copiar: a ficha arrastada continua onde estava.
 * Nos outros casos, a ficha arrastada sai do lugar de origem.
 */
function originOf(p: Placement): Origin | undefined {
  return p.additive ? undefined : p.orig;
}

/** Aplica na escala base. */
export function placeInBase(d: AppData, p: Placement): void {
  const { asbId, hours, target } = p;
  const orig = originOf(p);
  if (orig && !hours.includes(orig.hour)) removeSlotAt(d, asbId, orig.hour, orig.kind, orig.roomId);
  for (const h of hours) setBaseAt(d, asbId, h, [...keptAt(p, h, baseEntriesAt(d, asbId, h)), target]);
}

/**
 * Aplica como ajuste de uma data. `entriesAt` diz onde a ASB está em cada hora no dia
 * efetivo (antes da mudança); `hold` marca que o app não deve remanejá-la ali.
 */
export function placeInDay(d: AppData, date: IsoDate, p: Placement, entriesAt: (hour: number) => CellTarget[], hold: boolean): void {
  const { asbId, hours, target } = p;
  const orig = originOf(p);
  if (orig && !hours.includes(orig.hour)) {
    const origT: CellTarget = { kind: orig.kind, roomId: orig.roomId };
    setDaySlots(d, date, asbId, [orig.hour], entriesAt(orig.hour).filter((e) => !sameTarget(e, origT)), { hold });
  }
  for (const h of hours) setDaySlots(d, date, asbId, [h], [...keptAt(p, h, entriesAt(h)), target], { hold });
}
