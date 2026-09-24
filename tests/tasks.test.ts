import { describe, expect, it } from 'vitest';
import { resolveTask, resolveTasksForDate } from '../src/domain';
import { ID, absence, seed } from './helpers';

const MONDAY = '2026-09-14';
const WEDNESDAY = '2026-09-16';

function res(data = seed(), taskId: string, date = MONDAY) {
  const t = data.tasks.find((x) => x.id === taskId)!;
  return resolveTask(data, t, date);
}

describe('tarefas que seguem o dentista', () => {
  it('CME da manhã segue a Estomatologia (Laura está com o Dr. Francisco)', () => {
    const r = res(seed(), 'id018');
    expect(r.applies).toBe(true);
    expect(r.holders).toEqual([{ type: 'asb', asbId: ID.laura }]);
    expect(r.reason).toContain('Laura');
    expect(r.reason).toContain('Dr. Francisco');
    expect(r.reason).toContain('08h–11h');
  });

  it('CME da tarde segue o Dr. Edson (Amanda na Sala 2)', () => {
    expect(res(seed(), 'id019').holders).toEqual([{ type: 'asb', asbId: ID.amanda }]);
  });

  it('conferência de prótese 11h–15h: Laura e Andrea (Andrea cobre o almoço)', () => {
    const r = res(seed(), 'id022');
    expect(r.holders).toEqual([
      { type: 'asb', asbId: ID.laura },
      { type: 'asb', asbId: ID.andrea },
    ]);
  });

  it('com a titular ausente, a substituta herda a tarefa', () => {
    const d = seed();
    d.absences.push(absence({ asbId: ID.laura, from: MONDAY, to: MONDAY, substitute: { asbId: ID.amanda } }));
    const r = res(d, 'id022'); // Prótese 11h–15h: Amanda às 11h, 13h, 14h e Andrea às 12h
    expect(r.holders).toEqual([
      { type: 'asb', asbId: ID.amanda },
      { type: 'asb', asbId: ID.andrea },
    ]);
    // CME da manhã (Francisco 08h–11h) fica sem ninguém
    const cme = res(d, 'id018');
    expect(cme.holders).toEqual([]);
    expect(cme.reason).toContain('Ninguém');
  });

  it('substituta externa aparece pelo nome', () => {
    const d = seed();
    d.absences.push(absence({ asbId: ID.laura, from: MONDAY, to: MONDAY, substitute: { externalName: 'Carla' } }));
    expect(res(d, 'id018').holders).toEqual([{ type: 'external', name: 'Carla' }]);
    expect(res(d, 'id018').reason).toContain('Carla (externa)');
  });

  it('dentista que não atende no dia', () => {
    const d = seed();
    d.dentists.find((x) => x.id === ID.francisco)!.days = [2, 4];
    const r = res(d, 'id018', MONDAY);
    expect(r.applies).toBe(true);
    expect(r.holders).toEqual([]);
    expect(r.reason).toContain('não atende');
  });
});

describe('tarefas que seguem a sala', () => {
  it('RX da manhã é de quem está na Sala 4 às 08h (Pâmela)', () => {
    const r = res(seed(), 'id020');
    expect(r.holders).toEqual([{ type: 'asb', asbId: ID.pamela }]);
    expect(r.reason).toContain('Sala 4');
    expect(r.reason).toContain('08h');
  });

  it('RX da tarde é de quem está na Sala 4 às 16h (Ana)', () => {
    expect(res(seed(), 'id021').holders).toEqual([{ type: 'asb', asbId: ID.ana }]);
  });
});

describe('tarefa fixa', () => {
  it('compressor só quarta e sexta, Ana e Priscila', () => {
    expect(res(seed(), 'id024', MONDAY).applies).toBe(false);
    const r = res(seed(), 'id024', WEDNESDAY);
    expect(r.applies).toBe(true);
    expect(r.holders).toEqual([
      { type: 'asb', asbId: ID.ana },
      { type: 'asb', asbId: ID.priscila },
    ]);
  });

  it('ASB inativa sai da lista fixa', () => {
    const d = seed();
    d.asbs.find((a) => a.id === ID.ana)!.active = false;
    expect(res(d, 'id024', WEDNESDAY).holders).toEqual([{ type: 'asb', asbId: ID.priscila }]);
  });
});

describe('todas as tarefas do dia', () => {
  it('resolve as 9 tarefas do seed numa segunda-feira', () => {
    const all = resolveTasksForDate(seed(), MONDAY);
    expect(all).toHaveLength(9);
    const byId = Object.fromEntries(all.map((r) => [r.taskId, r]));
    expect(byId['id024'].applies).toBe(false); // compressor
    expect(byId['id026'].applies).toBe(true); // almoxarifado, segunda
    expect(byId['id026'].titularId).toBe(ID.laura);
    expect(byId['id025'].titularId).toBe(ID.laura); // Semio em setembro
  });

  it('em dia fechado nada se aplica', () => {
    expect(resolveTasksForDate(seed(), '2026-09-13').every((r) => !r.applies)).toBe(true);
  });
});
