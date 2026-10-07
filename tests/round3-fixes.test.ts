// Correções da 3ª rodada de testes (revisão final).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppData } from '../src/domain';
import { adjustedSlotCount, dataForDate, monthRotation, recordHistory, resolveTask, rotationTasksInMonth, validExtraShiftsBetween } from '../src/domain';
import { addExtraHour, baseEntriesAt, clearDayOverrides, removeAsb, useStore } from '../src/store/useStore';
import { MemoryAdapter, parseBackup, repairBackup, seedData } from '../src/store/storage';
import { placeInBase } from '../src/ui/board/placement';
import { dayPdfModel } from '../src/pdf/model';
import { ID, absence, seed } from './helpers';

function change(prev: AppData, today: string, mutate: (d: AppData) => void): AppData {
  const next = structuredClone(prev);
  mutate(next);
  next.history = recordHistory(prev, next, today);
  return next;
}

describe('desfazer importação ou volta à escala inicial', () => {
  afterEach(() => vi.useRealTimers());

  it('devolve também o histórico dos dias passados', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 28, 9));
    const adapter = new MemoryAdapter();
    const d0 = seed();
    d0.historySince = '2026-09-01';
    adapter.raw = JSON.stringify(d0);
    await useStore.getState().init(adapter);
    useStore.getState().apply((x) => { x.base.slots = x.base.slots.filter((s) => !(s.asbId === ID.nicelia && s.hour >= 16)); });
    const before = useStore.getState().data!;
    expect(before.history).toHaveLength(1);
    useStore.getState().replace(seedData());
    expect(useStore.getState().data!.history ?? []).toHaveLength(0);
    useStore.getState().undo();
    const after = useStore.getState().data!;
    expect(after.history).toEqual(before.history);
    expect(after.historySince).toBe('2026-09-01');
    // e refazer volta a importação como estava
    useStore.getState().redo();
    expect(useStore.getState().data!.history ?? []).toHaveLength(0);
  });
});

describe('quadro: ficha arrastada do quadro move para sala livre; para sala ocupada vira apoio e fica', () => {
  it('mover tira da origem; acrescentar como apoio mantém a origem', () => {
    const d = seed();
    // Laura: Sala 1 às 09h e 10h. Move a ficha das 09h para a Sala 2 às 10h (sala livre às 10h? Priscila está; então apoio, origem fica).
    placeInBase(d, { asbId: ID.laura, hours: [10], target: { kind: 'apoio', roomId: 's2' }, mode: 'add', orig: { hour: 9, kind: 'sala', roomId: 's1' } });
    expect(baseEntriesAt(d, ID.laura, 9).map((e) => e.roomId)).toEqual(['s1']);
    expect(baseEntriesAt(d, ID.laura, 10).map((e) => `${e.kind}:${e.roomId}`).sort()).toEqual(['apoio:s2', 'sala:s1']);
    // Move para uma sala livre: sai de onde estava
    placeInBase(d, { asbId: ID.laura, hours: [9], target: { kind: 'sala', roomId: 's2' }, mode: 'move', orig: { hour: 9, kind: 'sala', roomId: 's1' } });
    expect(baseEntriesAt(d, ID.laura, 9).map((e) => `${e.kind}:${e.roomId}`)).toEqual(['sala:s2']);
  });
});

describe('horas extras pelo quadro', () => {
  it('não juntam com as do formulário e saem ao limpar os ajustes do dia', () => {
    const d = seed();
    d.extraShifts = [{ id: 'form', asbId: ID.andrea, date: '2026-09-29', start: 13, end: 14, note: 'combinado' }];
    addExtraHour(d, ID.andrea, '2026-09-29', 14);
    expect(d.extraShifts!.map((e) => [e.id === 'form', e.start, e.end])).toEqual([[true, 13, 14], [false, 14, 15]]);
    clearDayOverrides(d, '2026-09-29');
    expect(d.extraShifts!.map((e) => e.id)).toEqual(['form']);
  });
});

