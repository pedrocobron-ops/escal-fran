import { MONTH_LABEL } from '../../domain';

export interface YearMonth {
  year: number;
  month: number;
}

export function currentYearMonth(now: Date = new Date()): YearMonth {
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function shiftMonth(ym: YearMonth, delta: number): YearMonth {
  const idx = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export function MonthPicker({ value, onChange }: { value: YearMonth; onChange: (ym: YearMonth) => void }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button className="btn icon" onClick={() => onChange(shiftMonth(value, -1))} aria-label="Mês anterior">‹</button>
      <select value={value.month} onChange={(e) => onChange({ ...value, month: Number(e.target.value) })} aria-label="Mês">
        {MONTH_LABEL.map((m, i) => (
          <option key={m} value={i + 1}>{m}</option>
        ))}
      </select>
      <input type="number" value={value.year} min={2020} max={2100} style={{ width: 80 }} onChange={(e) => onChange({ ...value, year: Number(e.target.value) || value.year })} aria-label="Ano" />
      <button className="btn icon" onClick={() => onChange(shiftMonth(value, 1))} aria-label="Próximo mês">›</button>
    </div>
  );
}
