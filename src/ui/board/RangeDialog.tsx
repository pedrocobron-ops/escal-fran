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

export interface Choice {
  label: string;
  hint?: string;
  primary?: boolean;
  onChoose: () => void;
}

/** Pergunta com várias saídas (ASB já em outra sala, sala já ocupada). */
export function ChoiceDialog({ title, message, choices, onClose }: { title: string; message: string; choices: Choice[]; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <p>{message}</p>
      <div className="suggest">
        {choices.map((c, i) => (
          <button key={i} type="button" className={`btn${c.primary ? ' primary' : ''}`} onClick={c.onChoose} autoFocus={c.primary}>
            <span>
              <strong>{c.label}</strong>
              {c.hint ? <span className="small" style={{ display: 'block', opacity: 0.85 }}>{c.hint}</span> : null}
            </span>
          </button>
        ))}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}
