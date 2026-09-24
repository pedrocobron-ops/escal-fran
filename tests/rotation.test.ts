import { describe, expect, it } from 'vitest';
import { resolveTask, rotationIndex, rotationTitular, monthRotation, type Task } from '../src/domain';
import { ID, absence, seed } from './helpers';

function task(data: ReturnType<typeof seed>, id: string): Task {
  const t = data.tasks.find((x) => x.id === id);
  if (!t) throw new Error(`tarefa ${id} não está no seed`);
  return t;
}

describe('rodízio semanal (almoxarifado, início 2026-09-07, ordem Amanda, Laura, Pâmela, Priscila)', () => {
  const data = seed();
  const almox = task(data, 'id026');
  const rot = almox.assignment;
  if (rot.mode !== 'rotation') throw new Error('esperava rodízio');

  it('conta semanas a partir de startDate', () => {
    expect(rotationTitular(rot, '2026-09-07')).toBe(ID.amanda);
    expect(rotationTitular(rot, '2026-09-08')).toBe(ID.amanda); // terça da mesma semana
    expect(rotationTitular(rot, '2026-09-14')).toBe(ID.laura);
    expect(rotationTitular(rot, '2026-09-21')).toBe(ID.pamela);
    expect(rotationTitular(rot, '2026-09-28')).toBe(ID.priscila);
    expect(rotationTitular(rot, '2026-10-05')).toBe(ID.amanda); // deu a volta
  });

  it('semana começa na segunda: domingo ainda é da semana anterior', () => {
    expect(rotationTitular(rot, '2026-09-13')).toBe(ID.amanda);
  });

  it('datas antes do início contam para trás sem quebrar', () => {
    expect(rotationIndex(rot, '2026-08-31')).toBe(3);
    expect(rotationTitular(rot, '2026-08-31')).toBe(ID.priscila);
  });

  it('startDate no meio da semana usa a segunda daquela semana', () => {
    const r = { ...rot, startDate: '2026-09-09' }; // quarta
    expect(rotationTitular(r, '2026-09-07')).toBe(ID.amanda);
    expect(rotationTitular(r, '2026-09-14')).toBe(ID.laura);
  });

  it('só acontece em segunda ou terça', () => {
    expect(resolveTask(data, almox, '2026-09-07').applies).toBe(true);
    expect(resolveTask(data, almox, '2026-09-08').applies).toBe(true);
    expect(resolveTask(data, almox, '2026-09-09').applies).toBe(false);
    expect(resolveTask(data, almox, '2026-09-12').applies).toBe(false); // sábado, CEO fechado
  });

  it('titular ausente mostra a substituta', () => {
    const d = seed();
    d.absences.push(absence({ asbId: ID.laura, from: '2026-09-14', to: '2026-09-18', reason: 'Férias', substitute: { asbId: ID.pamela } }));
    const r = resolveTask(d, task(d, 'id026'), '2026-09-14');
    expect(r.titularId).toBe(ID.laura);
    expect(r.titularAbsent).toBe(true);
    expect(r.holders).toEqual([{ type: 'asb', asbId: ID.pamela }]);
    expect(r.reason).toContain('Pâmela');
  });

  it('titular ausente sem substituta', () => {
    const d = seed();
    d.absences.push(absence({ asbId: ID.laura, from: '2026-09-14', to: '2026-09-18', reason: 'Atestado' }));
    const r = resolveTask(d, task(d, 'id026'), '2026-09-15');
    expect(r.holders).toEqual([]);
    expect(r.noSubstitute).toBe(true);
    expect(r.reason).toContain('sem substituta');
  });

  it('titular ausente com substituta externa', () => {
    const d = seed();
    d.absences.push(absence({ asbId: ID.amanda, from: '2026-09-07', to: '2026-09-07', substitute: { externalName: 'Carla' } }));
    const r = resolveTask(d, task(d, 'id026'), '2026-09-07');
    expect(r.holders).toEqual([{ type: 'external', name: 'Carla' }]);
  });

  it('lista as titulares de cada semana do mês', () => {
    const m = monthRotation(data, almox, 2026, 9);
    expect(m?.period).toBe('week');
    expect(m?.weeks.map((w) => w.titularId)).toEqual([ID.priscila, ID.amanda, ID.laura, ID.pamela, ID.priscila]);
    expect(m?.weeks.map((w) => w.week.index)).toEqual([1, 2, 3, 4, 5]);
  });

  it('marca os dias em que a titular da semana está ausente', () => {
    const d = seed();
    d.absences.push(absence({ asbId: ID.laura, from: '2026-09-14', to: '2026-09-14' }));
    const m = monthRotation(d, task(d, 'id026'), 2026, 9);
    expect(m?.weeks[2].absentDays).toEqual(['2026-09-14']);
    expect(m?.weeks[1].absentDays).toEqual([]);
  });
});

describe('rodízio mensal (planilhas de Semio, início 2026-09-01)', () => {
  const data = seed();
  const semio = task(data, 'id025');
  const rot = semio.assignment;
  if (rot.mode !== 'rotation') throw new Error('esperava rodízio');

  it('conta meses a partir de startDate', () => {
    expect(rotationTitular(rot, '2026-09-01')).toBe(ID.laura);
    expect(rotationTitular(rot, '2026-09-30')).toBe(ID.laura);
    expect(rotationTitular(rot, '2026-10-01')).toBe(ID.pamela);
    expect(rotationTitular(rot, '2026-11-15')).toBe(ID.andrea);
    expect(rotationTitular(rot, '2026-12-01')).toBe(ID.amanda);
    expect(rotationTitular(rot, '2027-01-01')).toBe(ID.priscila);
    expect(rotationTitular(rot, '2027-02-01')).toBe(ID.ana);
    expect(rotationTitular(rot, '2027-03-01')).toBe(ID.nicelia);
    expect(rotationTitular(rot, '2027-04-01')).toBe(ID.laura); // 7 meses depois, volta
  });

  it('antes do início conta para trás', () => {
    expect(rotationTitular(rot, '2026-08-15')).toBe(ID.nicelia);
  });

  it('visão do mês mostra a titular do mês', () => {
    expect(monthRotation(data, semio, 2026, 10)?.monthTitularId).toBe(ID.pamela);
  });

  it('ordem vazia não quebra', () => {
    expect(rotationTitular({ ...rot, order: [] }, '2026-09-01')).toBeUndefined();
  });
});
