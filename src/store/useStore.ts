import { create } from 'zustand';
import type { Absence, AppData, DaySlot, DaySlotKind, Id, IsoDate, Slot, SlotKind } from '../domain';
import { addDays, canAssign, nextProteseRecords, recordHistory, todayIso } from '../domain';
import { loadInitial, seedData, type StorageAdapter } from './storage';

// Passos de desfazer guardados em memória (cada um é uma cópia inteira dos dados).
const HISTORY_LIMIT = 50;
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

  init(adapter: StorageAdapter, opts?: { blocked?: boolean }): Promise<void>;
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
  /** Grava na hora o que estiver pendente (ao fechar ou esconder a página). */
  flush(): void;
  /** O navegador garantiu armazenamento persistente? null = não suportado ou ainda não pedido. */
  persisted: boolean | null;
  /** Dados salvos com problema: o app não carrega nada por cima até a pessoa decidir. */
  recovery: { raw: string; error: string } | null;
  /** Sai da recuperação usando estes dados (reparados, importados ou a escala inicial), guardando antes uma cópia do que estava salvo. */
  resolveRecovery(data: AppData): Promise<void>;
  /** Primeira abertura neste navegador (nada salvo): começou pela escala inicial. */
  firstUse: boolean;
  /** O navegador bloqueia o armazenamento: nada fica salvo ao fechar. */
  storageBlocked: boolean;
  /** Hora em que esta aba recebeu mudanças feitas em outra aba. */
  externalUpdateAt: string | null;
  /** A última mudança feita aqui foi trocada pela da outra aba (as duas no mesmo instante). */
  externalLostLocal: boolean;
  dismissNotice(which: 'firstUse' | 'externalUpdateAt'): void;
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

/** Próximos registros da Prótese sem derrubar a abertura se algum registro salvo estiver estranho. */
function safeProtese(data: AppData): AppData['protese'] {
  try {
    return nextProteseRecords(data, todayIso());
  } catch {
    return data.protese ?? [];
  }
}

