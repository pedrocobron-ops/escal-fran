import { describe, expect, it } from 'vitest';
import { BackupError, MemoryAdapter, exportBackup, loadInitial, migrate, parseBackup, seedData } from '../src/store/storage';
import { removeAsb, setSlots, removeSlot } from '../src/store/useStore';
import { ID, seed } from './helpers';

describe('persistência', () => {
  it('no primeiro uso carrega o seed', async () => {
    const { data, fromSeed } = await loadInitial(new MemoryAdapter());
    expect(fromSeed).toBe(true);
    expect(data!.asbs).toHaveLength(7);
    expect(data!.base.slots).toHaveLength(seed().base.slots.length);
  });

  it('depois de salvar, carrega o que foi salvo', async () => {
    const adapter = new MemoryAdapter();
    const d = seedData();
    d.rules.push('Regra nova');
    await adapter.save(d);
    const { data, fromSeed } = await loadInitial(adapter);
    expect(fromSeed).toBe(false);
    expect(data!.rules).toContain('Regra nova');
  });

  it('exporta e importa backup sem perder nada', () => {
    const d = seedData();
    const json = exportBackup(d);
    expect(parseBackup(json)).toEqual({ ...d, protese: [], extraShifts: [], dentistAbsences: [], dayOverrides: [], history: [], closedDates: [] });
  });

  it('rejeita backup inválido com mensagem em português', () => {
    expect(() => parseBackup('{ não é json')).toThrow(BackupError);
    expect(() => parseBackup('{ "rooms": [] }')).toThrow(/não tem o campo/);
    expect(() => parseBackup('[]')).toThrow(/formato de backup/);
  });

  it('migra backups sem openDays e protese', () => {
    const d = seedData() as Partial<ReturnType<typeof seedData>>;
    delete d.openDays;
    delete d.protese;
    const m = migrate(d as ReturnType<typeof seedData>);
    expect(m.openDays).toEqual([1, 2, 3, 4, 5]);
    expect(m.protese).toEqual([]);
  });
});

describe('operações do quadro', () => {
  it('setSlots preenche em faixa só dentro do contrato', () => {
    const d = seed();
    const n = setSlots(d, ID.andrea, [11, 12, 13, 14], { kind: 'sala', roomId: 's2' }); // Andrea sai às 13h
    expect(n).toBe(2);
    const mine = d.base.slots.filter((s) => s.asbId === ID.andrea && s.hour >= 11);
    expect(mine).toEqual([
      { asbId: ID.andrea, hour: 11, kind: 'sala', roomId: 's2' },
      { asbId: ID.andrea, hour: 12, kind: 'sala', roomId: 's2' },
    ]);
  });

  it('removeSlot tira só aquele bloco', () => {
    const d = seed();
    removeSlot(d, ID.laura, 12);
    expect(d.base.slots.filter((s) => s.asbId === ID.laura)).toHaveLength(8);
  });

  it('removeAsb limpa fichas, rodízios, lista fixa e substituições', () => {
    const d = seed();
    d.absences.push({ id: 'x', asbId: ID.laura, from: '2026-09-14', to: '2026-09-14', reason: 'Falta', substitute: { asbId: ID.ana } });
    removeAsb(d, ID.ana);
    expect(d.asbs.find((a) => a.id === ID.ana)).toBeUndefined();
    expect(d.base.slots.some((s) => s.asbId === ID.ana)).toBe(false);
    const fixed = d.tasks.find((t) => t.id === 'id024')!.assignment;
    expect(fixed.mode === 'fixed' && fixed.asbIds).toEqual([ID.priscila]);
    const rot = d.tasks.find((t) => t.id === 'id025')!.assignment;
    expect(rot.mode === 'rotation' && rot.order.includes(ID.ana)).toBe(false);
    expect(d.absences[0].substitute).toBeUndefined();
  });
});

describe('dados salvos com problema nunca são substituídos', () => {
  it('ausência com ano de 5 dígitos: carrega em modo de recuperação, sem gravar o seed por cima', async () => {
    const { loadInitial, MemoryAdapter, repairBackup } = await import('../src/store/storage');
    const d = seedData();
    d.absences.push({ id: 'ruim', asbId: 'id012', from: '2026-09-28', to: '20266-09-28', reason: 'Folga' });
    d.absences.push({ id: 'boa', asbId: 'id013', from: '2026-09-28', to: '2026-09-29', reason: 'Férias' });
    const adapter = new MemoryAdapter();
    adapter.raw = JSON.stringify(d);
    const r = await loadInitial(adapter);
    expect(r.data).toBeNull();
    expect(r.recovery?.error).toContain('Ausência 1');
    expect(adapter.raw).toBe(JSON.stringify(d)); // intocado
    const rep = repairBackup(r.recovery!.raw);
    expect(rep.data.absences.map((a) => a.id)).toEqual(['boa']);
    expect(rep.removed).toEqual(['ausência com dados inválidos']);
  });

  it('rodízio com data de início inválida é recusado e reparado para hoje', async () => {
    const { repairBackup } = await import('../src/store/storage');
    const d = seedData();
    const t = d.tasks.find((x) => x.assignment.mode === 'rotation')!;
    (t.assignment as { startDate: string }).startDate = '0202-01-01';
    expect(() => parseBackup(JSON.stringify(d))).toThrow(/rodízio/);
    const rep = repairBackup(JSON.stringify(d));
    expect(rep.removed[0]).toContain('data de início do rodízio');
  });

  it('texto que nem é JSON não pode ser reparado, mas continua salvo', async () => {
    const { loadInitial, MemoryAdapter, repairBackup } = await import('../src/store/storage');
    const adapter = new MemoryAdapter();
    adapter.raw = '{quebrado';
    const r = await loadInitial(adapter);
    expect(r.recovery?.raw).toBe('{quebrado');
    expect(() => repairBackup('{quebrado')).toThrow(BackupError);
  });
});
