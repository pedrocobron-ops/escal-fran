// Camada de persistência isolada. Hoje: localStorage. Amanhã: Supabase, trocando
// só o adapter, sem mexer no resto do app.

import type { AppData } from '../domain';
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
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `escala-ceo-backup-${y}-${m}-${d}.json`;
}

export class BackupError extends Error {}

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Valida um JSON de backup. Lança BackupError com mensagem em português. */
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
