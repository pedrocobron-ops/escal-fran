import { useDraggable } from '@dnd-kit/core';
import type { Id, SlotKind, SlotOrigin } from '../../domain';

export type DragItem =
  | { type: 'palette'; asbId: Id }
  | { type: 'slot'; asbId: Id; hour: number; kind: SlotKind; roomId?: Id };

interface ChipProps {
  id: string;
  label: string;
  color: string;
  tag?: string;
  item?: DragItem;
  external?: boolean;
  origin?: SlotOrigin;
  disabled?: boolean;
  onRemove?: () => void;
  title?: string;
}

/** Ficha de ASB. Arrastável quando recebe `item` e não está desabilitada. */
export function Chip({ id, label, color, tag, item, external, origin, disabled, onRemove, title }: ChipProps) {
  const draggable = useDraggable({ id, data: item, disabled: disabled || !item });
  // A ficha original fica parada (esmaecida) e quem acompanha o dedo é o DragOverlay.
  // Mover a original fazia a paleta do celular rolar e ficar em branco durante o arrasto.
  const style = { background: external ? undefined : color };
  // A ficha mostra só o nome (pedido do cliente): origem e motivo ficam na dica.
  void origin;
  const cls = [
    'chip',
    external ? 'external' : '',
    !item || disabled ? 'static' : '',
    draggable.isDragging ? 'dragging' : '',
  ].join(' ');
  return (
    <span ref={draggable.setNodeRef} className={cls} style={style} title={title} {...draggable.listeners} {...draggable.attributes}>
      <span>{label}</span>
      {tag && <span className="tag">{tag}</span>}
      {onRemove && !disabled && (
        <button
          type="button"
          className="x"
          aria-label={`Remover ${label}`}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}

/** Ficha usada no DragOverlay. */
export function ChipOverlay({ label, color }: { label: string; color: string }) {
  return (
    <span className="chip overlay" style={{ background: color }}>
      {label}
    </span>
  );
}