export const useStore = create<StoreState>((set, get) => {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let pending: AppData | null = null;
  // Estados que vieram de "substituir tudo" (importar backup, voltar à escala inicial).
  // Desfazer um desses devolve também o histórico de antes; nos outros, o histórico segue a linha do tempo.
  const replacedStates = new WeakSet<AppData>();

  async function saveNow(data: AppData) {
    const { adapter } = get();
    if (!adapter) return;
    try {
      await adapter.save(data);
      set({ savedAt: clock(), saving: false, saveError: null });
    } catch (e) {
      const quota = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22);
      set({
        saving: false,
        saveError: quota
          ? 'o armazenamento do navegador está cheio. Exporte um backup em Ajustes.'
          : e instanceof Error ? e.message : 'Não foi possível salvar.',
      });
    }
  }

  function scheduleSave(data: AppData) {
    const { adapter } = get();
    if (!adapter) return;
    if (saveTimer) clearTimeout(saveTimer);
    pending = data;
    set({ saving: true });
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const d = pending;
      pending = null;
      if (d) void saveNow(d);
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
    persisted: null,
    recovery: null,
    firstUse: false,
    storageBlocked: false,
    externalUpdateAt: null,
    externalLostLocal: false,

    dismissNotice(which) {
      set(which === 'firstUse' ? { firstUse: false } : { externalUpdateAt: null, externalLostLocal: false });
    },

    async init(adapter, opts = {}) {
      set({ storageBlocked: !!opts.blocked });
      const loaded = await loadInitial(adapter);
      if (loaded.recovery) {
        set({ adapter, data: null, loaded: true, recovery: loaded.recovery });
        return;
      }
      const { data, fromSeed } = loaded;
      data.protese = safeProtese(data);
      const newSince = !data.historySince;
      if (newSince) data.historySince = todayIso();
      set({ adapter, data, loaded: true, past: [], future: [], firstUse: fromSeed });
      if (fromSeed || newSince) scheduleSave(data);
      // Outra aba gravou: esta aba passa a mostrar o que foi gravado, em vez de apagar
      // aquilo na próxima mudança. O desfazer desta aba é zerado para não voltar por cima.
      adapter.subscribe?.((external) => {
        // Se havia uma mudança daqui ainda sendo gravada, ela é trocada pela da outra aba: avisa.
        const lostLocal = pending !== null;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = null;
        pending = null;
        set({ data: external, past: [], future: [], saving: false, externalUpdateAt: clock(), externalLostLocal: lostLocal });
      });
      // Pede ao navegador para não apagar os dados sozinho (quando ele permite).
      try {
        const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
        if (storage?.persist) {
          const already = storage.persisted ? await storage.persisted() : false;
          set({ persisted: already || (await storage.persist()) });
        }
      } catch {
        set({ persisted: null });
      }
    },

    apply(mutator) {
      const { data } = get();
      if (!data) return;
      const next = structuredClone(data);
      mutator(next);
      // Guarda como a estrutura estava até ontem, para os dias passados não mudarem.
      next.history = recordHistory(data, next, todayIso());
      commit(next, { pushHistory: true });
    },

    replace(data) {
      const next = structuredClone(data);
      next.protese = safeProtese(next);
      if (!next.historySince) next.historySince = todayIso();
      replacedStates.add(next);
      commit(next, { pushHistory: true });
    },

    async resolveRecovery(data) {
      const { adapter, recovery } = get();
      if (!adapter) return;
      if (recovery) await adapter.keepCopy(recovery.raw);
      const next = structuredClone(data);
      next.protese = safeProtese(next);
      if (!next.historySince) next.historySince = todayIso();
      set({ data: next, recovery: null, past: [], future: [] });
      await saveNow(next);
    },

    flush() {
      if (!saveTimer || !pending) return;
      clearTimeout(saveTimer);
      saveTimer = null;
      const d = pending;
      pending = null;
      void saveNow(d);
    },

    // Desfazer e refazer contam como mudanças de hoje: o histórico parte do atual, para
    // um desfazer feito no dia seguinte não apagar como o dia anterior ficou. A exceção é
    // desfazer uma importação ou a volta à escala inicial: aí o histórico de antes volta inteiro.
    undo() {
      const { past, data, future } = get();
      if (past.length === 0 || !data) return;
      const target = past[past.length - 1];
      let prev: AppData;
      if (replacedStates.has(data)) prev = target; // volta tudo como estava antes, histórico inclusive
      else {
        prev = { ...target, history: data.history, historySince: data.historySince };
        prev.history = recordHistory(data, prev, todayIso());
      }
      set({ data: prev, past: past.slice(0, -1), future: [data, ...future] });
      scheduleSave(prev);
    },

    redo() {
      const { past, data, future } = get();
      if (future.length === 0 || !data) return;
      const target = future[0];
      let next: AppData;
      if (replacedStates.has(target)) next = target;
      else {
        next = { ...target, history: data.history, historySince: data.historySince };
        next.history = recordHistory(data, next, todayIso());
      }
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
    // aditivo: some o que é igual ao destino, o almoço e o apoio geral; outras salas ficam
    if (s.kind === target.kind && s.roomId === target.roomId) return false;
    const targetIsRoom = target.kind === 'sala' || (target.kind === 'apoio' && !!target.roomId);
    return targetIsRoom && s.kind === 'sala' && s.roomId !== target.roomId;
  });
  for (const hour of valid) {
    const slot: Slot = { asbId, hour, kind: target.kind };
    if (target.roomId && (target.kind === 'sala' || target.kind === 'apoio')) slot.roomId = target.roomId;
    draft.base.slots.push(slot);
  }
  draft.base.slots.sort((a, b) => a.hour - b.hour || a.asbId.localeCompare(b.asbId));
  return valid.length;
}

/**
 * Define exatamente onde a ASB fica nessa hora da escala base (lista vazia = livre).
 * Horas fora do contrato são ignoradas.
 */
