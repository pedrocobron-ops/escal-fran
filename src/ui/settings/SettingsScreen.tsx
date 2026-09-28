import { useEffect, useRef, useState } from 'react';
import { WEEKDAY_LABEL, diffDays, formatDate, isValidIso, todayIso, weekdayOf } from '../../domain';
import { BackupError, backupFileName, exportBackup, parseBackup } from '../../store/storage';
import { useData, useStore } from '../../store/useStore';
import { Modal, Notice, useConfirm } from '../common/Modal';
import { downloadBlob } from '../common/download';
import { DateInput } from '../common/fields';

function normalizeRules(text: string): string[] {
  return text.split('\n').map((r) => r.trim()).filter(Boolean);
}

export function SettingsScreen() {
  const data = useData();
  const apply = useStore((s) => s.apply);
  const replace = useStore((s) => s.replace);
  const resetToSeed = useStore((s) => s.resetToSeed);
  const confirm = useConfirm();
  const markBackup = useStore((s) => s.markBackup);
  const lastBackupAt = useStore((s) => s.lastBackupAt);
  const persisted = useStore((s) => s.persisted);
  const fileRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const [exported, setExported] = useState<{ url: string; name: string } | null>(null);
  const [rulesText, setRulesText] = useState(data.rules.join('\n'));
  // Só troca o texto do campo quando as regras mudam por fora (desfazer, importar);
  // a gravação do próprio campo não mexe no que está sendo digitado (espaços, linha nova).
  useEffect(() => {
    setRulesText((t) => (normalizeRules(t).join('\n') === data.rules.join('\n') ? t : data.rules.join('\n')));
  }, [data.rules]);
  // Regras gravam enquanto se digita (meio segundo depois da última tecla) e na hora
  // ao sair do campo, trocar de tela ou fechar a página.
  const rulesRef = useRef({ text: rulesText, saved: data.rules.join('\n') });
  rulesRef.current = { text: rulesText, saved: data.rules.join('\n') };
  const saveRules = useRef(() => {
    const { text, saved } = rulesRef.current;
    const rules = normalizeRules(text);
    if (rules.join('\n') !== saved) useStore.getState().apply((x) => { x.rules = rules; });
  }).current;
  useEffect(() => {
    const t = setTimeout(saveRules, 500);
    return () => clearTimeout(t);
  }, [rulesText, saveRules]);
  useEffect(() => {
    const now = () => { saveRules(); useStore.getState().flush(); };
    const onHide = () => { if (document.visibilityState === 'hidden') now(); };
    window.addEventListener('pagehide', now);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', now);
      document.removeEventListener('visibilitychange', onHide);
      saveRules();
    };
  }, [saveRules]);
  useEffect(() => {
    if (!exported) return;
    return () => URL.revokeObjectURL(exported.url);
  }, [exported]);

  const toggleDay = (d: number) => {
    apply((x) => {
      x.openDays = x.openDays.includes(d) ? x.openDays.filter((y) => y !== d) : [...x.openDays, d].sort();
    });
  };

  const download = () => {
    const blob = new Blob([exportBackup(data)], { type: 'application/json' });
    const name = backupFileName();
    const url = downloadBlob(blob, name);
    markBackup();
    setExported({ url, name });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = parseBackup(await file.text());
      const ok = await confirm({
        title: 'Importar backup?',
        message: <>O arquivo <strong>{file.name}</strong> tem {parsed.asbs.length} ASBs, {parsed.dentists.length} dentistas e {parsed.base.slots.length} fichas. Ele substitui tudo o que está salvo agora (dá para desfazer com Ctrl+Z).</>,
        confirmLabel: 'Importar',
      });
      if (ok) {
        replace(parsed);
        setNotice({ title: 'Backup importado', message: 'A escala foi substituída pelo conteúdo do arquivo.' });
      }
    } catch (e) {
      setNotice({ title: 'Não foi possível importar', message: e instanceof BackupError ? e.message : 'Erro inesperado ao ler o arquivo.' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const reset = async () => {
    const ok = await confirm({
      title: 'Voltar para a escala inicial?',
      message: 'Tudo o que foi alterado (quadro, equipe, tarefas, ausências, horas extras, folgas de dentista e o histórico dos dias passados) volta ao que veio dos documentos do CEO. Exporte um backup antes se quiser guardar. Dá para desfazer com Ctrl+Z enquanto a página estiver aberta.',
      confirmLabel: 'Voltar para a inicial',
      danger: true,
    });
    if (ok) resetToSeed();
  };

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <h1>Ajustes</h1>
      <section className="card">
        <h2>Dias de funcionamento</h2>
        <p className="muted small">Nos dias desmarcados o quadro do dia fica vazio e as tarefas não se aplicam.</p>
        <div className="checks">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <label key={d}>
              <input type="checkbox" checked={data.openDays.includes(d)} onChange={() => toggleDay(d)} /> {WEEKDAY_LABEL[d]}
            </label>
          ))}
        </div>
      </section>

      <ClosedDates />

      <section className="card">
        <h2>Backup</h2>
        <p className="muted small">
          Os dados ficam salvos neste navegador, neste aparelho, e continuam salvos ao fechar a página. Celular e computador guardam cada um a sua cópia: o que é feito num não aparece no outro. Eles se perdem se alguém limpar os dados do navegador, se usar janela anônima, ou, no iPhone e no Safari, se o site ficar muitos dias sem ser aberto. Exporte um arquivo de vez em quando e guarde num lugar seguro. Para usar em outro computador, importe o arquivo lá.
        </p>
        <p className="small">
          {persisted === true
            ? 'Armazenamento protegido: o navegador confirmou que não vai apagar os dados sozinho.'
            : persisted === false
              ? 'O navegador ainda não garantiu proteção dos dados. Isso costuma mudar sozinho com o uso frequente do site; adicionar o site aos favoritos (ou instalá-lo pelo menu do navegador) ajuda. Até lá, use sempre o mesmo navegador e mantenha o backup em dia.'
              : 'Este navegador não informa se protege os dados. Mantenha o backup em dia.'}
        </p>
        <p className="small">
          {lastBackupAt
            ? `Último backup exportado em ${formatDate(lastBackupAt)} (${diffDays(lastBackupAt, todayIso())} dia(s) atrás).`
            : 'Nenhum backup exportado neste navegador ainda.'}
        </p>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button className="btn primary" onClick={download}>Exportar backup (JSON)</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Importar backup...</button>
          <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
      </section>

      <section className="card">
        <h2>Escala inicial</h2>
        <p className="muted small">Recarrega os dados extraídos dos documentos do CEO (equipe, salas, dentistas, tarefas e a escala base proposta).</p>
        <button className="btn danger" onClick={reset}>Voltar para a escala inicial</button>
      </section>

      <section className="card">
        <h2>Regras fixas</h2>
        <p className="muted small">Aparecem no PDF. Uma por linha.</p>
        <textarea
          rows={6}
          style={{ width: '100%', padding: 8, border: '1px solid var(--line-strong)', borderRadius: 6 }}
          value={rulesText}
          onChange={(e) => setRulesText(e.target.value)}
          onBlur={saveRules}
        />
      </section>

      {exported && (
        <Modal title="Backup exportado" onClose={() => setExported(null)}>
          <p><strong>{exported.name}</strong>. Se o download não começou sozinho, use o botão abaixo.</p>
          <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
            <a className="btn primary" href={exported.url} download={exported.name}>Baixar backup</a>
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={() => setExported(null)}>Fechar</button>
          </div>
        </Modal>
      )}
      {notice && <Notice title={notice.title} message={notice.message} onClose={() => setNotice(null)} />}
    </div>
  );
}

