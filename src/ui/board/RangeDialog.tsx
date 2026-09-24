import type { Asb } from '../../domain';
import { HOURS, formatHour } from '../../domain';
import { Modal } from '../common/Modal';
import type { Column } from './model';

interface Props {
  asb: Asb;
  column: Column;
  fromHour: number;
  onPick: (endHour: number) => void;
  onClose: () => void;
}

/** Mini-popover "até que horas?" para preencher vários blocos de uma vez. */
export function RangeDialog({ asb, column, fromHour, onPick, onClose }: Props) {
  const last = Math.min(asb.end, HOURS[HOURS.length - 1] + 1);
  const options: number[] = [];
  for (let h = fromHour + 1; h <= last; h++) options.push(h);
  return (
    <Modal title="Preencher até que horas?" onClose={onClose}>
      <p>
        <strong>{asb.name}</strong> em <strong>{column.label}</strong> a partir das {formatHour(fromHour)}. Contrato até {formatHour(asb.end)}.
      </p>
      <div className="hour-picks">
        {options.map((h) => (
          <button key={h} className={`btn${h === fromHour + 1 ? '' : ''}`} onClick={() => onPick(h)} autoFocus={h === last}>
            até {formatHour(h)}
          </button>
        ))}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}
