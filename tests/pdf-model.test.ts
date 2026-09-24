import { describe, expect, it } from 'vitest';
import { dayPdfModel, monthPdfModel, openingLabel } from '../src/pdf/model';
import { ID, absence, seed } from './helpers';

describe('modelo do PDF do mês', () => {
  const m = monthPdfModel(seed(), 2026, 9, new Date(2026, 8, 24, 14, 32));

  it('cabeçalho', () => {
    expect(m.title).toBe('Escala mensal de trabalho - CEO');
    expect(m.monthLabel).toBe('setembro de 2026');
    expect(m.hoursLabel).toBe('Horário de funcionamento: 07h–19h, segunda a sexta');
    expect(m.generatedAt).toBe('Gerado em 24/09/2026 às 14:32');
  });

  it('escala base diária das ASBs em texto corrido', () => {
    const pamela = m.asbRows.find((r) => r.name === 'Pâmela')!;
    expect(pamela.contract).toBe('07h–16h');
    expect(pamela.morning).toBe('Sala 4 (Dra. Juliana, 07h–11h), Sala 4 (Dr. Marco, 12h–13h)');
    expect(pamela.lunch).toBe('11h–12h');
    expect(pamela.afternoon).toBe('Sala 4 (Dr. Marco, 13h–15h), Apoio / Recepção (15h–16h)');
    const andrea = m.asbRows.find((r) => r.name === 'Andrea')!;
    expect(andrea.lunch).toBe('não sai');
    expect(andrea.afternoon).toBe('-');
    const laura = m.asbRows.find((r) => r.name === 'Laura')!;
    expect(laura.morning).toBe('CME / Arsenal (07h–08h), Sala 1 (Dr. Francisco, 08h–11h), Sala 1 (Dra. Priscila, 11h–12h)');
  });

  it('ocupação das salas por horário', () => {
    expect(m.roomNames).toEqual(['Sala 1', 'Sala 2', 'Sala 3', 'Sala 4']);
    expect(m.roomRows).toHaveLength(12);
    expect(m.roomRows[0].cells[0]).toEqual({ dentist: 'sala vazia', asb: '' });
    expect(m.roomRows[1].cells[0]).toEqual({ dentist: 'Dr. Francisco (Estomatologia)', asb: 'ASB: Laura' });
    expect(m.roomRows[11].cells[1]).toEqual({ dentist: 'Dr. Edson (Periodontia)', asb: 'SEM ASB' });
  });

  it('rodízios por semana e mensais', () => {
    expect(m.weekHeaders).toEqual([
      'Semana 1 (01/09 a 04/09)', 'Semana 2 (07/09 a 11/09)', 'Semana 3 (14/09 a 18/09)', 'Semana 4 (21/09 a 25/09)', 'Semana 5 (28/09 a 30/09)',
    ]);
    expect(m.weeklyRows).toHaveLength(1);
    expect(m.weeklyRows[0].cells).toEqual(['Priscila', 'Amanda', 'Laura', 'Pâmela', 'Priscila']);
    expect(m.monthlyRows).toEqual([{ task: 'Planilhas de Semio (Estomatologia)', when: 'Mensal', holder: 'Laura' }]);
  });

  it('regras e ausências', () => {
    expect(m.rules).toHaveLength(5);
    expect(m.absences).toEqual([]);
    const d = seed();
    d.absences.push(absence({ asbId: ID.laura, from: '2026-09-14', to: '2026-09-18', reason: 'Férias', substitute: { asbId: ID.amanda } }));
    const m2 = monthPdfModel(d, 2026, 9);
    expect(m2.absences).toEqual([{ asb: 'Laura', period: '14/09/2026 a 18/09/2026', reason: 'Férias', cover: 'Amanda' }]);
    expect(m2.weeklyRows[0].cells[2]).toBe('Laura (ausente 14/09, 15/09)');
  });

  it('dias de funcionamento fora do padrão aparecem por extenso', () => {
    const d = seed();
    d.openDays = [1, 2, 3, 4, 5, 6];
    expect(openingLabel(d)).toBe('Horário de funcionamento: 07h–19h, seg, ter, qua, qui, sex, sáb');
  });
});

describe('modelo do PDF do dia', () => {
  it('aplica ausências e lista tarefas e alertas', () => {
    const d = seed();
    d.absences.push(absence({ asbId: ID.laura, from: '2026-09-14', to: '2026-09-14', reason: 'Atestado', substitute: { externalName: 'Carla' } }));
    const m = dayPdfModel(d, '2026-09-14');
    expect(m.dateLabel).toBe('Segunda, 14/09/2026');
    expect(m.open).toBe(true);
    expect(m.absences).toEqual([{ asb: 'Laura', period: '14/09/2026', reason: 'Atestado', cover: 'Carla (externa)' }]);
    expect(m.columns).toEqual(['Sala 1', 'Sala 2', 'Sala 3', 'Sala 4', 'Apoio / Recepção', 'CME / Arsenal', 'Almoxarifado', 'Almoço']);
    expect(m.rows[1].cells[0].asb).toBe('ASB: Carla (externa)');
    expect(m.rows[0].cells[5].asb).toBe('Carla (externa)');
    expect(m.rows[4].cells[7].asb).toBe('Pâmela');
    const cme = m.tasks.find((t) => t.task.startsWith('CME / Arsenal (manhã)'))!;
    expect(cme.holder).toBe('Carla (externa)');
    expect(m.tasks.some((t) => t.task === 'Drenar compressor')).toBe(false); // segunda
    expect(m.alerts).toEqual(['CRÍTICO: Sala 2 às 18h: Dr. Edson atendendo sem ASB.']);
  });

  it('dia fechado', () => {
    const m = dayPdfModel(seed(), '2026-09-13');
    expect(m.open).toBe(false);
    expect(m.tasks).toEqual([]);
  });
});

describe('PDF do dia com ASB ausente', () => {
  it('mostra "Ausente (motivo)" em vez de escala vazia', () => {
    const d = seed();
    d.absences.push(absence({ asbId: ID.laura, from: '2026-09-14', to: '2026-09-14', reason: 'Férias' }));
    const m = dayPdfModel(d, '2026-09-14');
    const laura = m.asbRows.find((r) => r.name === 'Laura')!;
    expect(laura).toEqual({ name: 'Laura', contract: '07h–16h', morning: 'Ausente (Férias)', lunch: '-', afternoon: 'Ausente (Férias)' });
  });
});
