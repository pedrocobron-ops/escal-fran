import { useEffect, useState, type ReactNode } from 'react';
import './styles.css';
import { browserAdapter } from './store/storage';
import { SupabaseRemote, SyncedAdapter, readSyncConfig } from './store/sync';
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
    const { adapter: local, blocked } = browserAdapter();
    const cfg = blocked ? null : readSyncConfig();
    const adapter = cfg ? new SyncedAdapter(local, new SupabaseRemote(cfg), window.localStorage, (s) => useStore.getState().setSyncStatus(s)) : local;
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
        <SyncIndicator />
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

/** Estado da nuvem, quando a sincronização está ligada. */
function SyncIndicator() {
  const st = useStore((s) => s.syncStatus);
  if (st.state === 'off') return null;
  const cls = st.state === 'offline' || st.state === 'error' || st.state === 'conflict' ? 'save-indicator error' : 'save-indicator';
  const text =
    st.state === 'ok' ? `Nuvem OK ${st.at}`
    : st.state === 'syncing' ? 'Nuvem: sincronizando...'
    : st.state === 'offline' ? 'Nuvem: sem conexão (salvo aqui)'
    : st.state === 'conflict' ? 'Nuvem: decida qual versão vale'
    : 'Nuvem: problema (veja Ajustes)';
  return <span className={cls} title={st.state === 'offline' || st.state === 'error' ? st.error : 'Sincronização entre aparelhos ligada'}>{text}</span>;
}

/** Avisos de primeira abertura, armazenamento bloqueado e mudança vinda de outra aba. */
function Notices() {
  const firstUse = useStore((s) => s.firstUse);
  const blocked = useStore((s) => s.storageBlocked);
  const external = useStore((s) => s.externalUpdateAt);
  const lostLocal = useStore((s) => s.externalLostLocal);
  const dismiss = useStore((s) => s.dismissNotice);
  const sync = useStore((s) => s.syncStatus);
  const resolve = useStore((s) => s.resolveSyncConflict);
  return (
    <>
      {sync.state === 'conflict' && (
        <div className="backup-bar bad" role="alert">
          <span>
            A nuvem tem uma versão mais nova desta escala (gravada em outro aparelho) e este aparelho tem mudanças que ainda não foram enviadas.
            Escolha qual vale; a outra fica guardada como cópia de segurança em Ajustes.
          </span>
          <span className="spacer" />
          <button className="btn sm primary" onClick={() => void resolve('cloud')}>Usar a da nuvem</button>
          <button className="btn sm" onClick={() => void resolve('mine')}>Manter a deste aparelho</button>
        </div>
      )}
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
            Se você já usava o app em outro aparelho, entre com o código da escala em Ajustes (Sincronizar entre aparelhos) ou importe o backup.
          </span>
          <span className="spacer" />
          <a className="btn sm" href={href('ajustes')}>Importar backup</a>
          <button className="btn sm icon" onClick={() => dismiss('firstUse')} aria-label="Fechar aviso">×</button>
        </div>
      )}
      {external && (
        <div className="backup-bar" role="status">
          <span>
            Às {external}, a escala foi alterada em outra aba, janela ou aparelho. Esta tela já mostra a versão nova.
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
  const synced = useStore((s) => s.syncStatus.state === 'ok');
  const [dismissed, setDismissed] = useState(false);
  // Com a nuvem ligada e funcionando, a escala já está guardada fora deste aparelho.
  if (dismissed || synced) return null;
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
