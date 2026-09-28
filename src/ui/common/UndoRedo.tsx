import { useStore } from '../../store/useStore';

/** Desfazer e refazer, no topo de todas as telas (no celular não há Ctrl+Z). */
export function UndoRedo() {
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  return (
    <span className="undo-redo">
      <button className="btn sm" onClick={undo} disabled={past === 0} title="Desfazer (Ctrl+Z)">Desfazer</button>
      <button className="btn sm" onClick={redo} disabled={future === 0} title="Refazer (Ctrl+Shift+Z)">Refazer</button>
    </span>
  );
}
