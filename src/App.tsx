import { useEffect, useState, type ReactNode } from 'react';
import './styles.css';
import { LocalStorageAdapter } from './store/storage';
import { useStore } from './store/useStore';
import { ConfirmProvider } from './ui/common/Modal';
import { ErrorBoundary } from './ui/common/ErrorBoundary';
import { diffDays, todayIso } from './domain';
import { ROUTES, href, useHashRoute, type Route } from './ui/router';
import { Board } from './ui/board/Board';
import { TasksScreen } from './ui/tasks/TasksScreen';
import { AbsencesScreen } from './ui/absences/AbsencesScreen';
import { TeamScreen } from './ui/team/TeamScreen';
import { MonthScreen } from './ui/month/MonthScreen';
import { SettingsScreen } from './ui/settings/SettingsScreen';

const SCREENS: Record<Route, () => ReactNode> = {
  quadro: () => <Board />,
  tarefas: () => <TasksScreen />,
  ausencias: () => <AbsencesScreen />,
  equipe: () => <TeamScreen />,
  mes: () => <MonthScreen />,
  ajustes: () => <SettingsScreen />,
};

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
      {loaded && <BackupReminder />}
      <ErrorBoundary>
        <main className="app-main">{loaded ? SCREENS[route]() : <p className="muted">Carregando...</p>}</main>
      </ErrorBoundary>
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

const BACKUP_REMINDER_DAYS = 7;

/** Faixa discreta quando faz tempo que o backup não é exportado. Some ao fechar, até a próxima abertura. */
function BackupReminder() {
  const lastBackupAt = useStore((s) => s.lastBackupAt);
  const firstChangeAt = useStore((s) => s.firstChangeAt);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  // Conta a partir do último backup ou, se nunca houve, da primeira mudança feita aqui.
  const ref = lastBackupAt ?? firstChangeAt;
  if (!ref) return null;
  const days = diffDays(ref, todayIso());
  if (days < BACKUP_REMINDER_DAYS) return null;
  return (
    <div className="backup-bar" role="status">
      <span>
        {lastBackupAt ? `Faz ${days} dias que você não exporta um backup.` : `Você mexe na escala há ${days} dias e ainda não exportou um backup.`}{' '}
        Os dados ficam só neste computador.
      </span>
      <span className="spacer" />
      <a className="btn sm" href={href('ajustes')}>Exportar agora</a>
      <button className="btn sm icon" onClick={() => setDismissed(true)} aria-label="Fechar lembrete">×</button>
    </div>
  );
}
