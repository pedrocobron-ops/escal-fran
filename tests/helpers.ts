import seedJson from '../src/data/seed.json';
import type { AppData, Absence } from '../src/domain';

/** Cópia profunda do seed para cada teste alterar à vontade. */
export function seed(): AppData {
  return structuredClone(seedJson) as AppData;
}

export const ID = {
  andrea: 'id011',
  laura: 'id012',
  pamela: 'id013',
  amanda: 'id014',
  priscila: 'id015',
  ana: 'id016',
  nicelia: 'id017',
  francisco: 'id001',
  edson: 'id009',
  drPriscila: 'id005',
  isac: 'id010',
} as const;

export function absence(partial: Partial<Absence> & Pick<Absence, 'asbId' | 'from' | 'to'>): Absence {
  return { id: `abs-${partial.asbId}-${partial.from}`, reason: 'Falta', ...partial };
}
