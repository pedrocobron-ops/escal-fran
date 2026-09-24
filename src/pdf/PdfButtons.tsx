import { useState } from 'react';
import type { IsoDate } from '../domain';
import { MONTH_LABEL, todayIso } from '../domain';
import { useData } from '../store/useStore';
import type { YearMonth } from '../ui/common/MonthPicker';
import { Modal, Notice } from '../ui/common/Modal';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Botões "Gerar PDF" do mês e do dia. */
export function PdfButtons({ ym }: { ym: YearMonth }) {
  const data = useData();
  const [busy, setBusy] = useState<'month' | 'day' | null>(null);
  const [askDay, setAskDay] = useState(false);
  const [date, setDate] = useState<IsoDate>(todayIso());
  const [error, setError] = useState<string | null>(null);

  const genMonth = async () => {
    setBusy('month');
    try {
      const { monthPdfBlob } = await import('./generate');
      const blob = await monthPdfBlob(data, ym.year, ym.month);
      download(blob, `escala-ceo-${ym.year}-${String(ym.month).padStart(2, '0')}-${MONTH_LABEL[ym.month - 1]}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar o PDF.');
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
      download(blob, `escala-ceo-dia-${date}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar o PDF.');
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
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} autoFocus />
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setAskDay(false)}>Cancelar</button>
            <button className="btn primary" onClick={genDay}>Gerar PDF</button>
          </div>
        </Modal>
      )}
      {error && <Notice title="Não foi possível gerar o PDF" message={error} onClose={() => setError(null)} />}
    </>
  );
}
