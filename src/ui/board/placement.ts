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
  /** Continua nas outras salas dessas horas (apoio de uma sala enquanto é ASB de outra). */
  keepOthers: boolean;
  /** Ficha arrastada do quadro: sai de onde estava. */
  orig?: Origin;
}

export const sameTarget = (a: CellTarget, b: CellTarget) => a.kind === b.kind && (a.roomId ?? '') === (b.roomId ?? '');
export const isRoomEntry = (x: CellTarget) => !!x.roomId && (x.kind === 'sala' || x.kind === 'apoio');

/**
 * Como a ASB entra numa sala (pedido do cliente: nunca pergunta, sempre cabem duas por célula):
 * ASB da sala quando a sala está livre e ela não está em outra sala nessa hora;
 * senão entra de apoio e continua onde estava.
 */
export function roomDropPlan(roomHasAsb: boolean, inAnotherRoom: boolean): { kind: 'sala' | 'apoio'; keepOthers: boolean } {
  return roomHasAsb || inAnotherRoom ? { kind: 'apoio', keepOthers: true } : { kind: 'sala', keepOthers: false };
}

/**
 * O que a ASB mantém na hora `h`, além do destino. A ficha arrastada do quadro sai de onde
 * estava; sem `keepOthers`, ela sai de tudo o que fazia nessa hora (exceto, ao trocar a
 * própria ficha de lugar na mesma hora, os outros lugares dela, que ficam); com
 * `keepOthers`, continua nas outras salas.
 */
export function keptAt(p: Placement, h: number, current: CellTarget[]): CellTarget[] {
  const { target, orig } = p;
  const origT: CellTarget | undefined = orig && h === orig.hour ? { kind: orig.kind, roomId: orig.roomId } : undefined;
  const rest = current.filter((e) => !sameTarget(e, target) && !(origT && sameTarget(e, origT)));
  if (p.keepOthers) return rest.filter((e) => isRoomEntry(e) && e.roomId !== target.roomId);
  if (origT) return rest;
  return [];
}

/** Aplica na escala base. */
export function placeInBase(d: AppData, p: Placement): void {
  const { asbId, hours, target, orig } = p;
  if (orig && !hours.includes(orig.hour)) removeSlotAt(d, asbId, orig.hour, orig.kind, orig.roomId);
  for (const h of hours) setBaseAt(d, asbId, h, [...keptAt(p, h, baseEntriesAt(d, asbId, h)), target]);
}

/**
 * Aplica como ajuste de uma data. `entriesAt` diz onde a ASB está em cada hora no dia
 * efetivo (antes da mudança); `hold` marca que o app não deve remanejá-la ali.
 */
export function placeInDay(d: AppData, date: IsoDate, p: Placement, entriesAt: (hour: number) => CellTarget[], hold: boolean): void {
  const { asbId, hours, target, orig } = p;
  if (orig && !hours.includes(orig.hour)) {
    const origT: CellTarget = { kind: orig.kind, roomId: orig.roomId };
    setDaySlots(d, date, asbId, [orig.hour], entriesAt(orig.hour).filter((e) => !sameTarget(e, origT)), { hold });
  }
  for (const h of hours) setDaySlots(d, date, asbId, [h], [...keptAt(p, h, entriesAt(h)), target], { hold });
}
