import { useMemo, useState } from 'react';
import type { Task } from '../../domain';
import {
  absencesBetween, dataForDate, dentistAbsencesBetween, validExtraShiftsBetween, firstOfMonth, WEEKDAY_SHORT, weekdayOf, formatDate, formatDayMonth, formatMonth, formatRange,
  findAsbAnywhere, findDentistAnywhere, isExternalSubstitute, isTeamSubstitute, lastOfMonth, monthRotation, rotationTasksInMonth, weeksOfMonth,
} from '../../domain';
import { useData } from '../../store/useStore';
import { colorMap } from '../colors';
import { MonthPicker, currentYearMonth, type YearMonth } from '../common/MonthPicker';
import { MonthCalendar } from '../absences/AbsencesScreen';
import { PdfButtons } from '../../pdf/PdfButtons';
import { describeTaskHolder, extraTotalsByAsb } from '../../pdf/model';

export function MonthScreen() {
  const current = useData();
  const [ym, setYm] = useState<YearMonth>(currentYearMonth());
  // Mês passado: rodízios e nomes como estavam no fim daquele mês.
  const data = useMemo(() => dataForDate(current, lastOfMonth(ym.year, ym.month)), [current, ym]);
  const colors = useMemo(() => colorMap(data.asbs), [data.asbs]);
  const name = (id: string) => findAsbAnywhere(data, id)?.name ?? '?';
  const weeks = weeksOfMonth(ym.year, ym.month);
  const rotations = rotationTasksInMonth(current, ym.year, ym.month).filter((t): t is Task & { assignment: { mode: 'rotation' } } => t.assignment.mode === 'rotation');
  const weekly = rotations.filter((t) => t.assignment.period === 'week');
  const monthly = rotations.filter((t) => t.assignment.period === 'month');
  const daily = data.tasks.filter((t) => t.assignment.mode !== 'rotation');
  const first = firstOfMonth(ym.year, ym.month);
  const last = lastOfMonth(ym.year, ym.month);
  const absences = absencesBetween(data, first, last).sort((a, b) => a.from.localeCompare(b.from));
  const dentAbs = dentistAbsencesBetween(data, first, last).sort((a, b) => a.from.localeCompare(b.from));
  const extras = validExtraShiftsBetween(data, first, last).sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  const dentName = (id: string) => findDentistAnywhere(data, id)?.name ?? '?';

  return (
    <div className="stack">
      <div className="toolbar">
        <h1>Visão do mês</h1>
        <MonthPicker value={ym} onChange={setYm} />
        <span className="spacer" />
        <PdfButtons ym={ym} />
      </div>

      <section className="card">
        <h2>Rodízios semanais de {formatMonth(ym.year, ym.month)}</h2>
        {weekly.length === 0 ? (
          <p className="muted">Nenhum rodízio semanal cadastrado.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Tarefa</th>
                  {weeks.map((w) => (
                    <th key={w.index}>Semana {w.index}<br /><span className="muted small">{formatDayMonth(w.days[0])} a {formatDayMonth(w.days[w.days.length - 1])}</span></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weekly.map((t) => {
                  const r = monthRotation(current, t, ym.year, ym.month);
                  return (
                    <tr key={t.id}>
                      <td>{t.name}<br /><span className="muted small">{t.when}</span></td>
                      {weeks.map((w) => {
                        const e = r?.weeks.find((x) => x.week.index === w.index);
                        return (
                          <td key={w.index}>
                            {e ? (
                              <>
                                <span className="chip static" style={{ background: colors.get(e.titularId) }}>{name(e.titularId)}</span>
                                {e.absentDays.length > 0 && <div className="small error">ausente: {e.absentDays.map(formatDayMonth).join(', ')}</div>}
                              </>
                            ) : <span className="muted">-</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Rodízios mensais</h2>
        {monthly.length === 0 ? (
          <p className="muted">Nenhum rodízio mensal cadastrado.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Tarefa</th><th>Titular do mês</th></tr></thead>
            <tbody>
              {monthly.map((t) => {
                const r = monthRotation(current, t, ym.year, ym.month);
                return (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>{r?.monthTitularId ? <span className="chip static" style={{ background: colors.get(r.monthTitularId) }}>{name(r.monthTitularId)}</span> : <span className="muted">sem ordem definida</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Tarefas diárias e responsáveis</h2>
        {daily.length === 0 ? (
          <p className="muted">Nenhuma tarefa diária cadastrada.</p>
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>Tarefa</th><th>Quem faz no mês</th></tr></thead>
              <tbody>
                {daily.map((t) => (
                  <tr key={t.id}>
                    <td><strong>{t.name}</strong><br /><span className="muted small">{t.when}</span></td>
                    <td data-label="Quem faz">{describeTaskHolder(current, t, first, last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small" style={{ marginTop: 6 }}>Para deixar alguém fixa numa tarefa (por exemplo, o mês inteiro na conferência de prótese), use "Responsável fixo por período" em Tarefas e rodízios.</p>
      </section>

      <section className="card">
        <h2>Ausências e coberturas</h2>
        {absences.length === 0 ? (
          <p className="muted">Nenhuma ausência neste mês.</p>
        ) : (
          <table className="table">
            <thead><tr><th>ASB</th><th>Período</th><th>Motivo</th><th>Quem cobre</th></tr></thead>
            <tbody>
              {absences.map((a) => (
                <tr key={a.id}>
                  <td>{name(a.asbId)}</td>
                  <td className="mono">{a.from === a.to ? formatDate(a.from) : `${formatDate(a.from)} a ${formatDate(a.to)}`}</td>
                  <td>{a.reason}</td>
                  <td>{isTeamSubstitute(a) ? name(a.substitute.asbId) : isExternalSubstitute(a) ? `${a.substitute.externalName} (externa)` : <span className="muted">sem substituta</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ marginTop: 12 }}>
          <MonthCalendar ym={ym} data={data} colors={colors} />
        </div>
      </section>

      <section className="card">
        <h2>Folgas de dentista</h2>
        {dentAbs.length === 0 ? (
          <p className="muted">Nenhuma folga de dentista neste mês.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Dentista</th><th>Período</th><th>Motivo</th></tr></thead>
            <tbody>
              {dentAbs.map((a) => (
                <tr key={a.id}>
                  <td>{dentName(a.dentistId)}</td>
                  <td className="mono">{a.from === a.to ? formatDate(a.from) : `${formatDate(a.from)} a ${formatDate(a.to)}`}</td>
                  <td>{a.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Horas extras</h2>
        {extras.length > 0 && (
          <p>
            <strong>Total no mês</strong> (horas fora do contrato, para pagamento):{' '}
            {extraTotalsByAsb(current, first, last).map((t) => `${t.asb} ${t.hours}h`).join(', ') || 'nenhuma'}.
          </p>
        )}
        {extras.length === 0 ? (
          <p className="muted">Nenhuma hora extra neste mês.</p>
        ) : (
          <table className="table">
            <thead><tr><th>ASB</th><th>Data</th><th>Horário</th><th>Obs.</th></tr></thead>
            <tbody>
              {extras.map((e) => (
                <tr key={e.id}>
                  <td>{name(e.asbId)}</td>
                  <td className="mono">{WEEKDAY_SHORT[weekdayOf(e.date)]}, {formatDate(e.date)}</td>
                  <td className="mono">{formatRange(e.start, e.end)}</td>
                  <td>{e.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
