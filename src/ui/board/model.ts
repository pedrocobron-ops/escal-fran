import type { AppData, EffectiveSlot, Id, SlotKind } from '../../domain';

export interface Column {
  key: string;
  label: string;
  kind: SlotKind;
  roomId?: Id;
  color?: string;
}

export const SUPPORT_COLUMNS: Column[] = [
  { key: 'kind:apoio', label: 'Apoio / Recepção', kind: 'apoio' },
  { key: 'kind:cme', label: 'CME / Arsenal', kind: 'cme' },
  { key: 'kind:almox', label: 'Almoxarifado', kind: 'almox' },
  { key: 'kind:almoco', label: 'Almoço', kind: 'almoco' },
];

export function columnsFor(data: AppData): Column[] {
  const rooms = [...data.rooms].sort((a, b) => a.order - b.order);
  return [
    ...rooms.map((r) => ({ key: `sala:${r.id}`, label: r.name, kind: 'sala' as const, roomId: r.id, color: r.color })),
    ...SUPPORT_COLUMNS,
  ];
}

export function columnKeyOf(slot: Pick<EffectiveSlot, 'kind' | 'roomId'>): string {
  if (slot.kind === 'sala') return `sala:${slot.roomId ?? ''}`;
  if (slot.kind === 'recepcao') return 'kind:apoio';
  return `kind:${slot.kind}`;
}

export function cellKey(columnKey: string, hour: number): string {
  return `${columnKey}@${hour}`;
}
