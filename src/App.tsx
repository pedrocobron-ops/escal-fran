import { useEffect, type ReactNode } from 'react';
import './styles.css';
import { LocalStorageAdapter } from './store/storage';
import { useStore } from './store/useStore';
import { ConfirmProvider } from './ui/common/Modal';
import { ROUTES, href, useHashRoute, type Route } from './ui/router';
import { Board } from './ui/board/Board';

const SCREENS: Record<Route, () => ReactNode> = {
  quadro: () => <Board />,
  tarefas: () => <Placeholder name="Tarefas e rodízios" />,
  ausencias: () => <Placeholder name="Ausências" />,
  equipe: () => <Placeholder name="Equipe e salas" />,
  mes: () => <Placeholder name="Visão do mês" />,
  ajustes: () => <Placeholder name="Ajustes" />,
};

function Placeholder({ name }: { name: string }) {
  return <p className="muted">{name}: em construção.</p>;
}

export function App() {
  const loaded = useStore((s) => s.loaded);
  const init = useStore((s) => s.init);
  const route = useHashRoute();

  useEffect(() => {
    void init(new LocalStorageAdapter());
  }, [init]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); useStore.getState().undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); useStore.getState().redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <ConfirmProvider>
      <header className="app-header">
        <span className="brand">Escala CEO</span>
        <nav className="app-nav">
          {ROUTES.map((r) => (
            <a key={r.id} href={href(r.id)} className={r.id === route ? 'active' : undefined}>{r.label}</a>
          ))}
        </nav>
        <SaveIndicator />
      </header>
      <main className="app-main">{loaded ? SCREENS[route]() : <p className="muted">Carregando...</p>}</main>
    </ConfirmProvider>
  );
}

function SaveIndicator() {
  const savedAt = useStore((s) => s.savedAt);
  const saving = useStore((s) => s.saving);
  const error = useStore((s) => s.saveError);
  if (error) return <span className="save-indicator error">Erro ao salvar: {error}</span>;
  if (saving) return <span className="save-indicator">Salvando...</span>;
  if (savedAt) return <span className="save-indicator">Salvo às {savedAt}</span>;
  return <span className="save-indicator">Salvamento automático ativo</span>;
}
