import { useEffect, useState, type ReactNode } from 'react';
import './styles.css';
import { browserAdapter } from './store/storage';
import { useStore } from './store/useStore';
import { ConfirmProvider } from './ui/common/Modal';
import { ErrorBoundary } from './ui/common/ErrorBoundary';
import { RecoveryScreen } from './ui/common/RecoveryScreen';
import { UndoRedo } from './ui/common/UndoRedo';
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
  const recovering = useStore((s) => s.recovery !== null);
  const init = useStore((s) => s.init);
  const route = useHashRoute();

  useEffect(() => {
    const { adapter, blocked } = browserAdapter();
    void init(adapter, { blocked });
  }, [init]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Em campos de texto o Ctrl+Z é o do próprio campo; em caixas de marcar e listas, é o do app.
      const typing = target && (target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes((target as HTMLInputElement).type)));
      if (typing) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); useStore.getState().undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); useStore.getState().redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Ao fechar, trocar de aba ou bloquear o celular, grava na hora o que estiver pendente.
  useEffect(() => {
    const flush = () => useStore.getState().flush();
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
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
        {loaded && !recovering && <UndoRedo />}
      </header>
      {loaded && !recovering && <Notices />}
      {loaded && !recovering && <BackupReminder />}
      <ErrorBoundary>
        {recovering ? <RecoveryScreen /> : <main className="app-main">{loaded ? SCREENS[route]() : <p className="muted">Carregando...</p>}</main>}
      </ErrorBoundary>
    </ConfirmProvider>
  );
}

function SaveIndicator() {
  const savedAt = useStore((s) => s.savedAt);
  const saving = useStore((s) => s.saving);
  const error = useStore((s) => s.saveError);
  const blocked = useStore((s) => s.storageBlocked);
  if (blocked) return <span className="save-indicator error">Não está salvando: armazenamento bloqueado</span>;
  if (error) return <span className="save-indicator error">Erro ao salvar: {error}</span>;
  if (saving) return <span className="save-indicator">Salvando...</span>;
  if (savedAt) return <span className="save-indicator">Salvo às {savedAt}</span>;
  return <span className="save-indicator">Salvamento automático ativo</span>;
}

/** Avisos de primeira abertura, armazenamento bloqueado e mudança vinda de outra aba. */
function Notices() {
  const firstUse = useStore((s) => s.firstUse);
  const blocked = useStore((s) => s.storageBlocked);
  const external = useStore((s) => s.externalUpdateAt);
  const lostLocal = useStore((s) => s.externalLostLocal);
  const dismiss = useStore((s) => s.dismissNotice);
  return (
    <>
      {blocked && (
        <div className="backup-bar bad" role="alert">
          <span>
            O navegador está bloqueando o armazenamento deste site: o que for feito aqui some ao fechar a página.
            Libere os dados do site nas configurações do navegador (ou saia da janela anônima) e, antes de fechar, exporte um backup em Ajustes.
          </span>
        </div>
      )}
      {firstUse && !blocked && (
        <div className="backup-bar" role="status">
          <span>
            Nenhuma escala salva neste navegador: o app começou pela escala inicial dos documentos.
            Se você já usava o app em outro aparelho ou navegador, importe o backup em Ajustes.
          </span>
          <span className="spacer" />
          <a className="btn sm" href={href('ajustes')}>Importar backup</a>
          <button className="btn sm icon" onClick={() => dismiss('firstUse')} aria-label="Fechar aviso">×</button>
        </div>
      )}
      {external && (
        <div className="backup-bar" role="status">
          <span>
            Às {external}, a escala foi alterada em outra aba ou janela. Esta tela já mostra a versão nova.
            {lostLocal && ' A mudança que você fez aqui no mesmo instante não entrou: confira e refaça se precisar.'}
          </span>
          <span className="spacer" />
          <button className="btn sm icon" onClick={() => dismiss('externalUpdateAt')} aria-label="Fechar aviso">×</button>
        </div>
      )}
    </>
  );
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
        Os dados ficam só neste aparelho, neste navegador.
      </span>
      <span className="spacer" />
      <a className="btn sm" href={href('ajustes')}>Exportar agora</a>
      <button className="btn sm icon" onClick={() => setDismissed(true)} aria-label="Fechar lembrete">×</button>
    </div>
  );
}
