import { create } from 'zustand';
import type { AppData, DaySlot, DaySlotKind, Id, IsoDate, Slot, SlotKind } from '../domain';
import { canAssign, nextProteseRecords, todayIso } from '../domain';
import { loadInitial, seedData, type StorageAdapter } from './storage';

const HISTORY_LIMIT = 100;
export const LAST_BACKUP_KEY = 'escala-ceo:last-backup';
export const FIRST_CHANGE_KEY = 'escala-ceo:first-change';

export type Mutator = (draft: AppData) => void;

interface StoreState {
  data: AppData | null;
  loaded: boolean;
  /** Hora do último salvamento, ex.: "14:32". */
  savedAt: string | null;
  saving: boolean;
  saveError: string | null;
  past: AppData[];
  future: AppData[];
  adapter: StorageAdapter | null;
  /** Data ISO do último backup exportado neste navegador. */
  lastBackupAt: IsoDate | null;
  /** Data ISO da primeira mudança feita neste navegador (para o lembrete de backup). */
  firstChangeAt: IsoDate | null;

  init(adapter: StorageAdapter): Promise<void>;
  /** Aplica uma mutação com desfazer/refazer e salva. */
  apply(mutator: Mutator): void;
  /** Substitui todos os dados (importar backup, voltar ao seed). */
  replace(data: AppData): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  resetToSeed(): void;
  markBackup(): void;
}

function readKey(key: string): IsoDate | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // sem localStorage: fica só em memória
  }
}

