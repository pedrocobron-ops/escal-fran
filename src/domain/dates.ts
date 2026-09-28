// Helpers de data sem fuso horário. Datas são strings ISO `YYYY-MM-DD`.

import type { IsoDate } from './types';

const DAY_MS = 86_400_000;

export interface Ymd {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
}

export function parseIso(iso: IsoDate): Ymd {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Data inválida: ${iso}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Milissegundos UTC sem o atalho do Date.UTC que trata os anos 0 a 99 como 1900 a 1999. */
function utcOf(year: number, month: number, day: number): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function isoOfMs(ms: number): IsoDate {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  return `${String(y).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function toIso(year: number, month: number, day: number): IsoDate {
  return isoOfMs(utcOf(year, month, day));
}

function utcMs(iso: IsoDate): number {
  const { year, month, day } = parseIso(iso);
  return utcOf(year, month, day);
}

/** Data ISO completa, que existe no calendário e com ano entre 2000 e 2100 (o que o app aceita salvar). */
export function isValidIso(iso: unknown): iso is IsoDate {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const { year, month, day } = parseIso(iso);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1) return false;
  return toIso(year, month, day) === iso;
}

/** 0=dom ... 6=sáb. */
export function weekdayOf(iso: IsoDate): number {
  return new Date(utcMs(iso)).getUTCDay();
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return isoOfMs(utcMs(iso) + days * DAY_MS);
}

/** Diferença em dias (b - a). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((utcMs(b) - utcMs(a)) / DAY_MS);
}

/** Segunda-feira da semana que contém a data. */
export function mondayOf(iso: IsoDate): IsoDate {
  const wd = weekdayOf(iso);
  const back = wd === 0 ? 6 : wd - 1;
  return addDays(iso, -back);
}

/** Semanas completas entre a semana de `start` e a semana de `date` (semana começa na segunda). */
export function weeksSince(start: IsoDate, date: IsoDate): number {
  return Math.round(diffDays(mondayOf(start), mondayOf(date)) / 7);
}

/** Meses entre o mês de `start` e o mês de `date`. */
export function monthsSince(start: IsoDate, date: IsoDate): number {
  const a = parseIso(start);
  const b = parseIso(date);
  return (b.year - a.year) * 12 + (b.month - a.month);
}

/** Módulo que nunca devolve negativo. */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function isBetween(iso: IsoDate, from: IsoDate, to: IsoDate): boolean {
  return iso >= from && iso <= to;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(utcOf(year, month + 1, 0)).getUTCDate();
}

export function firstOfMonth(year: number, month: number): IsoDate {
  return toIso(year, month, 1);
}

export function lastOfMonth(year: number, month: number): IsoDate {
  return toIso(year, month, daysInMonth(year, month));
}

export interface MonthWeek {
  /** 1..n dentro do mês. */
  index: number;
  monday: IsoDate;
  friday: IsoDate;
  /** Dias de segunda a sexta dessa semana que estão dentro do mês. */
  days: IsoDate[];
}

/** Semanas de segunda a sexta que tocam o mês (seção 5.4). */
export function weeksOfMonth(year: number, month: number): MonthWeek[] {
  const first = firstOfMonth(year, month);
  const last = lastOfMonth(year, month);
  const weeks: MonthWeek[] = [];
  let monday = mondayOf(first);
  let index = 1;
  while (monday <= last) {
    const friday = addDays(monday, 4);
    const days: IsoDate[] = [];
    for (let i = 0; i < 5; i++) {
      const d = addDays(monday, i);
      if (d >= first && d <= last) days.push(d);
    }
    if (days.length > 0) {
      weeks.push({ index, monday, friday, days });
      index++;
    }
    monday = addDays(monday, 7);
  }
  return weeks;
}

export const WEEKDAY_LABEL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const MONTH_LABEL = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** `2026-09-14` -> `14/09/2026`. */
export function formatDate(iso: IsoDate): string {
  const { year, month, day } = parseIso(iso);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

/** `2026-09-14` -> `14/09`. */
export function formatDayMonth(iso: IsoDate): string {
  const { month, day } = parseIso(iso);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
}

/** (2026, 9) -> `setembro de 2026`. */
export function formatMonth(year: number, month: number): string {
  return `${MONTH_LABEL[month - 1]} de ${year}`;
}

/** Data de hoje no formato ISO, no fuso local. */
export function todayIso(now: Date = new Date()): IsoDate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
