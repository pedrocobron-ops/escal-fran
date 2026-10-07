// Correções da 2ª rodada de testes (quadro, histórico, feriados, totais).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppData } from '../src/domain';
import { dataForDate, effectiveDay, monthRotation, recordHistory } from '../src/domain';
import { addExtraHour, baseEntriesAt, removeAsb, useStore } from '../src/store/useStore';
import { MemoryAdapter, browserAdapter, parseBackup, repairBackup } from '../src/store/storage';
import { placeInBase, placeInDay } from '../src/ui/board/placement';
import { extraTotalsByAsb, monthPdfModel } from '../src/pdf/model';
import { ID, absence, seed } from './helpers';

function change(prev: AppData, today: string, mutate: (d: AppData) => void): AppData {
  const next = structuredClone(prev);
  mutate(next);
  next.history = recordHistory(prev, next, today);
  return next;
}

const rooms = (d: AppData, asbId: string, hour: number) =>
  baseEntriesAt(d, asbId, hour).map((e) => `${e.kind}:${e.roomId ?? ''}`).sort();

describe('quadro: mover uma ficha', () => {
  it('mover uma das duas salas na mesma hora mantém a outra', () => {
    const d = seed();
    placeInBase(d, { asbId: ID.laura, hours: [10], target: { kind: 'sala', roomId: 's2' }, mode: 'add' });
    expect(rooms(d, ID.laura, 10)).toEqual(['sala:s1', 'sala:s2']);
    // arrasta a ficha da Sala 2 para a Sala 3, mesma hora
    placeInBase(d, { asbId: ID.laura, hours: [10], target: { kind: 'sala', roomId: 's3' }, mode: 'move', orig: { hour: 10, kind: 'sala', roomId: 's2' } });
    expect(rooms(d, ID.laura, 10)).toEqual(['sala:s1', 'sala:s3']);
  });

  it('mover para outra hora tira só aquela ficha da hora de origem e mantém o resto da hora de destino', () => {
    const d = seed();
    placeInBase(d, { asbId: ID.laura, hours: [10], target: { kind: 'sala', roomId: 's2' }, mode: 'add' });
    // Às 09h ela está na Sala 1: entra na Sala 2 como apoio (regra do cliente) e continua na Sala 1.
    placeInBase(d, { asbId: ID.laura, hours: [9], target: { kind: 'apoio', roomId: 's2' }, mode: 'move', orig: { hour: 10, kind: 'sala', roomId: 's2' } });
    expect(rooms(d, ID.laura, 10)).toEqual(['sala:s1']);
    expect(rooms(d, ID.laura, 9)).toEqual(['apoio:s2', 'sala:s1']);
  });

  it('acrescentar mantém o resto; substituir (coluna de apoio) tira tudo da hora', () => {
    const d = seed();
    placeInBase(d, { asbId: ID.laura, hours: [8, 9], target: { kind: 'apoio', roomId: 's2' }, mode: 'add' });
    expect(rooms(d, ID.laura, 8)).toEqual(['apoio:s2', 'sala:s1']);
    placeInBase(d, { asbId: ID.laura, hours: [8], target: { kind: 'apoio', roomId: 's3' }, mode: 'add' });
    expect(rooms(d, ID.laura, 8)).toEqual(['apoio:s2', 'apoio:s3', 'sala:s1']);
    placeInBase(d, { asbId: ID.laura, hours: [9], target: { kind: 'cme' }, mode: 'replace' });
    expect(rooms(d, ID.laura, 9)).toEqual(['cme:']);
  });

  it('ASB da sala que vira apoio da mesma sala não fica duplicada', () => {
    const d = seed();
    placeInBase(d, { asbId: ID.laura, hours: [8], target: { kind: 'apoio', roomId: 's1' }, mode: 'add' });
    expect(rooms(d, ID.laura, 8)).toEqual(['apoio:s1']);
  });

  it('Modo Dia: mover uma das duas salas grava só aquela troca', () => {
    const d = seed();
    const date = '2026-09-29';
    const entries = (h: number) => (h === 10 ? [{ kind: 'sala' as const, roomId: 's1' }, { kind: 'sala' as const, roomId: 's2' }] : [{ kind: 'sala' as const, roomId: 's1' }]);
    placeInDay(d, date, { asbId: ID.laura, hours: [10], target: { kind: 'sala', roomId: 's3' }, mode: 'move', orig: { hour: 10, kind: 'sala', roomId: 's2' } }, entries, false);
    const at10 = d.dayOverrides!.filter((o) => o.hour === 10).map((o) => o.roomId).sort();
    expect(at10).toEqual(['s1', 's3']);
  });
});

