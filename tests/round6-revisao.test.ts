// Rodada de testes independentes dos áudios de 07/10: o que foi confirmado e corrigido.
import { describe, expect, it } from 'vitest';
import type { AppData } from '../src/domain';
import { analyze, dataForDate, effectiveDay, monthRotation, resolveTask, worksInPeriod } from '../src/domain';
import { dropDayOverrides, setDaySlots, setWeekSlots } from '../src/store/useStore';
import { applyDataMigrations, migrate, seedData } from '../src/store/storage';
import { dayPdfModel, monthPdfModel } from '../src/pdf/model';
import { ID, seed } from './helpers';

const at = (data: AppData, date: string, asbId: string, hour: number) =>
  effectiveDay(data, date).slots.filter((s) => s.hour === hour && s.who.type === 'asb' && s.who.asbId === asbId).map((s) => `${s.kind}:${s.roomId ?? ''}@${s.origin}`).sort();

describe('troca de horário: almoço e inativa', () => {
  it('quem sai antes da janela de almoço não ganha alerta de almoço', () => {
    const d = seed();
    d.shiftChanges = [{ id: 'tr', asbId: ID.amanda, from: '2026-10-08', to: '2026-10-08', start: 7, end: 12 }];
    const al = analyze(d, effectiveDay(d, '2026-10-08'));
    expect(al.some((a) => a.code === 'sem-almoco' && a.asbId === ID.amanda)).toBe(false);
    // no dia normal (09h–18h) o alerta continua quando falta o almoço
    const d2 = seed();
    d2.base.slots = d2.base.slots.filter((s) => !(s.asbId === ID.amanda && s.kind === 'almoco'));
    expect(analyze(d2, effectiveDay(d2, '2026-10-08')).some((a) => a.code === 'sem-almoco' && a.asbId === ID.amanda)).toBe(true);
    // troca 07h–13h ainda passa pela janela (bloco 12h): sem bloco de almoço, o alerta vale
    const d3 = seed();
    d3.base.slots = d3.base.slots.filter((s) => !(s.asbId === ID.amanda && s.kind === 'almoco'));
    d3.shiftChanges = [{ id: 'tr', asbId: ID.amanda, from: '2026-10-08', to: '2026-10-08', start: 7, end: 13 }];
    expect(analyze(d3, effectiveDay(d3, '2026-10-08')).some((a) => a.code === 'sem-almoco' && a.asbId === ID.amanda)).toBe(true);
  });

  it('troca de horário de ASB inativa não aparece no dia nem no PDF', () => {
    const d = seed();
    d.shiftChanges = [{ id: 'tr', asbId: ID.ana, from: '2026-10-08', to: '2026-10-08', start: 7, end: 16 }];
    d.asbs = d.asbs.map((a) => (a.id === ID.ana ? { ...a, active: false } : a));
    expect(dataForDate(d, '2026-10-08').asbs.find((a) => a.id === ID.ana)?.originalHours).toBeUndefined();
    expect(dayPdfModel(d, '2026-10-08').notes.some((n) => n.includes('Ana com horário trocado'))).toBe(false);
  });
});

describe('semana inteira: ajuste do dia e avisos', () => {
  it('instrução da semana dada no dia tira o ajuste "só este dia" dessa ASB nessa hora', () => {
    const d = seed();
    setWeekSlots(d, '2026-10-12', ID.priscila, [10], [{ kind: 'sala', roomId: 's2' }]);
    setDaySlots(d, '2026-10-14', ID.priscila, [10], [{ kind: 'apoio' }]);
    expect(at(d, '2026-10-14', ID.priscila, 10)).toEqual(['apoio:@override']);
    dropDayOverrides(d, '2026-10-14', ID.priscila, [10]);
    setWeekSlots(d, '2026-10-12', ID.priscila, [10], [{ kind: 'sala', roomId: 's2' }]);
    expect(at(d, '2026-10-14', ID.priscila, 10)).toEqual(['sala:s2@week']);
    // ajustes de outras horas e outras ASBs ficam
    setDaySlots(d, '2026-10-14', ID.priscila, [11], [{ kind: 'cme' }]);
    setDaySlots(d, '2026-10-14', ID.ana, [10], [{ kind: 'cme' }]);
    dropDayOverrides(d, '2026-10-14', ID.priscila, [10]);
    expect((d.dayOverrides ?? []).map((o) => `${o.asbId}@${o.hour}`).sort()).toEqual([`${ID.priscila}@11`, `${ID.ana}@10`].sort());
  });

  it('PDF do dia conta os ajustes da semana e não diz que é igual à base', () => {
    const d = seed();
    setWeekSlots(d, '2026-10-12', ID.laura, [10], [{ kind: 'apoio' }]);
    setWeekSlots(d, '2026-10-12', ID.amanda, [10], [{ kind: 'sala', roomId: 's1' }]);
    const m = dayPdfModel(d, '2026-10-13');
    expect(m.notes.some((n) => n.startsWith('Esta semana tem 2 ajustes'))).toBe(true);
    expect(dayPdfModel(d, '2026-10-20').notes.some((n) => n.includes('Esta semana'))).toBe(false);
  });
});

