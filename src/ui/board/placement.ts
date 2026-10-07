// Regras de colocar uma ficha no quadro, sem React, para poder testar.
import type { AppData, IsoDate, SlotKind } from '../../domain';
import { baseEntriesAt, removeSlotAt, setBaseAt, setDaySlots, type CellTarget } from '../../store/useStore';

/** Ficha que está sendo movida (de onde ela saiu). */
export interface Origin {
  hour: number;
  kind: SlotKind;
  roomId?: string;
}

/**
 * Como a colocação mexe no resto da hora:
 * - add: só acrescenta o destino; tudo o que a ASB fazia nessa hora continua (ficha da lista
 *   para uma sala, ou ficha do quadro para uma sala que já tem ASB).
 * - move: a ficha arrastada sai de onde estava (em cada hora) e entra no destino; o resto fica.
 * - replace: a ASB sai de tudo o que fazia nessa hora e fica só no destino (colunas de apoio,
 *   CME, almoxarifado e almoço).
 */
export type PlaceMode = 'add' | 'move' | 'replace';

export interface Placement {
  asbId: string;
  hours: number[];
  target: CellTarget;
  mode: PlaceMode;
  orig?: Origin;
}

export const sameTarget = (a: CellTarget, b: CellTarget) => a.kind === b.kind && (a.roomId ?? '') === (b.roomId ?? '');
export const isRoomEntry = (x: CellTarget) => !!x.roomId && (x.kind === 'sala' || x.kind === 'apoio');

/**
 * Como a ASB entra numa sala (pedido do cliente: nunca pergunta, sempre cabem duas por célula):
 * ASB da sala quando a sala está livre e ela não está em outra sala nessa hora; senão apoio.
 */
export function roomDropKind(roomHasAsb: boolean, inAnotherRoom: boolean): 'sala' | 'apoio' {
  return roomHasAsb || inAnotherRoom ? 'apoio' : 'sala';
}

/** O que a ASB mantém na hora `h`, além do destino (na mesma sala só cabe uma entrada dela). */
export function keptAt(p: Placement, h: number, current: CellTarget[]): CellTarget[] {
  void h;
  const sameRoom = (e: CellTarget) => isRoomEntry(p.target) && isRoomEntry(e) && e.roomId === p.target.roomId;
  const rest = current.filter((e) => !sameTarget(e, p.target) && !sameRoom(e));
  if (p.mode === 'replace') return [];
  if (p.mode === 'move' && p.orig) {
    const o: CellTarget = { kind: p.orig.kind, roomId: p.orig.roomId };
    return rest.filter((e) => !sameTarget(e, o));
  }
  return rest;
}

function leavesOrigin(p: Placement): p is Placement & { orig: Origin } {
  return p.mode !== 'add' && !!p.orig && !p.hours.includes(p.orig.hour);
}

/** Aplica na escala base. */
export function placeInBase(d: AppData, p: Placement): void {
  const { asbId, hours, target } = p;
  if (leavesOrigin(p)) removeSlotAt(d, asbId, p.orig.hour, p.orig.kind, p.orig.roomId);
  for (const h of hours) setBaseAt(d, asbId, h, [...keptAt(p, h, baseEntriesAt(d, asbId, h)), target]);
}

/**
 * Aplica como ajuste de uma data. `entriesAt` diz onde a ASB está em cada hora no dia
 * efetivo (antes da mudança); `hold` marca que o app não deve remanejá-la ali.
 */
export function placeInDay(d: AppData, date: IsoDate, p: Placement, entriesAt: (hour: number) => CellTarget[], hold: boolean): void {
  const { asbId, hours, target } = p;
  if (leavesOrigin(p)) {
    const origT: CellTarget = { kind: p.orig.kind, roomId: p.orig.roomId };
    setDaySlots(d, date, asbId, [p.orig.hour], entriesAt(p.orig.hour).filter((e) => !sameTarget(e, origT)), { hold });
  }
  for (const h of hours) setDaySlots(d, date, asbId, [h], [...keptAt(p, h, entriesAt(h)), target], { hold });
}
