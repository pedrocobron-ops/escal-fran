// Camada de persistência isolada. Hoje: localStorage. Amanhã: Supabase, trocando
// só o adapter, sem mexer no resto do app.

import type { AppData } from '../domain';
import { todayIso } from '../domain';
import seedJson from '../data/seed.json';

export const STORAGE_KEY = 'escala-ceo:data';
export const CURRENT_VERSION = 1;

/** Contrato que qualquer backend precisa cumprir. */
export interface StorageAdapter {
  load(): Promise<AppData | null>;
  save(data: AppData): Promise<void>;
  clear(): Promise<void>;
}

export function seedData(): AppData {
  return structuredClone(seedJson) as AppData;
}

export class LocalStorageAdapter implements StorageAdapter {
  constructor(private readonly key: string = STORAGE_KEY, private readonly store: Storage = window.localStorage) {}

  async load(): Promise<AppData | null> {
    const raw = this.store.getItem(this.key);
    if (!raw) return null;
    try {
      return parseBackup(raw);
    } catch {
      return null;
    }
  }

  async save(data: AppData): Promise<void> {
    this.store.setItem(this.key, JSON.stringify(data));
  }

  async clear(): Promise<void> {
    this.store.removeItem(this.key);
  }
}

/** Adapter em memória, útil em testes. */
export class MemoryAdapter implements StorageAdapter {
  private data: AppData | null = null;
  async load() {
    return this.data ? structuredClone(this.data) : null;
  }
  async save(data: AppData) {
    this.data = structuredClone(data);
  }
  async clear() {
    this.data = null;
  }
}

/** Carrega o que está salvo ou, no primeiro uso, o seed. */
export async function loadInitial(adapter: StorageAdapter): Promise<{ data: AppData; fromSeed: boolean }> {
  const saved = await adapter.load();
  if (saved) return { data: migrate(saved), fromSeed: false };
  return { data: seedData(), fromSeed: true };
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
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
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
  });
  (raw.absences as unknown[]).forEach((a, i) => {
    need(isRecord(a) && isStr(a.id) && isStr(a.asbId) && isIso(a.from) && isIso(a.to) && isStr(a.reason), `Ausência ${i + 1} incompleta.`);
  });
  (raw.rules as unknown[]).forEach((r, i) => need(typeof r === 'string', `Regra ${i + 1} precisa ser texto.`));

  const data = raw as unknown as AppData;
  return migrate(data);
}

/** Preenche campos que versões antigas do backup não tinham. */
export function migrate(data: AppData): AppData {
  const out: AppData = { ...data };
  if (typeof out.version !== 'number') out.version = CURRENT_VERSION;
  if (!Array.isArray(out.openDays) || out.openDays.length === 0) out.openDays = [1, 2, 3, 4, 5];
  if (!Array.isArray(out.protese)) out.protese = [];
  out.asbs = out.asbs.map((a) => ({ ...a, active: a.active !== false, lunch: a.lunch === true }));
  return out;
}