describe('dias fechados e horas extras', () => {
  it('hora extra em feriado não entra na lista do mês', () => {
    const d = seed();
    d.extraShifts = [
      { id: 'a', asbId: ID.andrea, date: '2026-10-12', start: 13, end: 14 },
      { id: 'b', asbId: ID.andrea, date: '2026-10-13', start: 13, end: 14 },
    ];
    d.closedDates = [{ date: '2026-10-12', note: 'Feriado' }];
    expect(validExtraShiftsBetween(d, '2026-10-01', '2026-10-31').map((e) => e.id)).toEqual(['b']);
  });
});

describe('rodízios no mês', () => {
  it('rodízio removido no meio do mês continua nas semanas em que existia', () => {
    let d = seed();
    d.historySince = '2026-09-01';
    const task = d.tasks.find((t) => t.assignment.mode === 'rotation' && t.assignment.period === 'week')!;
    d = change(d, '2026-09-28', (x) => { x.tasks = x.tasks.filter((t) => t.id !== task.id); });
    const tasks = rotationTasksInMonth(d, 2026, 9, '2026-10-05');
    expect(tasks.some((t) => t.id === task.id)).toBe(true);
    const r = monthRotation(d, task, 2026, 9, '2026-10-05')!;
    expect(r.weeks.map((w) => w.week.index)).toEqual([1, 2, 3, 4]); // a semana 5 (28/09) já não tem
  });

  it('reordenar no meio da semana: o mês mostra a mesma titular que o dia', () => {
    let d = seed();
    d.historySince = '2026-09-01';
    const task = d.tasks.find((t) => t.assignment.mode === 'rotation' && t.assignment.period === 'week')!;
    d = change(d, '2026-09-29', (x) => {
      const t = x.tasks.find((y) => y.id === task.id)!;
      if (t.assignment.mode === 'rotation') t.assignment.order = [...t.assignment.order].reverse();
    });
    const now = d.tasks.find((t) => t.id === task.id)!;
    const week5 = monthRotation(d, now, 2026, 9, '2026-09-29')!.weeks.find((w) => w.week.days.includes('2026-09-29'))!;
    const day = resolveTask(d, now, '2026-09-29');
    expect(day.holders[0]).toEqual({ type: 'asb', asbId: week5.titularId });
  });
});

describe('backup: campos que travavam a abertura', () => {
  it('recusa registro da Prótese e início do histórico com data inválida; o reparo corrige', () => {
    const d = seed() as AppData;
    d.protese = [{ dentistId: 'id005', asbId: ID.ana, since: '20266-01-01' }];
    d.historySince = '20266-09-01';
    expect(() => parseBackup(JSON.stringify(d))).toThrow();
    const { data, removed } = repairBackup(JSON.stringify(d));
    expect(data.protese).toEqual([]);
    expect(data.historySince).toBeUndefined();
    expect(removed.length).toBeGreaterThanOrEqual(2);
  });
});

describe('contagem de ajustes do dia', () => {
  it('uma hora com duas salas conta uma vez', () => {
    expect(adjustedSlotCount([{ asbId: 'a', hour: 10 }, { asbId: 'a', hour: 10 }, { asbId: 'a', hour: 11 }, { asbId: 'b', hour: 10 }])).toBe(3);
  });
});

describe('PDF do dia: período da ausência', () => {
  it('continua inteiro depois de a substituta sair da equipe', () => {
    let d = seed();
    d.historySince = '2026-09-01';
    d.absences.push({ ...absence({ asbId: ID.laura, from: '2026-09-21', to: '2026-10-09' }), reason: 'Férias', substitute: { asbId: ID.amanda } });
    d = change(d, '2026-09-28', (x) => removeAsb(x, ID.amanda, '2026-09-28'));
    const m = dayPdfModel(d, '2026-09-22');
    expect(m.absences[0].period).toBe('21/09/2026 a 09/10/2026');
    expect(dataForDate(d, '2026-09-22').asbs.some((a) => a.id === ID.amanda)).toBe(true);
  });
});
