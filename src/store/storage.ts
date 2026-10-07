// Camada de persistência isolada. Hoje: localStorage. Amanhã: Supabase, trocando
// só o adapter, sem mexer no resto do app.

import type { AppData } from '../domain';
import { isValidIso, todayIso } from '../domain';
import seedJson from '../data/seed.json';

export const STORAGE_KEY = 'escala-ceo:data';
export const CURRENT_VERSION = 1;

/** Resultado de ler o armazenamento: vazio, dados válidos, ou dados com problema (nunca descartados). */
export type LoadResult =
  | { status: 'empty' }
  | { status: 'ok'; data: AppData }
  | { status: 'invalid'; raw: string; error: string };

/** Contrato que qualquer backend precisa cumprir. */
export interface StorageAdapter {
  load(): Promise<LoadResult>;
  save(data: AppData): Promise<void>;
  clear(): Promise<void>;
  /** Guarda uma cópia do texto bruto antes de qualquer troca arriscada. Devolve a chave usada. */
  keepCopy(raw: string): Promise<string>;
  /** Avisa quando outra aba ou janela grava dados novos. Devolve a função para parar de ouvir. */
  subscribe?(onChange: (data: AppData) => void): () => void;
  /** Envia na hora o que estiver pendente (ao fechar a página). */
  flush?(): void;
}

export const COPY_PREFIX = 'escala-ceo:copia:';

function interpret(raw: string | null): LoadResult {
  if (!raw) return { status: 'empty' };
  try {
    return { status: 'ok', data: parseBackup(raw) };
  } catch (e) {
    return { status: 'invalid', raw, error: e instanceof Error ? e.message : String(e) };
  }
}

export function seedData(): AppData {
  return structuredClone(seedJson) as AppData;
}

export class LocalStorageAdapter implements StorageAdapter {
  constructor(private readonly key: string = STORAGE_KEY, private readonly store: Storage = window.localStorage) {}

  async load(): Promise<LoadResult> {
    return interpret(this.store.getItem(this.key));
  }

  async save(data: AppData): Promise<void> {
    this.store.setItem(this.key, JSON.stringify(data));
  }

  async clear(): Promise<void> {
    this.store.removeItem(this.key);
  }

  async keepCopy(raw: string): Promise<string> {
    const key = `${COPY_PREFIX}${new Date().toISOString()}`;
    this.store.setItem(key, raw);
    return key;
  }