describe('hora extra pelo quadro', () => {
  it('junta com a hora extra encostada e não pica o registro', () => {
    const d = seed();
    addExtraHour(d, ID.andrea, '2026-09-29', 13);
    addExtraHour(d, ID.andrea, '2026-09-29', 15);
    expect(d.extraShifts!.map((e) => [e.start, e.end])).toEqual([[13, 14], [15, 16]]);
    addExtraHour(d, ID.andrea, '2026-09-29', 14);
    expect(d.extraShifts!.map((e) => [e.start, e.end])).toEqual([[13, 16]]);
    // a hora extra deixa a ficha valer no Modo Dia
    d.dayOverrides = [{ id: 'o', date: '2026-09-29', asbId: ID.andrea, hour: 14, kind: 'sala', roomId: 's2' }];
    const day = effectiveDay(d, '2026-09-29');
    expect(day.slots.some((s) => s.who.type === 'asb' && s.who.asbId === ID.andrea && s.hour === 14 && s.roomId === 's2' && s.extra)).toBe(true);
  });
});

describe('remover ASB que é substituta', () => {
  it('os dias passados continuam cobertos por ela', () => {
    let d = seed();
    d.historySince = '2026-09-01';
    d.absences.push({ ...absence({ asbId: ID.laura, from: '2026-09-21', to: '2026-10-02' }), reason: 'Férias', substitute: { asbId: ID.ana } });
    d = change(d, '2026-09-28', (x) => removeAsb(x, ID.ana, '2026-09-28'));
    const parts = d.absences.filter((a) => a.asbId === ID.laura).sort((a, b) => a.from.localeCompare(b.from));
    expect(parts.map((a) => [a.from, a.to, a.substitute && 'asbId' in a.substitute ? a.substitute.asbId : null])).toEqual([
      ['2026-09-21', '2026-09-27', ID.ana],
      ['2026-09-28', '2026-10-02', null],
    ]);
    const past = effectiveDay(d, '2026-09-22');
    expect(past.slots.some((s) => s.who.type === 'asb' && s.who.asbId === ID.ana && s.coveringFor === ID.laura)).toBe(true);
  });
});

describe('desfazer no dia seguinte', () => {
  afterEach(() => vi.useRealTimers());

  it('não apaga como o dia anterior ficou', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 10, 9));
    const st = useStore.getState();
    const adapter = new MemoryAdapter();
    const d0 = seed();
    d0.historySince = '2026-09-01';
    adapter.raw = JSON.stringify(d0);
    await st.init(adapter);
    vi.setSystemTime(new Date(2026, 8, 15, 9));
    useStore.getState().apply((x) => { x.dentists[0].end = 12; });
    vi.setSystemTime(new Date(2026, 8, 16, 9));
    useStore.getState().undo();
    const d = useStore.getState().data!;
    expect(dataForDate(d, '2026-09-15').dentists[0].end).toBe(12);
    expect(dataForDate(d, '2026-09-16').dentists[0].end).toBe(11);
  });
});

