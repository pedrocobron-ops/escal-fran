import type { YearMonth } from '../ui/common/MonthPicker';

/** Substituído na etapa 6 pelos botões de PDF do mês e do dia. */
export function PdfButtons(_props: { ym: YearMonth }) {
  return <button className="btn primary" disabled title="Chega na próxima etapa">Gerar PDF</button>;
}
