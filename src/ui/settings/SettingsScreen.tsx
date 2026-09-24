import { useEffect, useRef, useState } from 'react';
import { WEEKDAY_LABEL, diffDays, formatDate, todayIso } from '../../domain';
import { BackupError, backupFileName, exportBackup, parseBackup } from '../../store/storage';
import { useData, useStore } from '../../store/useStore';
import { Modal, Notice, useConfirm } from '../common/Modal';
import { downloadBlob } from '../common/download';

export function SettingsScreen() {
  const data = useData();
  const apply = useStore((s) => s.apply);
  const replace = useStore((s) => s.replace);
  const resetToSeed = useStore((s) => s.resetToSeed);
  const confirm = useConfirm();
  const markBackup = useStore((s) => s.markBackup);
  const lastBackupAt = useStore((s) => s.lastBackupAt);
  const fileRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const [exported, setExported] = useState<{ url: string; name: string } | null>(null);
  const [rulesText, setRulesText] = useState(data.rules.join('\n'));
  useEffect(() => setRulesText(data.rules.join('\n')), [data.rules]);
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
      message: 'Tudo o que foi alterado (quadro, equipe, tarefas e ausências) volta ao que veio dos documentos do CEO. Dá para desfazer com Ctrl+Z.',
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

      <section className="card">
        <h2>Backup</h2>
        <p className="muted small">Os dados ficam salvos só neste navegador. Exporte um arquivo de vez em quando e guarde num lugar seguro. Para usar em outro computador, importe o arquivo lá.</p>
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
          onBlur={() => {
            const rules = rulesText.split('\n').map((r) => r.trim()).filter(Boolean);
            if (rules.join('\n') !== data.rules.join('\n')) apply((x) => { x.rules = rules; });
            else setRulesText(rules.join('\n'));
          }}
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
