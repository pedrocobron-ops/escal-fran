import { useEffect, useState } from 'react';
import type { IsoDate } from '../domain';
import { MONTH_LABEL, todayIso } from '../domain';
import { useData } from '../store/useStore';
import type { YearMonth } from '../ui/common/MonthPicker';
import { Modal, Notice } from '../ui/common/Modal';
import { downloadBlob } from '../ui/common/download';
import { DateInput } from '../ui/common/fields';

interface Ready {
  url: string;
  name: string;
  size: number;
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Janela "PDF pronto", com baixar, abrir e fechar (os botões quebram linha no celular). */
function ReadyModal({ ready, onClose }: { ready: Ready; onClose: () => void }) {
  return (
    <Modal title="PDF pronto" onClose={onClose}>
      <p>
        <strong>{ready.name}</strong> ({formatSize(ready.size)}). Se o download não começou sozinho, use o botão abaixo.
      </p>
      <div className="modal-actions wrap">
        <a className="btn primary" href={ready.url} download={ready.name}>Baixar PDF</a>
        <a className="btn" href={ready.url} target="_blank" rel="noopener noreferrer">Abrir em nova aba</a>
        <button className="btn" onClick={onClose}>Fechar</button>
      </div>
    </Modal>
  );
}

/** Botão "PDF deste dia", usado no Modo Dia do quadro. */
export function DayPdfButton({ date }: { date: IsoDate }) {
  const data = useData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  useEffect(() => {
    if (!ready) return;
    return () => URL.revokeObjectURL(ready.url);
  }, [ready]);
  const gen = async () => {
    setBusy(true);
    try {
      const { dayPdfBlob } = await import('./generate');
      const blob = await dayPdfBlob(data, date);
      const name = `escala-ceo-dia-${date}.pdf`;
      setReady({ url: downloadBlob(blob, name), name, size: blob.size });
    } catch (e) {
      setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className="btn" onClick={gen} disabled={busy}>{busy ? 'Gerando...' : 'PDF deste dia'}</button>
      {ready && <ReadyModal ready={ready} onClose={() => setReady(null)} />}
      {error && <Notice title="Não foi possível gerar o PDF" message={<span>{error}</span>} onClose={() => setError(null)} />}
    </>
  );
}

/** Botões "Gerar PDF" do mês e do dia. */
export function PdfButtons({ ym }: { ym: YearMonth }) {
  const data = useData();
  const [busy, setBusy] = useState<'month' | 'day' | null>(null);
  const [askDay, setAskDay] = useState(false);
  const [date, setDate] = useState<IsoDate>(todayIso());
  const [dateOk, setDateOk] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<Ready | null>(null);

  useEffect(() => {
    if (!ready) return;
    return () => URL.revokeObjectURL(ready.url);
  }, [ready]);

  const finish = (blob: Blob, name: string) => {
    const url = downloadBlob(blob, name);
    setReady({ url, name, size: blob.size });
  };

  const fail = (e: unknown) => {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    setError(msg);
  };

  const genMonth = async () => {
    setBusy('month');
    try {
      const { monthPdfBlob } = await import('./generate');
      const blob = await monthPdfBlob(data, ym.year, ym.month);
      finish(blob, `escala-ceo-${ym.year}-${String(ym.month).padStart(2, '0')}-${MONTH_LABEL[ym.month - 1]}.pdf`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const genDay = async () => {
    setBusy('day');
    setAskDay(false);
    try {
      const { dayPdfBlob } = await import('./generate');
      const blob = await dayPdfBlob(data, date);
      finish(blob, `escala-ceo-dia-${date}.pdf`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <button className="btn primary" onClick={genMonth} disabled={busy !== null}>
        {busy === 'month' ? 'Gerando...' : 'Gerar PDF do mês'}
      </button>
      <button className="btn" onClick={() => setAskDay(true)} disabled={busy !== null}>
        {busy === 'day' ? 'Gerando...' : 'PDF do dia...'}
      </button>
      {askDay && (
        <Modal title="PDF de um dia" onClose={() => setAskDay(false)}>
          <p className="muted small">A escala efetiva da data, com ausências e substituições aplicadas. Útil quando alguém falta.</p>
          <div className="field">
            <label>Data</label>
            <DateInput value={date} onChange={setDate} onValidity={setDateOk} ariaLabel="Data" />
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setAskDay(false)}>Cancelar</button>
            <button className="btn primary" onClick={genDay} disabled={!dateOk}>{dateOk ? 'Gerar PDF' : 'Data inválida'}</button>
          </div>
        </Modal>
      )}
      {ready && <ReadyModal ready={ready} onClose={() => setReady(null)} />}
      {error && <Notice title="Não foi possível gerar o PDF" message={<span>{error}</span>} onClose={() => setError(null)} />}
    </>
  );
}
