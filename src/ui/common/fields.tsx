import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { HOURS, WEEKDAY_SHORT, isValidIso } from '../../domain';
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

/**
 * Campo de data que só avisa quando a data está completa e válida (ano entre 2000
 * e 2100). Enquanto a pessoa digita o ano, o valor parcial fica só no campo.
 */
/**
 * Campo de data que nunca repassa data inválida. Enquanto a pessoa digita o ano, o
 * navegador passa por valores intermediários (ex.: 2022 no meio de 20227): com
 * `commitOnBlur`, o valor só é usado ao sair do campo ou teclar Enter; `onValidity`
 * avisa quando o que está escrito não é uma data válida (para desabilitar o botão).
 */
export function DateInput({
  value, onChange, ariaLabel, min, commitOnBlur, onValidity,
}: {
  value: string;
  onChange: (iso: string) => void;
  ariaLabel?: string;
  min?: string;
  commitOnBlur?: boolean;
  onValidity?: (valid: boolean) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (isValidIso(text)) {
      if (text !== value) onChange(text);
    } else {
      setText(value);
      onValidity?.(true);
    }
  };
  return (
    <input
      type="date"
      value={text}
      min={min}
      aria-label={ariaLabel}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        onValidity?.(isValidIso(v));
        if (!commitOnBlur && isValidIso(v)) onChange(v);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter' && commitOnBlur) commit(); }}
      onBlur={commitOnBlur ? commit : () => { if (!isValidIso(text)) { setText(value); onValidity?.(true); } }}
    />
  );
}
