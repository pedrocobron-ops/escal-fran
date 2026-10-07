import { describe, expect, it } from 'vitest';
import type { AppData } from '../src/domain';
import { analyze, dataForDate, effectiveDay, recordHistory, resolveTask } from '../src/domain';
import { removeAsb, removeDentist, setSlots } from '../src/store/useStore';
import { monthPdfModel, dayPdfModel } from '../src/pdf/model';
import { ID, absence, seed } from './helpers';

/** Aplica uma mudança como o store faz: clona, muda, grava histórico. */
function change(prev: AppData, today: string, mutate: (d: AppData) => void): AppData {
  const next = structuredClone(prev);
  mutate(next);
  next.history = recordHistory(prev, next, today);
  return next;
}

const laura8 = (d: AppData, date: string) =>
  effectiveDay(d, date).slots.find((s) => s.who.type === 'asb' && s.who.asbId === ID.laura && s.hour === 8);

describe('histórico da escala (dias passados)', () => {
  it('mudar a escala base hoje não muda os dias passados', () => {
    let d = seed();
    d.historySince = '2026-09-01';
    d = change(d, '2026-09-28', (x) => setSlots(x, ID.laura, [8], { kind: 'sala', roomId: 's2' }));
    expect(d.history).toHaveLength(1);
    expect(d.history![0].until).toBe('2026-09-27');
    expect(Object.keys(d.history![0]).sort()).toEqual(['base', 'until']); // só o que mudou
    expect(laura8(d, '2026-09-14')).toMatchObject({ roomId: 's1' }); // passado: como era
    expect(laura8(d, '2026-09-28')).toMatchObject({ roomId: 's2' }); // hoje: novo
    expect(laura8(d, '2026-10-05')).toMatchObject({ roomId: 's2' }); // futuro: novo
  });

  it('várias mudanças no mesmo dia completam o mesmo registro', () => {
    let d = seed();
    d.historySince = '2026-09-01';
    d = change(d, '2026-09-28', (x) => setSlots(x, ID.laura, [8], { kind: 'sala', roomId: 's2' }));
    d = change(d, '2026-09-28', (x) => setSlots(x, ID.laura, [9], { kind: 'sala', roomId: 's2' }));
    d = change(d, '2026-09-28', (x) => { x.dentists[0].end = 12; });
    expect(d.history).toHaveLength(1);
    expect(Object.keys(d.history![0]).sort()).toEqual(['base', 'dentists', 'until']);
    const past = dataForDate(d, '2026-09-27');
    expect(past.dentists[0].end).toBe(11);
    expect(past.base.slots.find((s) => s.asbId === ID.laura && s.hour === 9)?.roomId).toBe('s1');
  });

  it('mudanças em dias diferentes formam uma cadeia correta', () => {
    let d = seed();
    d.historySince = '2026-09-01';
    // 10/09: Laura 08h vai para Sala 2
    d = change(d, '2026-09-10', (x) => setSlots(x, ID.laura, [8], { kind: 'sala', roomId: 's2' }));
    // 20/09: Dr. Francisco passa a ir até 12h (só dentistas mudam)
    d = change(d, '2026-09-20', (x) => { x.dentists[0].end = 12; });
    // 25/09: Laura 08h vai para Sala 3
    d = change(d, '2026-09-25', (x) => setSlots(x, ID.laura, [8], { kind: 'sala', roomId: 's3' }));
    expect(d.history!.map((h) => h.until)).toEqual(['2026-09-09', '2026-09-19', '2026-09-24']);
    expect(laura8(d, '2026-09-08')?.roomId).toBe('s1');
    expect(laura8(d, '2026-09-15')?.roomId).toBe('s2');
    expect(laura8(d, '2026-09-22')?.roomId).toBe('s2');
    expect(laura8(d, '2026-09-28')?.roomId).toBe('s3');
    expect(dataForDate(d, '2026-09-15').dentists[0].end).toBe(11);
    expect(dataForDate(d, '2026-09-22').dentists[0].end).toBe(12);
  });

  it('no primeiro dia de uso não há passado para guardar', () => {
    let d = seed();
    d.historySince = '2026-09-28';
    d = change(d, '2026-09-28', (x) => setSlots(x, ID.laura, [8], { kind: 'sala', roomId: 's2' }));
    expect(d.history ?? []).toEqual([]);
  });

  it('mudança que não mexe na estrutura (ausência) não cria registro', () => {
    let d = seed();
    d.historySince = '2026-09-01';
    d = change(d, '2026-09-28', (x) => x.absences.push(absence({ asbId: ID.laura, from: '2026-09-28', to: '2026-09-28' })));
    expect(d.history ?? []).toEqual([]);
  });

  it('remover uma ASB hoje preserva os dias passados dela, com ausência e nome', () => {
    let d = seed();
    d.historySince = '2026-09-01';
    d.absences.push(absence({ asbId: ID.laura, from: '2026-09-14', to: '2026-09-15', reason: 'Folga', substitute: { asbId: ID.amanda } }));
    d.absences.push(absence({ id: 'fut', asbId: ID.laura, from: '2026-09-25', to: '2026-10-02', reason: 'Férias' }));
    d.extraShifts = [
      { id: 'x1', asbId: ID.laura, date: '2026-09-10', start: 16, end: 17 },
      { id: 'x2', asbId: ID.laura, date: '2026-10-05', start: 16, end: 17 },
    ];
    d = change(d, '2026-09-28', (x) => removeAsb(x, ID.laura, '2026-09-28'));
    expect(d.asbs.some((a) => a.id === ID.laura)).toBe(false);
    // passado continua
    const day14 = effectiveDay(d, '2026-09-14');
    expect(day14.absences.map((a) => a.asbId)).toEqual([ID.laura]);
    expect(day14.slots.find((s) => s.who.type === 'asb' && s.who.asbId === ID.amanda && s.hour === 11)).toMatchObject({ coveringFor: ID.laura });
    const day10 = effectiveDay(d, '2026-09-10');
    expect(day10.slots.some((s) => s.who.type === 'asb' && s.who.asbId === ID.laura)).toBe(true);
    expect(day10.extraShifts.map((e) => e.id)).toEqual(['x1']);
    // ausência que atravessa hoje foi cortada até ontem; futura saiu
    expect(d.absences.find((a) => a.id === 'fut')?.to).toBe('2026-09-27');
    expect(d.extraShifts!.map((e) => e.id)).toEqual(['x1']);
    // hoje em diante, sem Laura e sem alertas dela
    expect(effectiveDay(d, '2026-09-28').slots.some((s) => s.who.type === 'asb' && s.who.asbId === ID.laura)).toBe(false);
    // PDF do dia passado ainda mostra a Laura pelo nome
    const pdf = dayPdfModel(d, '2026-09-14');
    expect(pdf.absences[0]).toMatchObject({ asb: 'Laura', cover: 'Amanda' });
    expect(pdf.asbRows.some((r) => r.name === 'Laura')).toBe(true);
    // tarefa do passado resolve com a Laura
    const cme = d.tasks.find((t) => t.id === 'id018')!;
    expect(resolveTask(d, cme, '2026-09-10').holders).toEqual([{ type: 'asb', asbId: ID.laura }]);
    // alertas do passado usam a Laura pelo nome (hora extra dela 16h–17h ficou sem atribuição)
    const a10 = analyze(d, effectiveDay(d, '2026-09-10'));
    expect(a10.filter((a) => a.code !== 'sem-almoco').map((a) => a.code).sort()).toEqual(['hora-extra-sem-atribuicao', 'sala-sem-asb']);
    expect(a10.find((a) => a.code === 'hora-extra-sem-atribuicao')?.message).toContain('Laura');
  });

  it('remover dentista hoje mantém as folgas passadas dele', () => {
    let d = seed();
    d.historySince = '2026-09-01';
    d.dentistAbsences = [{ id: 'df', dentistId: 'id002', from: '2026-09-15', to: '2026-09-15', reason: 'Folga' }];
    d = change(d, '2026-09-28', (x) => removeDentist(x, 'id002', '2026-09-28'));
    expect(effectiveDay(d, '2026-09-15').dentistsOff.map((x) => x.id)).toEqual(['id002']);
    expect(effectiveDay(d, '2026-09-28').dentists.some((x) => x.id === 'id002')).toBe(false);
  });

  it('PDF de um mês passado usa a escala daquele mês', () => {
    let d = seed();
    d.historySince = '2026-08-01';
    d = change(d, '2026-10-01', (x) => setSlots(x, ID.laura, [8], { kind: 'sala', roomId: 's2' }));
    const sept = monthPdfModel(d, 2026, 9);
    expect(sept.roomRows[1].cells[0].asb).toBe('ASB: Laura');
    const oct = monthPdfModel(d, 2026, 10);
    expect(oct.roomRows[1].cells[0].asb).toBe('SEM ASB');
    expect(oct.roomRows[1].cells[1].asb).toBe('ASB: Laura');
  });

  it('escala base (sem data) sempre usa a estrutura atual', () => {
    let d = seed();
    d.historySince = '2026-09-01';
    d = change(d, '2026-09-28', (x) => setSlots(x, ID.laura, [8], { kind: 'sala', roomId: 's2' }));
    expect(dataForDate(d, '')).toBe(d);
  });
});
