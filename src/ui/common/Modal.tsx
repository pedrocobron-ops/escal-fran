import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

export function Modal({ title, onClose, children, wide }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false));

/** Provedor do modal de confirmação. Substitui o confirm() nativo. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ opts: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);
  const confirm = useCallback<ConfirmFn>((opts) => new Promise((resolve) => setState({ opts, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <Modal title={state.opts.title} onClose={() => close(false)}>
          <div>{state.opts.message}</div>
          <div className="modal-actions">
            <button className="btn" onClick={() => close(false)}>{state.opts.cancelLabel ?? 'Cancelar'}</button>
            <button className={`btn ${state.opts.danger ? 'danger' : 'primary'}`} onClick={() => close(true)} autoFocus>
              {state.opts.confirmLabel ?? 'Confirmar'}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

/** Aviso simples com botão OK. Substitui o alert() nativo. */
export function Notice({ title, message, onClose }: { title: string; message: ReactNode; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div>{message}</div>
      <div className="modal-actions">
        <button className="btn primary" onClick={onClose} autoFocus>OK</button>
      </div>
    </Modal>
  );
}
