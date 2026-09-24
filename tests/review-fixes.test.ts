import { describe, expect, it } from 'vitest';
import {
  analyze, effectiveDay, nextProteseRecords, overlappingAbsences, proteseAlerts, resolveTask,
} from '../src/domain';
import { BackupError, exportBackup, parseBackup, seedData } from '../src/store/storage';
import { removeRoom } from '../src/store/useStore';
import { ID, absence, seed } from './helpers';

describe('regra da Prótese em dias corridos', () => {
  it('troca em 01/10 depois de registro em 30/09 ainda avisa', () => {
    const d = seed();
    d.protese = [{ dentistId: ID.isac, asbId: ID.nicelia, since: '2026-09-30' }];
    d.base.slots = d.base.slots.map((s) => (s.asbId === ID.nicelia && s.kind === 'sala' ? { ...s, asbId: ID.ana } : s));
    expect(proteseAlerts(d, '2026-10-01')).toHaveLength(1);
    expect(nextProteseRecords(d, '2026-10-01')?.find((r) => r.dentistId === ID.isac)?.asbId).toBe(ID.nicelia);
    // 30 dias depois, libera
    expect(proteseAlerts(d, '2026-10-30')).toHaveLength(0);
    expect(nextProteseRecords(d, '2026-10-30')?.find((r) => r.dentistId === ID.isac)?.asbId).toBe(ID.ana);
  });
});

describe('ausências sobrepostas', () => {
  it('só a primeira ausência da ASB vale no dia, sem alertas duplicados', () => {
    const d = seed();
    d.absences.push(absence({ asbId: ID.laura, from: '2026-09-14', to: '2026-09-18', reason: 'Férias', substitute: { asbId: ID.amanda } }));
    d.absences.push(absence({ id: 'abs-2', asbId: ID.laura, from: '2026-09-15', to: '2026-09-15', reason: 'Atestado' }));
    const day = effectiveDay(d, '2026-09-15');
    expect(day.absences).toHaveLength(1);
    expect(day.absences[0].reason).toBe('Férias');
    const alerts = analyze(d, day);
    expect(alerts.filter((a) => a.code === 'ausente-sem-substituta')).toEqual([]);
    expect(day.slots.filter((s) => s.who.type === 'asb' && s.who.asbId === ID.amanda && s.hour === 11)).toHaveLength(1);
  });

  it('overlappingAbsences acha o choque e ignora a própria ao editar', () => {
    const d = seed();
    d.absences.push(absence({ id: 'a1', asbId: ID.laura, from: '2026-09-14', to: '2026-09-18' }));
    expect(overlappingAbsences(d, ID.laura, '2026-09-18', '2026-09-20')).toHaveLength(1);
    expect(overlappingAbsences(d, ID.laura, '2026-09-19', '2026-09-20')).toHaveLength(0);
    expect(overlappingAbsences(d, ID.laura, '2026-09-14', '2026-09-18', 'a1')).toHaveLength(0);
    expect(overlappingAbsences(d, ID.ana, '2026-09-14', '2026-09-18')).toHaveLength(0);
  });
});

describe('rodízio com substituta indisponível', () => {
  const almox = (d: ReturnType<typeof seed>) => d.tasks.find((t) => t.id === 'id026')!;

  it('substituta também ausente vira "sem substituta"', () => {
    const d = seed();
    d.absences.push(absence({ asbId: ID.laura, from: '2026-09-14', to: '2026-09-14', substitute: { asbId: ID.amanda } }));
    d.absences.push(absence({ asbId: ID.amanda, from: '2026-09-14', to: '2026-09-14' }));
    const r = resolveTask(d, almox(d), '2026-09-14');
    expect(r.holders).toEqual([]);
    expect(r.noSubstitute).toBe(true);
    expect(r.reason).toContain('Amanda também está ausente');
  });

  it('substituta inativa vira "sem substituta"', () => {
    const d = seed();
    d.asbs.find((a) => a.id === ID.amanda)!.active = false;
    d.absences.push(absence({ asbId: ID.laura, from: '2026-09-14', to: '2026-09-14', substitute: { asbId: ID.amanda } }));
    const r = resolveTask(d, almox(d), '2026-09-14');
    expect(r.holders).toEqual([]);
    expect(r.reason).toContain('inativa');
  });

  it('titular inativa que ficou na ordem é apontada', () => {
    const d = seed();
    d.asbs.find((a) => a.id === ID.laura)!.active = false;
    const r = resolveTask(d, almox(d), '2026-09-14');
    expect(r.titularInactive).toBe(true);
    expect(r.titularAbsent).toBe(false);
    expect(r.holders).toEqual([]);
    expect(r.reason).toContain('inativa');
  });
});

describe('validação do backup registro a registro', () => {
  it('rejeita ASB sem nome', () => {
    const d = seedData();
    (d.asbs[0] as { name?: string }).name = undefined;
    expect(() => parseBackup(JSON.stringify(d))).toThrow(BackupError);
    expect(() => parseBackup(JSON.stringify(d))).toThrow(/ASB 1 incompleta/);
  });

  it('rejeita ficha apontando para ASB inexistente e dentista sem sala', () => {
    const d = seedData();
    d.base.slots[0].asbId = 'nao-existe';
    expect(() => parseBackup(JSON.stringify(d))).toThrow(/aponta para uma ASB/);
    const e = seedData();
    e.dentists[0].roomId = 'sala-fantasma';
    expect(() => parseBackup(JSON.stringify(e))).toThrow(/sala que não existe/);
  });

  it('aceita o seed exportado', () => {
    expect(() => parseBackup(exportBackup(seedData()))).not.toThrow();
  });
});

describe('remover sala', () => {
  it('remove os dentistas da sala e as tarefas que seguem esses dentistas', () => {
    const d = seed();
    removeRoom(d, 's1');
    expect(d.rooms.some((r) => r.id === 's1')).toBe(false);
    expect(d.dentists.some((x) => x.roomId === 's1')).toBe(false);
    expect(d.tasks.some((t) => t.assignment.mode === 'dentist' && ['id001', 'id005', 'id010'].includes(t.assignment.dentistId))).toBe(false);
    expect(d.base.slots.some((s) => s.roomId === 's1')).toBe(false);
    expect(d.tasks).toHaveLength(6);
  });
});
