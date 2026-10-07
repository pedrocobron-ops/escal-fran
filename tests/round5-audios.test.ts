// Áudios do cliente de 07/10/2026 (10:18, 10:19 e 10:22): a escala da semana vale a
// semana inteira, troca de horário de ASB e planilha de prótese como rodízio mensal.
import { describe, expect, it } from 'vitest';
import type { AppData } from '../src/domain';
import { analyze, dataForDate, effectiveDay, monthRotation, overlappingShiftChanges, resolveTask, shiftChangesBetween } from '../src/domain';
import { baseEntriesAt, clearWeekOverrides, copyWeekOverrides, hasWeekOverrides, setDaySlots, setWeekSlots, weekEntriesAt, weekPlanAt } from '../src/store/useStore';
import { applyDataMigrations, migrate, seedData } from '../src/store/storage';
import { placeInWeek } from '../src/ui/board/placement';
import { extraTotalsByAsb, dayPdfModel, monthPdfModel } from '../src/pdf/model';
import { ID, absence, seed } from './helpers';

const MON = '2026-10-12';
const TUE = '2026-10-13';
const FRI = '2026-10-16';
const NEXT_MON = '2026-10-19';

const at = (data: AppData, date: string, asbId: string, hour: number) =>
  effectiveDay(data, date).slots.filter((s) => s.hour === hour && s.who.type === 'asb' && s.who.asbId === asbId).map((s) => `${s.kind}:${s.roomId ?? ''}@${s.origin}`).sort();

describe('áudio 10:18: a escala montada vale para a semana inteira', () => {
  it('ajuste da semana vale de segunda a sexta, e só nessa semana', () => {
    const d = seed();
    // Andrea 08h: Sala 3 na base. Nesta semana ela fica na Sala 1 às 08h.
    setWeekSlots(d, MON, ID.andrea, [8], [{ kind: 'sala', roomId: 's1' }]);
    for (const date of [MON, TUE, FRI]) expect(at(d, date, ID.andrea, 8)).toEqual(['sala:s1@week']);
    expect(at(d, NEXT_MON, ID.andrea, 8)).toEqual(['sala:s3@base']);
    expect(at(d, '2026-10-09', ID.andrea, 8)).toEqual(['sala:s3@base']);
    expect(baseEntriesAt(d, ID.andrea, 8).map((e) => e.roomId)).toEqual(['s3']);
  });

  it('ajuste do dia vence o da semana só naquele dia', () => {
    const d = seed();
    setWeekSlots(d, MON, ID.andrea, [8], [{ kind: 'sala', roomId: 's1' }]);
    setDaySlots(d, TUE, ID.andrea, [8], [{ kind: 'apoio' }]);
    expect(at(d, TUE, ID.andrea, 8)).toEqual(['apoio:@override']);
    expect(at(d, MON, ID.andrea, 8)).toEqual(['sala:s1@week']);
    expect(at(d, FRI, ID.andrea, 8)).toEqual(['sala:s1@week']);
  });

  it('tirar da semana (livre) esconde a base nessa semana', () => {
    const d = seed();
    setWeekSlots(d, MON, ID.andrea, [8], []);
    expect(at(d, TUE, ID.andrea, 8)).toEqual([]);
    expect(weekEntriesAt(d, MON, ID.andrea, 8)).toEqual([]);
    expect(weekEntriesAt(d, NEXT_MON, ID.andrea, 8).map((e) => e.roomId)).toEqual(['s3']);
    expect(effectiveDay(d, TUE).weekOverrides.length).toBe(1);
  });

  it('placeInWeek: mover de hora deixa a origem livre; soltar em sala ocupada vira apoio e mantém a origem', () => {
    const d = seed();
    const entries = (h: number) => weekEntriesAt(d, MON, ID.andrea, h);
    // Andrea 08h Sala 3 -> 09h Sala 1 (move)
    placeInWeek(d, MON, { asbId: ID.andrea, hours: [9], target: { kind: 'sala', roomId: 's1' }, mode: 'move', orig: { hour: 8, kind: 'sala', roomId: 's3' } }, entries, false);
    expect(at(d, TUE, ID.andrea, 8)).toEqual([]);
    expect(at(d, TUE, ID.andrea, 9)).toEqual(['sala:s1@week']);
    // apoio em outra sala na mesma hora: origem fica
    placeInWeek(d, MON, { asbId: ID.andrea, hours: [9], target: { kind: 'apoio', roomId: 's4' }, mode: 'add' }, entries, false);
    expect(at(d, TUE, ID.andrea, 9)).toEqual(['apoio:s4@week', 'sala:s1@week']);
  });

  it('copiar para a próxima semana e voltar a semana à base', () => {
    const d = seed();
    setWeekSlots(d, MON, ID.andrea, [8, 9], [{ kind: 'sala', roomId: 's1' }]);
    expect(hasWeekOverrides(d, MON)).toBe(true);
    expect(copyWeekOverrides(d, MON, NEXT_MON)).toBe(2);
    expect(at(d, '2026-10-21', ID.andrea, 9)).toEqual(['sala:s1@week']);
    clearWeekOverrides(d, MON);
    expect(hasWeekOverrides(d, MON)).toBe(false);
    expect(at(d, TUE, ID.andrea, 8)).toEqual(['sala:s3@base']);
    expect(at(d, NEXT_MON, ID.andrea, 8)).toEqual(['sala:s1@week']);
    // ids novos na cópia (não compartilha com a semana de origem)
    const ids = new Set((d.weekOverrides ?? []).map((o) => o.id));
    expect(ids.size).toBe(d.weekOverrides?.length);
  });

  it('weekPlanAt mostra quem está em cada hora com os ajustes da semana', () => {
    const d = seed();
    setWeekSlots(d, MON, ID.andrea, [8], [{ kind: 'sala', roomId: 's1' }]);
    const plan = weekPlanAt(d, MON, 8).filter((p) => p.asbId === ID.andrea);
    expect(plan.map((p) => p.roomId)).toEqual(['s1']);
  });

  it('ausência continua valendo por cima do ajuste da semana (substituta cobre)', () => {
    const d = seed();
    setWeekSlots(d, MON, ID.andrea, [8], [{ kind: 'sala', roomId: 's1' }]);
    d.absences.push(absence({ asbId: ID.andrea, from: TUE, to: TUE, substitute: { asbId: ID.laura } }));
    const day = effectiveDay(d, TUE);
    expect(day.slots.some((s) => s.who.type === 'asb' && s.who.asbId === ID.andrea)).toBe(false);
    const laura8 = day.slots.filter((s) => s.hour === 8 && s.who.type === 'asb' && s.who.asbId === ID.laura);
    expect(laura8.some((s) => s.kind === 'sala' && s.roomId === 's1')).toBe(true);
  });
});

