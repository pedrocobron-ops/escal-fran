// Formatação de horas no padrão da interface: `07h` e `11h–15h`.

export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}h`;
}

/** Faixa de horas: `11h–15h`. */
export function formatRange(start: number, end: number): string {
  return `${formatHour(start)}–${formatHour(end)}`;
}

/** Bloco de uma hora: `07h–08h`. */
export function formatBlock(hour: number): string {
  return formatRange(hour, hour + 1);
}

/** Horas inteiras de `start` até `end` (exclusivo). */
export function hoursBetween(start: number, end: number): number[] {
  const out: number[] = [];
  for (let h = start; h < end; h++) out.push(h);
  return out;
}

/** Agrupa horas consecutivas em faixas [start, end). Ex.: [7,8,9,12] -> [[7,10],[12,13]]. */
export function groupHours(hours: number[]): Array<[number, number]> {
  const sorted = [...new Set(hours)].sort((a, b) => a - b);
  const out: Array<[number, number]> = [];
  for (const h of sorted) {
    const last = out[out.length - 1];
    if (last && last[1] === h) last[1] = h + 1;
    else out.push([h, h + 1]);
  }
  return out;
}