/** Feriados e outros dias em que o CEO não abre, mesmo sendo dia de funcionamento. */
function ClosedDates() {
  const data = useData();
  const apply = useStore((s) => s.apply);
  const today = todayIso();
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [showPast, setShowPast] = useState(false);
  const list = [...(data.closedDates ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const visible = showPast ? list : list.filter((c) => c.date >= today);
  const exists = list.some((c) => c.date === date);
  const add = () => {
    if (!isValidIso(date) || exists) return;
    apply((x) => {
      x.closedDates = [...(x.closedDates ?? []), { date, ...(note.trim() ? { note: note.trim() } : {}) }].sort((a, b) => a.date.localeCompare(b.date));
    });
    setNote('');
  };
  return (
    <section className="card">
      <h2>Feriados e dias fechados</h2>
      <p className="muted small">
        Datas em que o CEO não abre. Nelas o quadro do dia fica vazio, não há alertas nem tarefas, e ausências e horas extras não contam.
      </p>
      <div className="field-row" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '0 0 auto' }}>
          <label>Data</label>
          <DateInput value={date} onChange={setDate} ariaLabel="Data fechada" />
        </div>
        <div className="field">
          <label>Motivo (opcional)</label>
          <input value={note} maxLength={60} placeholder="Ex.: Feriado municipal" onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="field" style={{ flex: '0 0 auto' }}>
          <button className="btn primary" onClick={add} disabled={exists}>{exists ? 'Já cadastrada' : 'Adicionar'}</button>
        </div>
      </div>
      {visible.length > 0 ? (
        <ul className="plain-list">
          {visible.map((c) => (
            <li key={c.date}>
              <span>
                {formatDate(c.date)} ({WEEKDAY_LABEL[weekdayOf(c.date)].toLowerCase()}){c.note ? `: ${c.note}` : ''}
              </span>
              <button
                className="btn sm"
                onClick={() => apply((x) => { x.closedDates = (x.closedDates ?? []).filter((y) => y.date !== c.date); })}
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{list.length > 0 ? 'Nenhuma data fechada daqui para a frente.' : 'Nenhuma data cadastrada.'}</p>
      )}
      {list.some((c) => c.date < today) && (
        <button className="btn sm" onClick={() => setShowPast((v) => !v)}>{showPast ? 'Esconder datas passadas' : 'Mostrar datas passadas'}</button>
      )}
    </section>
  );
}