describe('áudio 10:19: troca de horário da ASB', () => {
  const amandaChange = (d: AppData, from = TUE, to = TUE) => {
    d.shiftChanges = [{ id: 'tr1', asbId: ID.amanda, from, to, start: 7, end: 16, note: 'consulta' }];
  };

  it('no dia trocado o contrato é o novo e o normal fica guardado', () => {
    const d = seed();
    amandaChange(d);
    const on = dataForDate(d, TUE).asbs.find((a) => a.id === ID.amanda)!;
    expect([on.start, on.end]).toEqual([7, 16]);
    expect(on.originalHours).toEqual({ start: 9, end: 18, note: 'consulta' });
    const off = dataForDate(d, MON).asbs.find((a) => a.id === ID.amanda)!;
    expect([off.start, off.end]).toEqual([9, 18]);
    expect(off.originalHours).toBeUndefined();
    // os dados atuais não mudam
    expect(d.asbs.find((a) => a.id === ID.amanda)!.start).toBe(9);
  });

  it('blocos fora do novo horário somem e o novo horário entra na paleta', () => {
    const d = seed();
    amandaChange(d);
    const day = effectiveDay(d, TUE);
    const amanda = (h: number) => day.slots.filter((s) => s.hour === h && s.who.type === 'asb' && s.who.asbId === ID.amanda);
    expect(amanda(16)).toEqual([]);
    expect(amanda(17)).toEqual([]);
    expect(amanda(15).length).toBe(1);
    // às 07h e 08h ela está livre para ser colocada (sem bloco, mas no contrato)
    const al = analyze(d, day);
    const free = al.filter((a) => a.code === 'bloco-sem-atribuicao' && a.asbId === ID.amanda);
    expect(free.some((a) => a.hour === 7)).toBe(true);
    expect(free.some((a) => a.hour === 8)).toBe(true);
    expect(free.some((a) => a.hour === 16)).toBe(false);
    // a sala dela às 16h e 17h fica sem ASB (ou alguém cobre): o alerta aparece
    expect(al.some((a) => a.code === 'sala-sem-asb' && a.hour === 17 && a.message.includes('Sala 2'))).toBe(true);
  });

  it('ajuste do dia dentro do novo horário funciona', () => {
    const d = seed();
    amandaChange(d);
    setDaySlots(d, TUE, ID.amanda, [7, 8], [{ kind: 'sala', roomId: 's2' }]);
    expect(at(d, TUE, ID.amanda, 7)).toEqual(['sala:s2@override']);
  });

  it('hora extra dentro do horário trocado não conta como extra', () => {
    const d = seed();
    amandaChange(d);
    d.extraShifts = [
      { id: 'hx1', asbId: ID.amanda, date: TUE, start: 7, end: 9 },
      { id: 'hx2', asbId: ID.amanda, date: MON, start: 7, end: 9 },
    ];
    const totals = extraTotalsByAsb(d, MON, FRI);
    expect(totals.find((t) => t.asb === 'Amanda')?.hours).toBe(2);
  });

  it('ausência vale acima da troca; lista do mês e sobreposição', () => {
    const d = seed();
    amandaChange(d, MON, FRI);
    d.absences.push(absence({ asbId: ID.amanda, from: TUE, to: TUE }));
    const day = effectiveDay(d, TUE);
    expect(day.slots.some((s) => s.who.type === 'asb' && s.who.asbId === ID.amanda)).toBe(false);
    expect(shiftChangesBetween(d, '2026-10-01', '2026-10-31').map((c) => c.id)).toEqual(['tr1']);
    expect(shiftChangesBetween(d, '2026-11-01', '2026-11-30')).toEqual([]);
    expect(overlappingShiftChanges(d, ID.amanda, FRI, NEXT_MON).map((c) => c.id)).toEqual(['tr1']);
    expect(overlappingShiftChanges(d, ID.amanda, FRI, NEXT_MON, 'tr1')).toEqual([]);
    expect(overlappingShiftChanges(d, ID.laura, MON, FRI)).toEqual([]);
  });

  it('PDF: o dia mostra o contrato trocado e o mês lista as trocas', () => {
    const d = seed();
    amandaChange(d);
    const day = dayPdfModel(d, TUE);
    const amanda = day.asbRows.find((r) => r.name === 'Amanda')!;
    expect(amanda.contract).toContain('07h–16h');
    expect(amanda.contract).toContain('(trocado)');
    expect(day.notes.some((n) => n.includes('Amanda com horário trocado'))).toBe(true);
    const month = monthPdfModel(d, 2026, 10);
    expect(month.shiftChanges).toEqual([{ asb: 'Amanda', period: '13/10/2026', hours: '07h–16h', note: 'consulta' }]);
    expect(monthPdfModel(d, 2026, 11).shiftChanges).toEqual([]);
  });

  it('a troca passa pelo histórico: o contrato guardado do dia é o que valia', () => {
    const d = seed();
    amandaChange(d);
    // Backup antigo sem o campo: continua válido
    const parsed = migrate(structuredClone(d));
    expect(parsed.shiftChanges?.length).toBe(1);
  });
});