  subscribe(onChange: (data: AppData) => void): () => void {
    const handler = (e: StorageEvent) => {
      if (e.storageArea !== this.store || e.key !== this.key) return;
      const r = interpret(e.newValue);
      // Dados com problema vindos da outra aba não entram aqui; esta aba segue com os seus.
      if (r.status === 'ok') onChange(migrate(r.data));
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }
}

/**
 * localStorage do navegador ou, se ele estiver bloqueado (dados do site bloqueados,
 * alguns modos privados), um armazenamento só em memória, avisando que nada fica salvo.
 */
export function browserAdapter(): { adapter: StorageAdapter; blocked: boolean } {
  try {
    const ls = window.localStorage;
    const probe = `${STORAGE_KEY}:teste`;
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return { adapter: new LocalStorageAdapter(STORAGE_KEY, ls), blocked: false };
  } catch {
    return { adapter: new MemoryAdapter(), blocked: true };
  }
}

/** Adapter em memória, útil em testes. Guarda o texto bruto, como o localStorage. */
export class MemoryAdapter implements StorageAdapter {
  raw: string | null = null;
  copies: Record<string, string> = {};
  async load() {
    return interpret(this.raw);
  }
  async save(data: AppData) {
    this.raw = JSON.stringify(data);
  }
  async clear() {
    this.raw = null;
  }
  async keepCopy(raw: string) {
    const key = `${COPY_PREFIX}${Object.keys(this.copies).length + 1}`;
    this.copies[key] = raw;
    return key;
  }
}

export type InitialLoad =
  | { data: AppData; fromSeed: boolean; recovery?: undefined }
  | { data: null; fromSeed: false; recovery: { raw: string; error: string } };

/**
 * Carrega o que está salvo ou, no primeiro uso, o seed. Se o que está salvo tiver
 * problema, NÃO carrega o seed por cima: devolve o texto para a tela de recuperação.
 */
export async function loadInitial(adapter: StorageAdapter): Promise<InitialLoad> {
  const r = await adapter.load();
  if (r.status === 'ok') return { data: migrate(r.data), fromSeed: false };
  if (r.status === 'invalid') return { data: null, fromSeed: false, recovery: { raw: r.raw, error: r.error } };
  return { data: seedData(), fromSeed: true };
}

export interface RepairReport {
  data: AppData;
  removed: string[];
}

/**
 * Tenta salvar o que dá de um backup com problema: tira registros com datas ou
 * campos inválidos e corrige datas de início de rodízio. Lança BackupError se o
 * texto nem for JSON ou faltar a estrutura principal.
 */
export function repairBackup(json: string): RepairReport {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new BackupError('O arquivo não é um JSON válido; não dá para reparar.');
  }
  if (!isRecord(raw)) throw new BackupError('O conteúdo não tem o formato da escala; não dá para reparar.');
  const removed: string[] = [];
  const r = raw as Record<string, unknown>;
  const list = (k: string) => (isArray(r[k]) ? (r[k] as unknown[]) : []);
  const keep = <T,>(k: string, label: string, ok: (x: Record<string, unknown>) => boolean): T[] => {
    const out: T[] = [];
    for (const x of list(k)) {
      if (isRecord(x) && ok(x)) out.push(x as T);
      else removed.push(`${label} ${isRecord(x) && typeof x.name === 'string' ? `"${x.name}" ` : ''}com dados inválidos`);
    }
    return out;
  };
  r.rooms = keep('rooms', 'sala', (x) => isStr(x.id) && isStr(x.name));
  const roomIds = new Set((r.rooms as Array<{ id: string }>).map((x) => x.id));
  r.dentists = keep('dentists', 'dentista', (x) => isStr(x.id) && isStr(x.name) && isStr(x.roomId) && roomIds.has(x.roomId) && isNum(x.start) && isNum(x.end));
  r.asbs = keep('asbs', 'ASB', (x) => isStr(x.id) && isStr(x.name) && isNum(x.start) && isNum(x.end));
  const asbIds = new Set((r.asbs as Array<{ id: string }>).map((x) => x.id));
  const base = isRecord(r.base) ? r.base : { slots: [] };
  const slots = isArray(base.slots) ? base.slots : [];
  const goodSlots = slots.filter((s) => isRecord(s) && isStr(s.asbId) && asbIds.has(s.asbId) && isNum(s.hour) && isStr(s.kind) && SLOT_KINDS.includes(s.kind));
  if (goodSlots.length < slots.length) removed.push(`${slots.length - goodSlots.length} ficha(s) da escala com dados inválidos`);
  r.base = { slots: goodSlots };
  r.tasks = keep('tasks', 'tarefa', (x) => isStr(x.id) && isStr(x.name) && isArray(x.days) && isRecord(x.assignment) && isStr(x.assignment.mode) && TASK_MODES.includes(x.assignment.mode));
  for (const t of r.tasks as Array<{ name: string; assignment: { mode: string; startDate?: unknown }; holdersByPeriod?: unknown }>) {
    if (t.assignment.mode === 'rotation' && !isIso(t.assignment.startDate)) {
      t.assignment.startDate = todayIso();
      removed.push(`data de início do rodízio "${t.name}" era inválida (passou a ser hoje)`);
    }
    if (t.holdersByPeriod !== undefined) {
      const list = isArray(t.holdersByPeriod) ? t.holdersByPeriod : [];
      const good = list.filter((h) => isRecord(h) && isStr(h.id) && isStr(h.asbId) && isIso(h.from) && isIso(h.to) && (h.to as string) >= (h.from as string));
      if (good.length < list.length || !isArray(t.holdersByPeriod)) removed.push(`responsável fixo da tarefa "${t.name}" com dados inválidos`);
      t.holdersByPeriod = good;
    }
  }
  if (r.lunchWindow !== undefined && !(isRecord(r.lunchWindow) && isNum(r.lunchWindow.start) && isNum(r.lunchWindow.end) && (r.lunchWindow.end as number) > (r.lunchWindow.start as number))) {
    delete r.lunchWindow;
    removed.push('horário de almoço inválido (voltou ao padrão 12h–15h)');
  }
  r.absences = keep('absences', 'ausência', (x) => isStr(x.id) && isStr(x.asbId) && isIso(x.from) && isIso(x.to) && (x.to as string) >= (x.from as string) && isStr(x.reason));
  r.rules = list('rules').filter((x) => typeof x === 'string');
  if (r.extraShifts !== undefined) r.extraShifts = keep('extraShifts', 'hora extra', (x) => isStr(x.id) && isStr(x.asbId) && isIso(x.date) && isNum(x.start) && isNum(x.end));
  if (r.dentistAbsences !== undefined) r.dentistAbsences = keep('dentistAbsences', 'folga de dentista', (x) => isStr(x.id) && isStr(x.dentistId) && isIso(x.from) && isIso(x.to));
  if (r.dayOverrides !== undefined) r.dayOverrides = keep('dayOverrides', 'ajuste de dia', (x) => isStr(x.id) && isStr(x.asbId) && isIso(x.date) && isNum(x.hour) && isStr(x.kind) && [...SLOT_KINDS, 'livre'].includes(x.kind));
  if (r.history !== undefined) r.history = keep('history', 'registro de histórico', (x) => isIso(x.until));
  if (r.closedDates !== undefined) r.closedDates = keep('closedDates', 'dia fechado', (x) => isIso(x.date) && (x.note === undefined || isStr(x.note)));
  if (r.historySince !== undefined && !isIso(r.historySince)) {
    delete r.historySince;
    removed.push('data de início do histórico era inválida (passou a ser hoje)');
  }
  if (r.protese !== undefined) r.protese = keep('protese', 'registro da Prótese', (x) => isStr(x.dentistId) && isStr(x.asbId) && isIso(x.since));
  if (!isArray(r.openDays)) r.openDays = [1, 2, 3, 4, 5];
  return { data: parseBackup(JSON.stringify(r)), removed };
}