function clock(now: Date = new Date()): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export const useStore = create<StoreState>((set, get) => {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleSave(data: AppData) {
    const { adapter } = get();
    if (!adapter) return;
    if (saveTimer) clearTimeout(saveTimer);
    set({ saving: true });
    saveTimer = setTimeout(async () => {
      try {
        await adapter.save(data);
        set({ savedAt: clock(), saving: false, saveError: null });
      } catch (e) {
        set({ saving: false, saveError: e instanceof Error ? e.message : 'Não foi possível salvar.' });
      }
    }, 150);
  }

  function commit(next: AppData, opts: { pushHistory: boolean }) {
    const { data, past, firstChangeAt } = get();
    if (!firstChangeAt) {
      const today = todayIso();
      writeKey(FIRST_CHANGE_KEY, today);
      set({ firstChangeAt: today });
    }
    set({
      data: next,
      past: opts.pushHistory && data ? [...past.slice(-(HISTORY_LIMIT - 1)), data] : past,
      future: opts.pushHistory ? [] : get().future,
    });
    scheduleSave(next);
  }

  return {
    data: null,
    loaded: false,
    savedAt: null,
    saving: false,
    saveError: null,
    past: [],
    future: [],
    adapter: null,
    lastBackupAt: readKey(LAST_BACKUP_KEY),
    firstChangeAt: readKey(FIRST_CHANGE_KEY),

    async init(adapter) {
      const { data, fromSeed } = await loadInitial(adapter);
      data.protese = nextProteseRecords(data, todayIso());
      set({ adapter, data, loaded: true, past: [], future: [] });
      if (fromSeed) scheduleSave(data);
    },

    apply(mutator) {
      const { data } = get();
      if (!data) return;
      const next = structuredClone(data);
      mutator(next);
      commit(next, { pushHistory: true });
    },

    replace(data) {
      const next = structuredClone(data);
      next.protese = nextProteseRecords(next, todayIso());
      commit(next, { pushHistory: true });
    },

    undo() {
      const { past, data, future } = get();
      if (past.length === 0 || !data) return;
      const prev = past[past.length - 1];
      set({ data: prev, past: past.slice(0, -1), future: [data, ...future] });
      scheduleSave(prev);
    },

    redo() {
      const { past, data, future } = get();
      if (future.length === 0 || !data) return;
      const next = future[0];
      set({ data: next, past: [...past, data], future: future.slice(1) });
      scheduleSave(next);
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    resetToSeed() {
      get().replace(seedData());
    },

    markBackup() {
      const today = todayIso();
      writeKey(LAST_BACKUP_KEY, today);
      set({ lastBackupAt: today });
    },
  };
});

/** Seletor seguro: os dados só existem depois de `init`. */
export function useData(): AppData {
  const data = useStore((s) => s.data);
  if (!data) throw new Error('Dados ainda não carregados.');
  return data;
}

// ---- Operações de escala base (usadas pelo Quadro) ----

export interface CellTarget {
  kind: SlotKind;
  roomId?: Id;
}

/**
 * Coloca a ASB nessas horas. Por padrão substitui o que ela tinha na hora;
 * com `additive` mantém as outras salas (uma ASB cobrindo duas salas) e só
 * troca almoço. Ignora horas fora do contrato.
 */
export function setSlots(draft: AppData, asbId: Id, hours: number[], target: CellTarget, opts: { additive?: boolean } = {}): number {
  const asb = draft.asbs.find((a) => a.id === asbId);
  if (!asb) return 0;
  const valid = hours.filter((h) => canAssign(asb, h));
  if (valid.length === 0) return 0;
  const set = new Set(valid);
  draft.base.slots = draft.base.slots.filter((s) => {
    if (s.asbId !== asbId || !set.has(s.hour)) return true;
    if (!opts.additive) return false;
    // aditivo: some o que é igual ao destino, o almoço e o apoio; salas diferentes ficam
    if (s.kind === target.kind && s.roomId === target.roomId) return false;
    return s.kind === 'sala' && target.kind === 'sala';
  });
  for (const hour of valid) {
    const slot: Slot = { asbId, hour, kind: target.kind };
    if (target.kind === 'sala') slot.roomId = target.roomId;
    draft.base.slots.push(slot);
  }
  draft.base.slots.sort((a, b) => a.hour - b.hour || a.asbId.localeCompare(b.asbId));
  return valid.length;
}

// ---- Ajustes de um dia (Modo Dia) ----

/** Define exatamente o que a ASB faz nessas horas nessa data. `entries` vazio = livre. */
export function setDaySlots(draft: AppData, date: IsoDate, asbId: Id, hours: number[], entries: CellTarget[]): void {
  const set = new Set(hours);
  draft.dayOverrides = (draft.dayOverrides ?? []).filter((o) => !(o.date === date && o.asbId === asbId && set.has(o.hour)));
  for (const hour of hours) {
    if (entries.length === 0) {
      draft.dayOverrides.push({ id: newId('dia'), date, asbId, hour, kind: 'livre' });
      continue;
    }
    for (const e of entries) {
      const o: DaySlot = { id: newId('dia'), date, asbId, hour, kind: e.kind as DaySlotKind };
      if (e.kind === 'sala') o.roomId = e.roomId;
      draft.dayOverrides.push(o);
    }
  }
}

export function clearDayOverrides(draft: AppData, date: IsoDate): void {
  draft.dayOverrides = (draft.dayOverrides ?? []).filter((o) => o.date !== date);
}

export function hasDayOverrides(data: AppData, date: IsoDate): boolean {
  return (data.dayOverrides ?? []).some((o) => o.date === date);
}

export function removeSlot(draft: AppData, asbId: Id, hour: number): void {
  draft.base.slots = draft.base.slots.filter((s) => !(s.asbId === asbId && s.hour === hour));
}

/** Remove só um slot específico (a ASB pode ter mais de um na mesma hora). */
export function removeSlotAt(draft: AppData, asbId: Id, hour: number, kind: SlotKind, roomId?: Id): void {
  draft.base.slots = draft.base.slots.filter((s) => !(s.asbId === asbId && s.hour === hour && s.kind === kind && (kind !== 'sala' || s.roomId === roomId)));
}

export function clearSchedule(draft: AppData): void {
  draft.base.slots = [];
}

/** Remove uma ASB e todas as referências a ela. */
export function removeAsb(draft: AppData, asbId: Id): void {
  draft.asbs = draft.asbs.filter((a) => a.id !== asbId);
  draft.base.slots = draft.base.slots.filter((s) => s.asbId !== asbId);
  draft.absences = draft.absences
    .filter((a) => a.asbId !== asbId)
    .map((a) => (a.substitute && 'asbId' in a.substitute && a.substitute.asbId === asbId ? { ...a, substitute: undefined } : a));
  draft.tasks = draft.tasks.map((t) => {
    const a = t.assignment;
    if (a.mode === 'rotation') return { ...t, assignment: { ...a, order: a.order.filter((id) => id !== asbId) } };
    if (a.mode === 'fixed') return { ...t, assignment: { ...a, asbIds: a.asbIds.filter((id) => id !== asbId) } };
    return t;
  });
  draft.protese = (draft.protese ?? []).filter((p) => p.asbId !== asbId);
  draft.extraShifts = (draft.extraShifts ?? []).filter((e) => e.asbId !== asbId);
  draft.dayOverrides = (draft.dayOverrides ?? []).filter((o) => o.asbId !== asbId);
}

export function removeDentist(draft: AppData, dentistId: Id): void {
  draft.dentists = draft.dentists.filter((d) => d.id !== dentistId);
  draft.tasks = draft.tasks.filter((t) => !(t.assignment.mode === 'dentist' && t.assignment.dentistId === dentistId));
  draft.protese = (draft.protese ?? []).filter((p) => p.dentistId !== dentistId);
  draft.dentistAbsences = (draft.dentistAbsences ?? []).filter((a) => a.dentistId !== dentistId);
}

export function removeRoom(draft: AppData, roomId: Id): void {
  draft.rooms = draft.rooms.filter((r) => r.id !== roomId);
  draft.base.slots = draft.base.slots.filter((s) => !(s.kind === 'sala' && s.roomId === roomId));
  draft.dayOverrides = (draft.dayOverrides ?? []).filter((o) => !(o.kind === 'sala' && o.roomId === roomId));
  for (const d of draft.dentists.filter((x) => x.roomId === roomId)) removeDentist(draft, d.id);
  draft.tasks = draft.tasks.filter((t) => !(t.assignment.mode === 'room' && t.assignment.roomId === roomId));
}

export function newId(prefix = 'id'): Id {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rnd}`;
}

export function isoOrToday(d?: IsoDate): IsoDate {
  return d ?? todayIso();
}
