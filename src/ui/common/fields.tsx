import type { ReactNode } from 'react';
import { HOURS, WEEKDAY_SHORT } from '../../domain';
import { formatHour } from '../../domain';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

/** Seletor de hora inteira entre 07h e 19h. */
export function HourSelect({ value, onChange, min = HOURS[0], max = HOURS[HOURS.length - 1] + 1, ariaLabel }: {
  value: number;
  onChange: (h: number) => void;
  min?: number;
  max?: number;
  ariaLabel?: string;
}) {
  const opts: number[] = [];
  for (let h = min; h <= max; h++) opts.push(h);
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={ariaLabel}>
      {opts.map((h) => (
        <option key={h} value={h}>{formatHour(h)}</option>
      ))}
    </select>
  );
}

/** Caixas de seleção dos dias da semana. */
export function DaysPicker({ value, onChange, allowed }: { value: number[]; onChange: (days: number[]) => void; allowed?: number[] }) {
  const days = allowed ?? [0, 1, 2, 3, 4, 5, 6];
  const toggle = (d: number) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort());
  return (
    <div className="checks">
      {days.map((d) => (
        <label key={d}>
          <input type="checkbox" checked={value.includes(d)} onChange={() => toggle(d)} /> {WEEKDAY_SHORT[d]}
        </label>
      ))}
    </div>
  );
}