describe('feriados e dias fechados', () => {
  it('o dia fechado não tem escala e mostra o motivo', () => {
    const d = seed();
    d.closedDates = [{ date: '2026-10-12', note: 'Nossa Senhora Aparecida' }];
    const day = effectiveDay(d, '2026-10-12');
    expect(day.open).toBe(false);
    expect(day.closedNote).toBe('Nossa Senhora Aparecida');
    expect(day.slots).toHaveLength(0);
    d.closedDates = [{ date: '2026-10-12' }];
    expect(effectiveDay(d, '2026-10-12').closedNote).toBe('Feriado ou dia fechado');
  });

  it('backup valida as datas fechadas; o reparo tira as inválidas', () => {
    const d = seed();
    (d as unknown as { closedDates: unknown[] }).closedDates = [{ date: '2026-10-12' }, { date: '20266-10-12' }];
    expect(() => parseBackup(JSON.stringify(d))).toThrow(/Dia fechado 2/);
    const { data, removed } = repairBackup(JSON.stringify(d));
    expect(data.closedDates).toEqual([{ date: '2026-10-12' }]);
    expect(removed.join(' ')).toMatch(/dia fechado/);
  });
});

describe('rodízio no mês', () => {
  it('reordenar hoje não muda as semanas que já passaram', () => {
    let d = seed();
    d.historySince = '2026-09-01';
    const task = d.tasks.find((t) => t.assignment.mode === 'rotation' && t.assignment.period === 'week')!;
    const before = monthRotation(d, task, 2026, 9, '2026-09-27')!.weeks.map((w) => w.titularId);
    d = change(d, '2026-09-28', (x) => {
      const t = x.tasks.find((y) => y.id === task.id)!;
      if (t.assignment.mode === 'rotation') t.assignment.order = [...t.assignment.order].reverse();
    });
    const after = monthRotation(d, d.tasks.find((t) => t.id === task.id)!, 2026, 9, '2026-09-28')!.weeks.map((w) => w.titularId);
    expect(after.slice(0, 4)).toEqual(before.slice(0, 4)); // semanas de 01/09 a 25/09
    expect(after[4]).not.toBe(before[4]); // semana de 28/09 já usa a ordem nova
  });

  it('semana sem nenhum dia da tarefa dentro do mês fica de fora', () => {
    const d = seed();
    const task = d.tasks.find((t) => t.assignment.mode === 'rotation' && t.assignment.period === 'week' && t.days.every((x) => x === 1 || x === 2))!;
    const oct = monthRotation(d, task, 2026, 10)!;
    // 01/10 e 02/10 são quinta e sexta: a tarefa de segunda ou terça não acontece nessa semana
    expect(oct.weeks.some((w) => w.week.days.includes('2026-10-01'))).toBe(false);
  });
});

describe('regras fixas no histórico', () => {
  it('mudar as regras hoje não muda o PDF de um mês passado', () => {
    let d = seed();
    d.historySince = '2026-09-01';
    const old = [...d.rules];
    d = change(d, '2026-10-05', (x) => { x.rules = ['REGRA NOVA']; });
    expect(monthPdfModel(d, 2026, 9).rules).toEqual(old);
    expect(monthPdfModel(d, 2026, 10).rules).toEqual(['REGRA NOVA']);
  });
});

describe('total de horas extras do mês', () => {
  it('não conta em dobro, nem ASB inativa, nem dia fechado', () => {
    const d = seed();
    // Andrea: 07h–13h. Duas horas extras sobrepostas (13h–15h e 14h–16h) = 3 blocos.
    d.extraShifts = [
      { id: 'a', asbId: ID.andrea, date: '2026-09-29', start: 13, end: 15 },
      { id: 'b', asbId: ID.andrea, date: '2026-09-29', start: 14, end: 16 },
      { id: 'c', asbId: ID.andrea, date: '2026-09-07', start: 13, end: 14 },
    ];
    d.closedDates = [{ date: '2026-09-07', note: 'Feriado' }];
    expect(extraTotalsByAsb(d, '2026-09-01', '2026-09-30')).toEqual([{ asb: 'Andrea', hours: 3 }]);
    d.asbs.find((a) => a.id === ID.andrea)!.active = false;
    expect(extraTotalsByAsb(d, '2026-09-01', '2026-09-30')).toEqual([]);
  });
});

describe('armazenamento bloqueado', () => {
  it('sem localStorage, usa memória e avisa que não está salvando', () => {
    const { adapter, blocked } = browserAdapter();
    expect(blocked).toBe(true);
    expect(adapter).toBeInstanceOf(MemoryAdapter);
  });
});