export function exportBackup(data: AppData): string {
  return JSON.stringify(data, null, 2);
}

export function backupFileName(now: Date = new Date()): string {
  return `escala-ceo-backup-${todayIso(now)}.json`;
}

export class BackupError extends Error {}

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const SLOT_KINDS = ['sala', 'apoio', 'recepcao', 'cme', 'almox', 'almoco'];
const TASK_MODES = ['dentist', 'room', 'rotation', 'fixed'];

function need(cond: unknown, msg: string): void {
  if (!cond) throw new BackupError(msg);
}

function isStr(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isIso(v: unknown): boolean {
  return isValidIso(v);
}

/** Valida um JSON de backup, registro a registro. Lança BackupError com mensagem em português. */
export function parseBackup(json: string): AppData {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new BackupError('O arquivo não é um JSON válido.');
  }
  if (!isRecord(raw)) throw new BackupError('O arquivo não tem o formato de backup da escala.');
  const required = ['rooms', 'dentists', 'asbs', 'base', 'tasks', 'rules', 'absences'] as const;
  for (const key of required) {
    if (!(key in raw)) throw new BackupError(`O backup não tem o campo "${key}".`);
  }
  for (const key of ['rooms', 'dentists', 'asbs', 'tasks', 'rules', 'absences'] as const) {
    if (!isArray(raw[key])) throw new BackupError(`O campo "${key}" precisa ser uma lista.`);
  }
  const base = raw.base;
  if (!isRecord(base) || !isArray(base.slots)) throw new BackupError('O campo "base.slots" precisa ser uma lista.');

  (raw.rooms as unknown[]).forEach((r, i) => {
    need(isRecord(r) && isStr(r.id) && isStr(r.name), `Sala ${i + 1} sem id ou nome.`);
  });
  const roomIds = new Set((raw.rooms as Array<{ id: string }>).map((r) => r.id));
  (raw.dentists as unknown[]).forEach((d, i) => {
    need(isRecord(d) && isStr(d.id) && isStr(d.name) && isStr(d.roomId) && isNum(d.start) && isNum(d.end), `Dentista ${i + 1} incompleto (id, nome, sala, início e fim).`);
    need(roomIds.has((d as { roomId: string }).roomId), `Dentista "${(d as { name: string }).name}" aponta para uma sala que não existe.`);
  });
  (raw.asbs as unknown[]).forEach((a, i) => {
    need(isRecord(a) && isStr(a.id) && isStr(a.name) && isNum(a.start) && isNum(a.end), `ASB ${i + 1} incompleta (id, nome, entrada e saída).`);
  });
  const asbIds = new Set((raw.asbs as Array<{ id: string }>).map((a) => a.id));
  (base.slots as unknown[]).forEach((s, i) => {
    need(isRecord(s) && isStr(s.asbId) && isNum(s.hour) && isStr(s.kind) && SLOT_KINDS.includes(s.kind), `Ficha ${i + 1} da escala incompleta.`);
    need(asbIds.has((s as { asbId: string }).asbId), `Ficha ${i + 1} aponta para uma ASB que não existe.`);
  });
  (raw.tasks as unknown[]).forEach((t, i) => {
    need(isRecord(t) && isStr(t.id) && isStr(t.name) && isArray(t.days) && isRecord(t.assignment) && isStr(t.assignment.mode) && TASK_MODES.includes(t.assignment.mode), `Tarefa ${i + 1} incompleta.`);
    const a = (t as { assignment: { mode: string; startDate?: unknown } }).assignment;
    if (a.mode === 'rotation') need(isIso(a.startDate), `Tarefa ${i + 1} tem data de início do rodízio inválida.`);
    const hp = (t as { holdersByPeriod?: unknown }).holdersByPeriod;
    if (hp !== undefined) {
      need(isArray(hp), `Tarefa ${i + 1}: responsáveis fixos precisam ser uma lista.`);
      (hp as unknown[]).forEach((h, j) => need(isRecord(h) && isStr(h.id) && isStr(h.asbId) && isIso(h.from) && isIso(h.to) && (h.to as string) >= (h.from as string), `Tarefa ${i + 1}, responsável fixo ${j + 1} com data inválida.`));
    }
  });
  if (raw.lunchWindow !== undefined) {
    const w = raw.lunchWindow;
    need(isRecord(w) && isNum(w.start) && isNum(w.end) && (w.end as number) > (w.start as number), 'O horário de almoço é inválido.');
  }
  (raw.absences as unknown[]).forEach((a, i) => {
    need(isRecord(a) && isStr(a.id) && isStr(a.asbId) && isIso(a.from) && isIso(a.to) && isStr(a.reason), `Ausência ${i + 1} incompleta ou com data inválida.`);
  });
  (raw.rules as unknown[]).forEach((r, i) => need(typeof r === 'string', `Regra ${i + 1} precisa ser texto.`));
  if (raw.extraShifts !== undefined) {
    need(isArray(raw.extraShifts), 'O campo "extraShifts" precisa ser uma lista.');
    (raw.extraShifts as unknown[]).forEach((e, i) => need(isRecord(e) && isStr(e.id) && isStr(e.asbId) && isIso(e.date) && isNum(e.start) && isNum(e.end), `Hora extra ${i + 1} incompleta.`));
  }
  if (raw.dentistAbsences !== undefined) {
    need(isArray(raw.dentistAbsences), 'O campo "dentistAbsences" precisa ser uma lista.');
    (raw.dentistAbsences as unknown[]).forEach((a, i) => need(isRecord(a) && isStr(a.id) && isStr(a.dentistId) && isIso(a.from) && isIso(a.to), `Folga de dentista ${i + 1} incompleta.`));
  }
  if (raw.history !== undefined) {
    need(isArray(raw.history), 'O campo "history" precisa ser uma lista.');
    (raw.history as unknown[]).forEach((h, i) => need(isRecord(h) && isIso(h.until), `Registro de histórico ${i + 1} sem data.`));
  }
  if (raw.historySince !== undefined) need(isIso(raw.historySince), 'A data de início do histórico é inválida.');
  if (raw.protese !== undefined) {
    need(isArray(raw.protese), 'O campo "protese" precisa ser uma lista.');
    (raw.protese as unknown[]).forEach((p, i) => need(isRecord(p) && isStr(p.dentistId) && isStr(p.asbId) && isIso(p.since), `Registro da Prótese ${i + 1} com data inválida.`));
  }
  if (raw.closedDates !== undefined) {
    need(isArray(raw.closedDates), 'O campo "closedDates" precisa ser uma lista.');
    (raw.closedDates as unknown[]).forEach((c, i) => need(isRecord(c) && isIso(c.date) && (c.note === undefined || isStr(c.note)), `Dia fechado ${i + 1} com data inválida.`));
  }
  if (raw.dayOverrides !== undefined) {
    need(isArray(raw.dayOverrides), 'O campo "dayOverrides" precisa ser uma lista.');
    (raw.dayOverrides as unknown[]).forEach((o, i) => need(isRecord(o) && isStr(o.id) && isStr(o.asbId) && isIso(o.date) && isNum(o.hour) && isStr(o.kind) && [...SLOT_KINDS, 'livre'].includes(o.kind), `Ajuste de dia ${i + 1} incompleto.`));
  }

  const data = raw as unknown as AppData;
  return migrate(data);
}

/** Preenche campos que versões antigas do backup não tinham. */
export function migrate(data: AppData): AppData {
  const out: AppData = { ...data };
  if (typeof out.version !== 'number') out.version = CURRENT_VERSION;
  if (!Array.isArray(out.openDays) || out.openDays.length === 0) out.openDays = [1, 2, 3, 4, 5];
  if (!Array.isArray(out.protese)) out.protese = [];
  if (!Array.isArray(out.extraShifts)) out.extraShifts = [];
  if (!Array.isArray(out.dentistAbsences)) out.dentistAbsences = [];
  if (!Array.isArray(out.dayOverrides)) out.dayOverrides = [];
  if (!Array.isArray(out.history)) out.history = [];
  if (!Array.isArray(out.closedDates)) out.closedDates = [];
  out.asbs = out.asbs.map((a) => ({ ...a, active: a.active !== false, lunch: a.lunch === true }));
  return out;
}
