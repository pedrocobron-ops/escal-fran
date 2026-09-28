import { useRef, useState } from 'react';
import { BackupError, parseBackup, repairBackup, seedData, type RepairReport } from '../../store/storage';
import { useStore } from '../../store/useStore';
import { downloadBlob } from './download';

/**
 * Aparece quando os dados salvos no navegador têm problema. Nada é apagado nem
 * substituído sem a pessoa escolher, e uma cópia do que estava salvo é guardada.
 */
export function RecoveryScreen() {
  const recovery = useStore((s) => s.recovery);
  const resolve = useStore((s) => s.resolveRecovery);
  const fileRef = useRef<HTMLInputElement>(null);
  const [repair, setRepair] = useState<RepairReport | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmSeed, setConfirmSeed] = useState(false);
  if (!recovery) return null;

  const download = () => downloadBlob(new Blob([recovery.raw], { type: 'application/json' }), 'escala-ceo-dados-salvos.json');
  const tryRepair = () => {
    try {
      setRepair(repairBackup(recovery.raw));
      setMsg(null);
    } catch (e) {
      setMsg(e instanceof BackupError ? e.message : 'Não foi possível reparar.');
    }
  };
  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      await resolve(parseBackup(await file.text()));
    } catch (e) {
      setMsg(e instanceof BackupError ? `Esse arquivo também tem problema: ${e.message}` : 'Não foi possível ler o arquivo.');
    }
  };

  return (
    <main className="app-main">
      <div className="card" style={{ maxWidth: 720, margin: '32px auto' }}>
        <h2>Os dados salvos precisam de atenção</h2>
        <p>
          O app encontrou um problema nos dados salvos neste navegador e <strong>não apagou nada</strong>. Escolha o que fazer. Qualquer que seja a escolha,
          uma cópia do que estava salvo fica guardada neste navegador.
        </p>
        <p className="muted small">Problema encontrado: {recovery.error}</p>
        <div className="stack">
          <div>
            <button className="btn" onClick={download}>1. Baixar os dados salvos (arquivo)</button>
            <p className="muted small">Recomendado antes de qualquer outra coisa.</p>
          </div>
          <div>
            <button className="btn primary" onClick={tryRepair}>2. Tentar reparar</button>
            <p className="muted small">Tira só o que está com problema (por exemplo, uma data digitada errado) e mantém o resto.</p>
            {repair && (
              <div className="note ok">
                {repair.removed.length === 0 ? 'Nada precisou ser removido.' : <>Vai remover: {repair.removed.join('; ')}.</>}{' '}
                O resto fica: {repair.data.asbs.length} ASBs, {repair.data.absences.length} ausências, {(repair.data.extraShifts ?? []).length} horas extras.
                <div style={{ marginTop: 6 }}>
                  <button className="btn primary sm" onClick={() => resolve(repair.data)}>Usar os dados reparados</button>
                </div>
              </div>
            )}
          </div>
          <div>
            <button className="btn" onClick={() => fileRef.current?.click()}>3. Importar um backup</button>
            <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
            <p className="muted small">Use o último arquivo exportado em Ajustes.</p>
          </div>
          <div>
            {!confirmSeed ? (
              <button className="btn danger" onClick={() => setConfirmSeed(true)}>4. Começar pela escala inicial</button>
            ) : (
              <button className="btn danger" onClick={() => resolve(seedData())}>Confirmar: começar pela escala inicial</button>
            )}
            <p className="muted small">Só se nada acima funcionar. A escala, as ausências e o histórico voltam ao início.</p>
          </div>
        </div>
        {msg && <p className="error">{msg}</p>}
      </div>
    </main>
  );
}
