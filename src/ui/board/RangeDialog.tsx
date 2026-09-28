import type { Asb } from '../../domain';
import { formatHour } from '../../domain';
import { Modal } from '../common/Modal';
import type { Column } from './model';

interface Props {
  asb: Asb;
  column: Column;
  fromHour: number;
  /** Horas em que a ASB pode ter slot nesse dia (contrato ou hora extra). */
  allowed: number[];
  onPick: (endHour: number) => void;
  onClose: () => void;
}

/** Mini-popover "até que horas?" para preencher vários blocos de uma vez. */
export function RangeDialog({ asb, column, fromHour, allowed, onPick, onClose }: Props) {
  // Só a faixa contínua a partir da hora inicial.
  let last = fromHour + 1;
  while (allowed.includes(last)) last++;
  const options: number[] = [];
  for (let h = fromHour + 1; h <= last; h++) options.push(h);
  return (
    <Modal title="Preencher até que horas?" onClose={onClose}>
      <p>
        <strong>{asb.name}</strong> em <strong>{column.label}</strong> a partir das {formatHour(fromHour)}. Pode ir até {formatHour(last)}.
      </p>
      <div className="hour-picks">
        {options.map((h) => (
          <button key={h} className="btn" onClick={() => onPick(h)} autoFocus={h === last}>
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

interface ConflictProps {
  asbName: string;
  hourLabel: string;
  currentRooms: string[];
  targetRoom: string;
  onMove: () => void;
  onBoth: () => void;
  onClose: () => void;
}

/** A ASB já está em outra sala nesse bloco: mover ou cobrir as duas? */
export function ConflictDialog({ asbName, hourLabel, currentRooms, targetRoom, onMove, onBoth, onClose }: ConflictProps) {
  return (
    <Modal title={`${asbName} já está em outra sala`} onClose={onClose}>
      <p>
        Às {hourLabel}, <strong>{asbName}</strong> está na {currentRooms.join(' e ')}. O que fazer com a {targetRoom}?
      </p>
      <p className="muted small">Cobrir as duas deixa a ficha nas duas salas e gera um aviso, para você saber que ela está dividida.</p>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn" onClick={onBoth}>Cobrir as duas</button>
        <button className="btn primary" onClick={onMove} autoFocus>Mover para a {targetRoom}</button>
      </div>
    </Modal>
  );
}