describe('áudio 10:22: planilha de prótese, rodízio mensal manhã e tarde', () => {
  it('a escala inicial ganha as duas tarefas, uma vez só', () => {
    const d = seedData();
    const manha = d.tasks.find((t) => t.id === 'task-planilha-protese-manha')!;
    const tarde = d.tasks.find((t) => t.id === 'task-planilha-protese-tarde')!;
    expect(manha.assignment.mode).toBe('rotation');
    expect(tarde.assignment.mode).toBe('rotation');
    if (manha.assignment.mode !== 'rotation' || tarde.assignment.mode !== 'rotation') throw new Error();
    expect(manha.assignment.period).toBe('month');
    expect(manha.assignment.order[0]).toBe(ID.pamela);
    expect(tarde.assignment.order[0]).toBe(ID.nicelia);
    expect(d.applied).toContain('planilha-protese');
    // rodar de novo não duplica
    applyDataMigrations(d);
    expect(d.tasks.filter((t) => t.name.startsWith('Planilha de prótese')).length).toBe(2);
  });

  it('se o cliente apagar a tarefa, o app não recria', () => {
    const d = seedData();
    d.tasks = d.tasks.filter((t) => !t.id.startsWith('task-planilha-protese'));
    applyDataMigrations(d);
    expect(d.tasks.some((t) => t.id.startsWith('task-planilha-protese'))).toBe(false);
    // backup salvo antes da migração (sem flag) ganha as tarefas ao carregar
    const old = seed();
    expect(old.tasks.some((t) => t.id.startsWith('task-planilha-protese'))).toBe(false);
    const m = migrate(old);
    expect(m.tasks.some((t) => t.id === 'task-planilha-protese-manha')).toBe(true);
  });

  it('outubro: Pâmela de manhã e Nicélia à tarde; novembro passa para a próxima', () => {
    const d = seedData();
    const manha = d.tasks.find((t) => t.id === 'task-planilha-protese-manha')!;
    const tarde = d.tasks.find((t) => t.id === 'task-planilha-protese-tarde')!;
    const today = '2026-10-07';
    expect(monthRotation(d, manha, 2026, 10, today)?.monthTitularId).toBe(ID.pamela);
    expect(monthRotation(d, tarde, 2026, 10, today)?.monthTitularId).toBe(ID.nicelia);
    const nov = monthRotation(d, manha, 2026, 11, today)?.monthTitularId;
    expect(nov).toBeDefined();
    expect(nov).not.toBe(ID.pamela);
    expect(resolveTask(d, manha, '2026-10-20').titularId).toBe(ID.pamela);
    expect(resolveTask(d, tarde, '2026-10-20').titularId).toBe(ID.nicelia);
  });
});