export function setBaseAt(draft: AppData, asbId: Id, hour: number, entries: CellTarget[]): void {
  const asb = draft.asbs.find((a) => a.id === asbId);
  if (!asb || !canAssign(asb, hour)) return;
  draft.base.slots = draft.base.slots.filter((s) => !(s.asbId === asbId && s.hour === hour));
  const seen = new Set<string>();
  for (const e of entries) {
    const key = `${e.kind}:${e.roomId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const slot: Slot = { asbId, hour, kind: e.kind };
    if (e.roomId && (e.kind === 'sala' || e.kind === 'apoio')) slot.roomId = e.roomId;
    draft.base.slots.push(slot);
  }
  draft.base.slots.sort((a, b) => a.hour - b.hour || a.asbId.localeCompare(b.asbId));
}

/** Onde a ASB está nessa hora na escala base. */
export function baseEntriesAt(data: AppData, asbId: Id, hour: number): CellTarget[] {
  return data.base.slots.filter((s) => s.asbId === asbId && s.hour === hour).map((s) => ({ kind: s.kind, roomId: s.roomId }));
}

/**
 * Registra uma hora extra de um bloco (hour até hour+1) na data. Junta com uma hora
 * extra da mesma ASB que termine ou comece encostada, para não picar o registro.
 */
export function addExtraHour(draft: AppData, asbId: Id, date: IsoDate, hour: number, note = 'Pelo quadro'): void {
  const list = draft.extraShifts ?? (draft.extraShifts = []);
  // Só junta com outra hora extra registrada pelo quadro (as do formulário ficam como foram feitas).
  const before = list.find((e) => e.fromBoard && e.asbId === asbId && e.date === date && e.end === hour);
  const after = list.find((e) => e.fromBoard && e.asbId === asbId && e.date === date && e.start === hour + 1);
  if (before && after && before !== after) {
    before.end = after.end;
    draft.extraShifts = list.filter((e) => e !== after);
  } else if (before) before.end = hour + 1;
  else if (after) after.start = hour;
  else list.push({ id: newId('hx'), asbId, date, start: hour, end: hour + 1, note, fromBoard: true });
}

// ---- Ajustes de um dia (Modo Dia) ----

/**
 * Define exatamente o que a ASB faz nessas horas nessa data. `entries` vazio = livre.
 * `hold`: foi tirada à mão de uma cobertura automática; o app não a usa para cobrir nesse horário.
 */
export function setDaySlots(draft: AppData, date: IsoDate, asbId: Id, hours: number[], entries: CellTarget[], opts: { hold?: boolean } = {}): void {
  const set = new Set(hours);
  draft.dayOverrides = (draft.dayOverrides ?? []).filter((o) => !(o.date === date && o.asbId === asbId && set.has(o.hour)));
  for (const hour of hours) {
    if (entries.length === 0) {
      draft.dayOverrides.push({ id: newId('dia'), date, asbId, hour, kind: 'livre', ...(opts.hold ? { hold: true } : {}) });
      continue;
    }
    for (const e of entries) {
      const o: DaySlot = { id: newId('dia'), date, asbId, hour, kind: e.kind as DaySlotKind, ...(opts.hold ? { hold: true } : {}) };
      if (e.roomId && (e.kind === 'sala' || e.kind === 'apoio')) o.roomId = e.roomId;
      draft.dayOverrides.push(o);
    }
  }
}

/** Tira os ajustes da data e as horas extras registradas pelo quadro nela. */
export function clearDayOverrides(draft: AppData, date: IsoDate): void {
  draft.dayOverrides = (draft.dayOverrides ?? []).filter((o) => o.date !== date);
  draft.extraShifts = (draft.extraShifts ?? []).filter((e) => !(e.fromBoard && e.date === date));
}

/** Horas extras registradas pelo quadro numa data. */
export function boardExtrasOn(data: AppData, date: IsoDate) {
  return (data.extraShifts ?? []).filter((e) => e.fromBoard && e.date === date);
}

export function hasDayOverrides(data: AppData, date: IsoDate): boolean {
  return (data.dayOverrides ?? []).some((o) => o.date === date) || boardExtrasOn(data, date).length > 0;
}

export function removeSlot(draft: AppData, asbId: Id, hour: number): void {
  draft.base.slots = draft.base.slots.filter((s) => !(s.asbId === asbId && s.hour === hour));
}

/** Remove só um slot específico (a ASB pode ter mais de um na mesma hora). */
export function removeSlotAt(draft: AppData, asbId: Id, hour: number, kind: SlotKind, roomId?: Id): void {
  draft.base.slots = draft.base.slots.filter((s) => !(s.asbId === asbId && s.hour === hour && s.kind === kind && (s.roomId ?? '') === (roomId ?? '')));
}

export function clearSchedule(draft: AppData): void {
  draft.base.slots = [];
}

/**
 * Tira do período que ainda vai acontecer (a partir de `today`). Registros só do
 * passado ficam, para os dias passados continuarem mostrando o que aconteceu.
 * Sem `today`, remove tudo.
 */
function keepPast<T extends { from: IsoDate; to: IsoDate }>(list: T[], match: (x: T) => boolean, today?: IsoDate): T[] {
  const out: T[] = [];
  for (const x of list) {
    if (!match(x)) out.push(x);
    else if (today && x.to < today) out.push(x);
    else if (today && x.from < today) out.push({ ...x, to: addDays(today, -1) });
  }
  return out;
}

/** Remove uma ASB e as referências a ela. Com `today`, preserva o que já passou. */
export function removeAsb(draft: AppData, asbId: Id, today?: IsoDate): void {
  draft.asbs = draft.asbs.filter((a) => a.id !== asbId);
  draft.base.slots = draft.base.slots.filter((s) => s.asbId !== asbId);
  // Ausências em que ela é substituta: o passado continua com ela; de hoje em diante, sem substituta.
  const absences: Absence[] = [];
  for (const a of keepPast(draft.absences, (x) => x.asbId === asbId, today)) {
    const subIsHer = !!a.substitute && 'asbId' in a.substitute && a.substitute.asbId === asbId;
    if (!subIsHer || (today && a.to < today)) absences.push(a);
    else if (today && a.from < today) {
      absences.push({ ...a, to: addDays(today, -1) });
      absences.push({ ...a, id: newId('abs'), from: today, substitute: undefined });
    } else absences.push({ ...a, substitute: undefined });
  }
  draft.absences = absences;
  draft.tasks = draft.tasks.map((t) => {
    const a = t.assignment;
    if (a.mode === 'rotation') return { ...t, assignment: { ...a, order: a.order.filter((id) => id !== asbId) } };
    if (a.mode === 'fixed') return { ...t, assignment: { ...a, asbIds: a.asbIds.filter((id) => id !== asbId) } };
    return t;
  });
  draft.protese = (draft.protese ?? []).filter((p) => p.asbId !== asbId);
  draft.extraShifts = (draft.extraShifts ?? []).filter((e) => e.asbId !== asbId || (today !== undefined && e.date < today));
  draft.dayOverrides = (draft.dayOverrides ?? []).filter((o) => o.asbId !== asbId || (today !== undefined && o.date < today));
}

export function removeDentist(draft: AppData, dentistId: Id, today?: IsoDate): void {
  draft.dentists = draft.dentists.filter((d) => d.id !== dentistId);
  draft.tasks = draft.tasks.filter((t) => !(t.assignment.mode === 'dentist' && t.assignment.dentistId === dentistId));
  draft.protese = (draft.protese ?? []).filter((p) => p.dentistId !== dentistId);
  draft.dentistAbsences = keepPast(draft.dentistAbsences ?? [], (a) => a.dentistId === dentistId, today);
}

export function removeRoom(draft: AppData, roomId: Id, today?: IsoDate): void {
  draft.rooms = draft.rooms.filter((r) => r.id !== roomId);
  draft.base.slots = draft.base.slots.filter((s) => s.roomId !== roomId);
  draft.dayOverrides = (draft.dayOverrides ?? []).filter((o) => o.roomId !== roomId || (today !== undefined && o.date < today));
  for (const d of draft.dentists.filter((x) => x.roomId === roomId)) removeDentist(draft, d.id, today);
  draft.tasks = draft.tasks.filter((t) => !(t.assignment.mode === 'room' && t.assignment.roomId === roomId));
}

export function newId(prefix = 'id'): Id {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rnd}`;
}

export function isoOrToday(d?: IsoDate): IsoDate {
  return d ?? todayIso();
}