describe('planilha de prótese: período, ordem e responsável fixo parcial', () => {
  it('ordem padrão só com quem trabalha no turno, sem repetir a mesma pessoa no mês', () => {
    const d = seedData();
    const manha = d.tasks.find((t) => t.id === 'task-planilha-protese-manha')!;
    const tarde = d.tasks.find((t) => t.id === 'task-planilha-protese-tarde')!;
    expect(manha.period).toBe('manha');
    expect(tarde.period).toBe('tarde');
    if (manha.assignment.mode !== 'rotation' || tarde.assignment.mode !== 'rotation') throw new Error();
    expect(manha.assignment.order[0]).toBe(ID.pamela);
    expect(tarde.assignment.order[0]).toBe(ID.nicelia);
    expect(manha.assignment.order).not.toContain(ID.nicelia); // entra às 13h
    expect(tarde.assignment.order).not.toContain(ID.andrea); // sai às 13h
    for (const id of manha.assignment.order) expect(worksInPeriod(d, id, 'manha')).toBe(true);
    for (const id of tarde.assignment.order) expect(worksInPeriod(d, id, 'tarde')).toBe(true);
    // ao longo de 12 meses, manhã e tarde nunca caem na mesma pessoa
    for (let i = 0; i < 12; i++) {
      const y = 2026 + Math.floor((9 + i) / 12);
      const mo = ((9 + i) % 12) + 1;
      const a = monthRotation(d, manha, y, mo, '2026-10-07')?.monthTitularId;
      const b = monthRotation(d, tarde, y, mo, '2026-10-07')?.monthTitularId;
      expect(a).toBeDefined();
      expect(a).not.toBe(b);
    }
    expect(d.applied).toContain('planilha-protese-periodo');
  });

  it('ordem já mudada pela pessoa não é mexida pela revisão', () => {
    const old = migrate(seed());
    // simula quem carregou a primeira versão e mudou a ordem
    const t = old.tasks.find((x) => x.id === 'task-planilha-protese-tarde')!;
    if (t.assignment.mode !== 'rotation') throw new Error();
    t.assignment.order = [ID.ana, ID.nicelia];
    old.applied = ['planilha-protese'];
    applyDataMigrations(old);
    const t2 = old.tasks.find((x) => x.id === 'task-planilha-protese-tarde')!;
    if (t2.assignment.mode !== 'rotation') throw new Error();
    expect(t2.assignment.order).toEqual([ID.ana, ID.nicelia]);
    expect(t2.period).toBe('tarde');
  });

  it('titular que não trabalha no turno é avisada', () => {
    const d = seedData();
    const tarde = d.tasks.find((t) => t.id === 'task-planilha-protese-tarde')!;
    if (tarde.assignment.mode !== 'rotation') throw new Error();
    tarde.assignment.order = [ID.andrea];
    const r = resolveTask(d, tarde, '2026-10-20');
    expect(r.titularOffShift).toBe(true);
    expect(r.reason).toContain('Não trabalha à tarde');
    expect(resolveTask(d, d.tasks.find((t) => t.id === 'task-planilha-protese-manha')!, '2026-10-20').titularOffShift).toBeUndefined();
  });

  it('responsável fixo em parte do mês aparece ao lado da titular; o mês inteiro vira titular', () => {
    const d = seedData();
    const manha = d.tasks.find((t) => t.id === 'task-planilha-protese-manha')!;
    manha.holdersByPeriod = [{ id: 'f1', asbId: ID.laura, from: '2026-10-13', to: '2026-10-31' }];
    const r = monthRotation(d, manha, 2026, 10, '2026-10-07')!;
    expect(r.monthTitularId).toBe(ID.pamela);
    expect(r.fixed).toEqual([{ asbId: ID.laura, from: '2026-10-13', to: '2026-10-31' }]);
    expect(monthPdfModel(d, 2026, 10).monthlyRows.find((x) => x.task === 'Planilha de prótese (manhã)')?.holder).toBe('Pâmela; Laura fixa de 13/10 a 31/10');
    manha.holdersByPeriod = [{ id: 'f2', asbId: ID.laura, from: '2026-09-20', to: '2026-11-05' }];
    const whole = monthRotation(d, manha, 2026, 10, '2026-10-07')!;
    expect(whole.monthTitularId).toBe(ID.laura);
    expect(whole.fixed).toEqual([]);
    expect(monthPdfModel(d, 2026, 10).monthlyRows.find((x) => x.task === 'Planilha de prótese (manhã)')?.holder).toBe('Laura');
  });
});
