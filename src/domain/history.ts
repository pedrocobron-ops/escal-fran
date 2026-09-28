// Histórico da escala: dias passados mostram a estrutura (salas, dentistas,
// ASBs, escala base, tarefas, dias de funcionamento, regras fixas) como ela estava naquele dia.
//
// Cada registro guarda como os campos estavam até `until`. Para montar um dia D,
// parte-se da estrutura atual e aplicam-se, do mais novo para o mais antigo,
// todos os registros com `until >= D`.

import type { AppData, IsoDate, StructureKey, StructureSnapshot } from './types';
import { STRUCTURE_KEYS } from './types';
import { addDays } from './dates';

/** Estrutura valendo numa data. Sem data (escala base) ou sem histórico, devolve os dados atuais. */
export function dataForDate(data: AppData, date: IsoDate | ''): AppData {
  const hist = data.history ?? [];
  if (!date || hist.length === 0 || date > hist[hist.length - 1].until) return data;
  const out: AppData = { ...data };
  for (let i = hist.length - 1; i >= 0 && hist[i].until >= date; i--) {
    const snap = hist[i];
    for (const key of STRUCTURE_KEYS) {
      if (snap[key] !== undefined) (out as unknown as Record<string, unknown>)[key] = snap[key];
    }
  }
  return out;
}

function changedKeys(prev: AppData, next: AppData): StructureKey[] {
  return STRUCTURE_KEYS.filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]));
}

/**
 * Histórico depois de uma mudança feita em `today`. Se a estrutura mudou, guarda
 * como ela estava até ontem (só os campos alterados). Várias mudanças no mesmo dia
 * completam o mesmo registro. Nada é guardado antes de `historySince` existir e
 * ser anterior a hoje, porque não há dia passado a preservar.
 */
export function recordHistory(prev: AppData, next: AppData, today: IsoDate): StructureSnapshot[] {
  const hist = [...(next.history ?? prev.history ?? [])];
  const since = next.historySince ?? prev.historySince;
  if (!since || since >= today) return hist;
  const keys = changedKeys(prev, next);
  if (keys.length === 0) return hist;
  const yesterday = addDays(today, -1);
  const last = hist[hist.length - 1];
  if (last && last.until === yesterday) {
    const merged: StructureSnapshot = { ...last };
    for (const k of keys) {
      if (merged[k] === undefined) (merged as unknown as Record<string, unknown>)[k] = structuredClone(prev[k]);
    }
    hist[hist.length - 1] = merged;
    return hist;
  }
  const snap: StructureSnapshot = { until: yesterday };
  for (const k of keys) (snap as unknown as Record<string, unknown>)[k] = structuredClone(prev[k]);
  hist.push(snap);
  return hist;
}

/** Procura uma ASB pelo id na estrutura atual e em todo o histórico (quem foi removida continua com nome). */
export function findAsbAnywhere(data: AppData, id: string) {
  return data.asbs.find((a) => a.id === id) ?? [...(data.history ?? [])].reverse().flatMap((h) => h.asbs ?? []).find((a) => a.id === id);
}

export function findDentistAnywhere(data: AppData, id: string) {
  return data.dentists.find((d) => d.id === id) ?? [...(data.history ?? [])].reverse().flatMap((h) => h.dentists ?? []).find((d) => d.id === id);
}
