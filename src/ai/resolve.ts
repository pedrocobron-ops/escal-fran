// Resolução de nomes, datas e horas vindas da conversa com a Cléo (puro, testável).
import type { AppData, Asb, Dentist, IsoDate, Room, Task } from '../domain';
import { addDays, weekdayOf } from '../domain';

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(dra?\.?|doutora?)\s+/, '')
    .trim();
}

export type Found<T> = { ok: true; item: T } | { ok: false; error: string };

function pick<T extends { name: string }>(list: T[], text: string, what: string): Found<T> {
  const q = normalize(text);
  if (!q) return { ok: false, error: `Falta o nome ${what}.` };
  const byName = (f: (n: string) => boolean) => list.filter((x) => f(normalize(x.name)));
  const exact = byName((n) => n === q);
  if (exact.length === 1) return { ok: true, item: exact[0] };
  const starts = byName((n) => n.startsWith(q) || n.split(/\s+/).some((w) => w.startsWith(q)));
  if (starts.length === 1) return { ok: true, item: starts[0] };
  const includes = byName((n) => n.includes(q));
  if (includes.length === 1) return { ok: true, item: includes[0] };
  const cands = starts.length > 0 ? starts : includes;
  if (cands.length > 1) return { ok: false, error: `"${text}" pode ser ${cands.map((c) => c.name).join(' ou ')}. Qual?` };
  return { ok: false, error: `Não achei ${what} "${text}". Opções: ${list.map((x) => x.name).join(', ')}.` };
}

export function findAsb(data: AppData, text: string, opts: { inactive?: boolean } = {}): Found<Asb> {
  return pick(data.asbs.filter((a) => a.active || opts.inactive), text, 'da ASB');
}

export function findDentist(data: AppData, text: string): Found<Dentist> {
  return pick(data.dentists, text, 'do dentista');
}

export function findRoom(data: AppData, text: string): Found<Room> {
  const q = normalize(text).replace(/^sala\s*/, '');
  const rooms = [...data.rooms].sort((a, b) => a.order - b.order);
  const byNumber = rooms.filter((r) => normalize(r.name).replace(/^sala\s*/, '') === q);
  if (byNumber.length === 1) return { ok: true, item: byNumber[0] };
  return pick(rooms, text, 'da sala');
}

export function findTask(data: AppData, text: string): Found<Task> {
  return pick(data.tasks, text, 'da tarefa');
}

const WEEKDAYS: Record<string, number> = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };

/**
 * Data em ISO a partir do que a conversa trouxe: ISO, "hoje", "amanhã", "ontem", "dd/mm",
 * "dd/mm/aaaa" ou dia da semana (a próxima ocorrência, contando hoje).
 */
export function resolveDate(text: string | undefined, today: IsoDate): IsoDate | undefined {
  if (!text) return undefined;
  const t = normalize(String(text));
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (t === 'hoje') return today;
  if (t === 'amanha') return addDays(today, 1);
  if (t === 'ontem') return addDays(today, -1);
  if (t === 'depois de amanha') return addDays(today, 2);
  const dm = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (dm) {
    const year = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : Number(today.slice(0, 4));
    const iso = `${year}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : undefined;
  }
  const wd = t.replace(/^(proxima|próxima|essa|esta|nesta|na|no)\s+/, '').replace(/-feira$/, '').replace(/\s+que\s+vem$/, '');
  const target = WEEKDAYS[wd];
  if (target !== undefined) {
    const diff = (target - weekdayOf(today) + 7) % 7;
    return addDays(today, /^(proxima|próxima)/.test(t) && diff === 0 ? 7 : diff);
  }
  return undefined;
}

/** Hora inteira a partir de 7, "7h", "07h", "7:00", "16h30" (arredonda para baixo). */
export function parseHour(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isInteger(v) ? v : Math.floor(v);
  if (typeof v !== 'string') return undefined;
  const m = v.trim().toLowerCase().match(/^(\d{1,2})(?:\s*h|:)?/);
  if (!m) return undefined;
  const h = Number(m[1]);
  return h >= 0 && h <= 24 ? h : undefined;
}

/** Lista de horas a partir de "15,16", [15, 16], "15h às 17h" (fim exclusivo) ou "15h". */
export function parseHours(v: unknown): number[] {
  if (Array.isArray(v)) return v.map(parseHour).filter((h): h is number => h !== undefined);
  if (typeof v === 'number') return [v];
  if (typeof v !== 'string') return [];
  const range = v.match(/(\d{1,2})\s*h?\s*(?:as|às|a|-|–|ate|até)\s*(\d{1,2})/i);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    const out: number[] = [];
    for (let h = a; h < b; h++) out.push(h);
    return out;
  }
  return v.split(/[,\s]+/).map(parseHour).filter((h): h is number => h !== undefined);
}
