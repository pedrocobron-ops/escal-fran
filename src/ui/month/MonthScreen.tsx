import { useMemo, useState } from 'react';
import type { Task } from '../../domain';
import {
  absencesBetween, firstOfMonth, formatDate, formatDayMonth, formatMonth, isExternalSubstitute, isTeamSubstitute, lastOfMonth, monthRotation, weeksOfMonth,
} from '../../domain';
import { useData } from '../../store/useStore';
import { colorMap } from '../colors';
import { MonthPicker, currentYearMonth, type YearMonth } from '../common/MonthPicker';
import { MonthCalendar } from '../absences/AbsencesScreen';
import { PdfButtons } from '../../pdf/PdfButtons';

export function MonthScreen() {
  const data = useData();
  const [ym, setYm] = useState<YearMonth>(currentYearMonth());
  const colors = useMemo(() => colorMap(data.asbs), [data.asbs]);
  const name = (id: string) => data.asbs.find((a) => a.id === id)?.name ?? '?';
  const weeks = weeksOfMonth(ym.year, ym.month);
  const rotations = data.tasks.filter((t): t is Task & { assignment: { mode: 'rotation' } } => t.assignment.mode === 'rotation');
  const weekly = rotations.filter((t) => t.assignment.period === 'week');
  const monthly = rotations.filter((t) => t.assignment.period === 'month');
  const absences = absencesBetween(data, firstOfMonth(ym.year, ym.month), lastOfMonth(ym.year, ym.month)).sort((a, b) => a.from.localeCompare(b.from));

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
                  const r = monthRotation(data, t, ym.year, ym.month);
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
                const r = monthRotation(data, t, ym.year, ym.month);
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
          <MonthCalendar ym={ym} absences={data.absences} colors={colors} nameOf={name} openDays={data.openDays} />
        </div>
      </section>
    </div>
  );
}
