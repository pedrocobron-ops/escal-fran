import { useEffect, useMemo, useState } from 'react';
import type { Absence, AbsenceReason, AppData, DentistAbsence, ExtraShift, IsoDate } from '../../domain';
import {
  ABSENCE_REASONS, WEEKDAY_SHORT, absenceFor, absencesBetween, addDays, analyze, coverageSuggestions, dataForDate, dentistAbsencesBetween,
  dentistWorksOn, dentistsAt, effectiveDay, extraNeededToCover, findAsbAnywhere, findDentistAnywhere, firstOfMonth, formatDate, formatDayMonth, formatHour, formatRange, groupHours, isBetween,
  isExternalSubstitute, isOpenOn, isReasonablePeriod, isTeamSubstitute, lastOfMonth, mondayOf, outsideContract, overlappingAbsences,
  overlappingDentistAbsences, overlappingExtras, stillUncovered, todayIso, validExtraShiftsBetween, weekdayOf,
} from '../../domain';
import { newId, useData, useStore } from '../../store/useStore';
import { colorMap } from '../colors';
import { Modal, useConfirm } from '../common/Modal';
import { Field, HourSelect } from '../common/fields';
import { MonthPicker, currentYearMonth, type YearMonth } from '../common/MonthPicker';
import { ChoiceDialog, type Choice } from '../board/RangeDialog';

type Tab = 'asb' | 'extra' | 'dentista';

function period(from: string, to: string): string {
  return from === to ? formatDate(from) : `${formatDate(from)} a ${formatDate(to)}`;
}

function openDaysIn(data: AppData, from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  if (!isReasonablePeriod(from, to)) return out;
  for (let d = from; d <= to; d = addDays(d, 1)) if (isOpenOn(dataForDate(data, d), d)) out.push(d);
  return out;
}

export function AbsencesScreen() {
  const data = useData();
  const apply = useStore((s) => s.apply);
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>('asb');
  const [ym, setYm] = useState<YearMonth>(currentYearMonth());
  const [allMonths, setAllMonths] = useState(false);
  const [editAbs, setEditAbs] = useState<Absence | 'new' | null>(null);
  const [editExtra, setEditExtra] = useState<ExtraShift | 'new' | null>(null);
  const [editDent, setEditDent] = useState<DentistAbsence | 'new' | null>(null);
  const colors = useMemo(() => colorMap(data.asbs), [data.asbs]);
  const asbName = (id: string) => findAsbAnywhere(data, id)?.name ?? '?';
  const dentName = (id: string) => findDentistAnywhere(data, id)?.name ?? '?';
  const first = firstOfMonth(ym.year, ym.month);
  const last = lastOfMonth(ym.year, ym.month);
  const inMonth = (from: string, to: string) => allMonths || (from <= last && to >= first);

  // Depois de salvar, mostra o mês do que foi cadastrado (senão some da lista filtrada).
  const showMonthOf = (iso: IsoDate) => {
    if (!allMonths && (iso < first || iso > last)) setYm({ year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) });
  };

  const linkedExtras = (absId: string) => (data.extraShifts ?? []).filter((e) => e.absenceId === absId);

  const today = todayIso();
  const [ending, setEnding] = useState<{ kind: 'asb'; item: Absence } | { kind: 'dent'; item: DentistAbsence } | null>(null);

  /** Encerra ontem uma ausência que já começou: os dias passados continuam como foram. */
  const endYesterday = (target: NonNullable<typeof ending>) => {
    const until = addDays(today, -1);
    if (target.kind === 'asb') {
      apply((d) => {
        d.absences = d.absences.map((x) => (x.id === target.item.id ? { ...x, to: until } : x));
        d.extraShifts = (d.extraShifts ?? []).filter((e) => !(e.absenceId === target.item.id && e.date >= today));
      });
    } else {
      apply((d) => { d.dentistAbsences = (d.dentistAbsences ?? []).map((x) => (x.id === target.item.id ? { ...x, to: until } : x)); });
    }
    setEnding(null);
  };
  const deleteAll = (target: NonNullable<typeof ending>) => {
    if (target.kind === 'asb') {
      apply((d) => {
        d.absences = d.absences.filter((x) => x.id !== target.item.id);
        d.extraShifts = (d.extraShifts ?? []).filter((e) => e.absenceId !== target.item.id);
      });
    } else {
      apply((d) => { d.dentistAbsences = (d.dentistAbsences ?? []).filter((x) => x.id !== target.item.id); });
    }
    setEnding(null);
  };

  const removeAbs = async (a: Absence) => {
    if (a.from < today) {
      setEnding({ kind: 'asb', item: a });
      return;
    }
    const linked = linkedExtras(a.id);
    const ok = await confirm({
      title: 'Remover ausência?',
      message: (
        <>
          {asbName(a.asbId)}, {period(a.from, a.to)}.
          {linked.length > 0 && <> As {linked.length} horas extras criadas para cobrir essa ausência também serão removidas.</>}
        </>
      ),
      confirmLabel: 'Remover',
      danger: true,
    });
    if (ok) apply((d) => {
      d.absences = d.absences.filter((x) => x.id !== a.id);
      d.extraShifts = (d.extraShifts ?? []).filter((e) => e.absenceId !== a.id);
    });
  };
  const removeExtra = async (e: ExtraShift) => {
    const ok = await confirm({ title: 'Remover hora extra?', message: <>{asbName(e.asbId)}, {formatDate(e.date)}, {formatRange(e.start, e.end)}.</>, confirmLabel: 'Remover', danger: true });
    if (ok) apply((d) => { d.extraShifts = (d.extraShifts ?? []).filter((x) => x.id !== e.id); });
  };
  const removeDent = async (a: DentistAbsence) => {
    if (a.from < today) {
      setEnding({ kind: 'dent', item: a });
      return;
    }
    const ok = await confirm({ title: 'Remover folga do dentista?', message: <>{dentName(a.dentistId)}, {period(a.from, a.to)}.</>, confirmLabel: 'Remover', danger: true });
    if (ok) apply((d) => { d.dentistAbsences = (d.dentistAbsences ?? []).filter((x) => x.id !== a.id); });
  };

  const absences = [...data.absences].filter((a) => inMonth(a.from, a.to)).sort((a, b) => b.from.localeCompare(a.from));
  const extras = [...(data.extraShifts ?? [])].filter((e) => inMonth(e.date, e.date)).sort((a, b) => b.date.localeCompare(a.date) || a.start - b.start);
  const dentAbs = [...(data.dentistAbsences ?? [])].filter((a) => inMonth(a.from, a.to)).sort((a, b) => b.from.localeCompare(a.from));
  const countAll = { asb: data.absences.length, extra: (data.extraShifts ?? []).length, dentista: (data.dentistAbsences ?? []).length };

  const newLabel = tab === 'asb' ? 'Nova ausência de ASB' : tab === 'extra' ? 'Nova hora extra' : 'Nova folga de dentista';
  const onNew = () => (tab === 'asb' ? setEditAbs('new') : tab === 'extra' ? setEditExtra('new') : setEditDent('new'));
  const scope = allMonths ? 'todos os meses' : `${formatDayMonth(first)} a ${formatDayMonth(last)}`;

  return (
    <div>
      <div className="toolbar">
        <h1>Ausências e extras</h1>
        <span className="spacer" />
        <button className="btn primary" onClick={onNew}>{newLabel}</button>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" className={tab === 'asb' ? 'active' : ''} onClick={() => setTab('asb')}>Folgas e faltas de ASB ({countAll.asb})</button>
        <button role="tab" className={tab === 'extra' ? 'active' : ''} onClick={() => setTab('extra')}>Horas extras ({countAll.extra})</button>
        <button role="tab" className={tab === 'dentista' ? 'active' : ''} onClick={() => setTab('dentista')}>Folgas de dentista ({countAll.dentista})</button>
      </div>
      <div className="board-layout">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="toolbar">
            <MonthPicker value={ym} onChange={setYm} />
          </div>
          <MonthCalendar ym={ym} data={data} colors={colors} />
          <p className="muted small" style={{ marginTop: 6 }}>
            No calendário: ASB ausente na cor dela, <strong>+ nome</strong> em verde para hora extra, dentista de folga em cinza escuro.
            Dia com borda vermelha tem sala com dentista e sem ASB. Toque num dia para abrir o Quadro nessa data, com horários e motivos.
          </p>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="toolbar" style={{ marginBottom: 6 }}>
            <span className="muted small">Mostrando: {scope}</span>
            <label className="list-toggle"><input type="checkbox" checked={allMonths} onChange={(e) => setAllMonths(e.target.checked)} /> todos os meses</label>
          </div>
          {tab === 'asb' && (
            absences.length === 0 ? (
              <p className="card muted">Nenhuma ausência {allMonths ? 'cadastrada' : 'neste mês'}. Férias, atestados, folgas e faltas entram aqui. Ao cadastrar, o app sugere quem pode cobrir.</p>
            ) : (
              <div className="table-wrap">
                <table className="table responsive">
                  <thead><tr><th>ASB</th><th>Período</th><th>Motivo</th><th>Quem cobre</th><th></th></tr></thead>
                  <tbody>
                    {absences.map((a) => (
                      <tr key={a.id}>
                        <td><span className="chip static" style={{ background: colors.get(a.asbId) ?? '#555' }}>{asbName(a.asbId)}</span></td>
                        <td className="mono" data-label="Período">{period(a.from, a.to)}</td>
                        <td data-label="Motivo">{a.reason}</td>
                        <td data-label="Quem cobre">
                          {isTeamSubstitute(a) ? asbName(a.substitute.asbId) : isExternalSubstitute(a) ? `${a.substitute.externalName} (externa)` : <span className="muted">sem substituta</span>}
                          {linkedExtras(a.id).length > 0 && <span className="muted small"> (+{linkedExtras(a.id).length} hora{linkedExtras(a.id).length > 1 ? 's' : ''} extra{linkedExtras(a.id).length > 1 ? 's' : ''})</span>}
                        </td>
                        <td className="actions">
                          <button className="btn sm" onClick={() => setEditAbs(a)}>Editar</button>{' '}
                          <button className="btn sm danger" onClick={() => removeAbs(a)}>Remover</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
          {tab === 'extra' && (
            extras.length === 0 ? (
              <p className="card muted">Nenhuma hora extra {allMonths ? 'cadastrada' : 'neste mês'}. Cadastre aqui os dias em que uma ASB entra mais cedo ou sai mais tarde. No Modo Dia do quadro ela pode ser colocada nesses horários, e o app a usa sozinho para cobrir sala, CME ou almoxarifado sem ninguém.</p>
            ) : (
              <div className="table-wrap">
                <table className="table responsive">
                  <thead><tr><th>ASB</th><th>Data</th><th>Horário extra</th><th>Obs.</th><th></th></tr></thead>
                  <tbody>
                    {extras.map((e) => {
                      const absent = absenceFor(data, e.asbId, e.date);
                      return (
                        <tr key={e.id}>
                          <td><span className="chip static" style={{ background: colors.get(e.asbId) ?? '#555' }}>{asbName(e.asbId)}</span></td>
                          <td className="mono" data-label="Data">{WEEKDAY_SHORT[weekdayOf(e.date)]}, {formatDate(e.date)}</td>
                          <td className="mono" data-label="Horário">{formatRange(e.start, e.end)}</td>
                          <td data-label="Obs.">
                            {e.note ?? ''}
                            {absent && <span className="error small"> {e.note ? '. ' : ''}Não vale: ela está ausente nesse dia ({absent.reason}).</span>}
                          </td>
                          <td className="actions">
                            <button className="btn sm" onClick={() => setEditExtra(e)}>Editar</button>{' '}
                            <button className="btn sm danger" onClick={() => removeExtra(e)}>Remover</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
          {tab === 'dentista' && (
            dentAbs.length === 0 ? (
              <p className="card muted">Nenhuma folga de dentista {allMonths ? 'cadastrada' : 'neste mês'}. Quando um dentista folga, a sala dele fica sem atendimento e o app remaneja a ASB dessa sala para outra que esteja sem ASB.</p>
            ) : (
              <div className="table-wrap">
                <table className="table responsive">
                  <thead><tr><th>Dentista</th><th>Período</th><th>Motivo</th><th></th></tr></thead>
                  <tbody>
                    {dentAbs.map((a) => (
                      <tr key={a.id}>
                        <td><strong>{dentName(a.dentistId)}</strong></td>
                        <td className="mono" data-label="Período">{period(a.from, a.to)}</td>
                        <td data-label="Motivo">{a.reason}</td>
                        <td className="actions">
                          <button className="btn sm" onClick={() => setEditDent(a)}>Editar</button>{' '}
                          <button className="btn sm danger" onClick={() => removeDent(a)}>Remover</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      </div>

      {editAbs && (
        <AbsenceForm
          absence={editAbs === 'new' ? undefined : editAbs}
          onClose={() => setEditAbs(null)}
          onSave={(a, newExtras) => {
            apply((d) => {
              const i = d.absences.findIndex((x) => x.id === a.id);
              if (i >= 0) d.absences[i] = a;
              else d.absences.push(a);
              // As horas extras criadas por esta ausência são refeitas conforme a escolha atual.
              d.extraShifts = [...(d.extraShifts ?? []).filter((e) => e.absenceId !== a.id), ...newExtras];
            });
            showMonthOf(a.from);
            setEditAbs(null);
          }}
        />
      )}
      {editExtra && (
        <ExtraForm
          extra={editExtra === 'new' ? undefined : editExtra}
          onClose={() => setEditExtra(null)}
          onSave={(list, replacingId) => {
            apply((d) => {
              const rest = (d.extraShifts ?? []).filter((x) => x.id !== replacingId);
              d.extraShifts = [...rest, ...list];
            });
            if (list[0]) showMonthOf(list[0].date);
            setEditExtra(null);
          }}
        />
      )}
      {editDent && (
        <DentistAbsenceForm
          absence={editDent === 'new' ? undefined : editDent}
          onClose={() => setEditDent(null)}
          onSave={(a) => {
            apply((d) => {
              const list = d.dentistAbsences ?? [];
              const i = list.findIndex((x) => x.id === a.id);
              if (i >= 0) list[i] = a;
              else list.push(a);
              d.dentistAbsences = list;
            });
            showMonthOf(a.from);
            setEditDent(null);
          }}
        />
      )}
      {ending && (() => {
        const who = ending.kind === 'asb' ? asbName(ending.item.asbId) : dentName(ending.item.dentistId);
        const { from, to } = ending.item;
        const ongoing = to >= today;
        const linked = ending.kind === 'asb' ? linkedExtras(ending.item.id).length : 0;
        const choices: Choice[] = [];
        if (ongoing) {
          choices.push({
            label: from === addDays(today, -1) ? `Encerrar em ${formatDate(from)}` : `Encerrar em ${formatDate(addDays(today, -1))}`,
            hint: `${ending.kind === 'asb' ? 'Ela voltou' : 'Voltou a atender'}: os dias que já passaram continuam registrados; de hoje em diante não vale mais.${linked > 0 ? ' Horas extras dessa cobertura de hoje em diante também saem.' : ''}`,
            primary: true,
            onChoose: () => endYesterday(ending),
          });
        }
        choices.push({
          label: 'Apagar tudo',
          hint: `Foi cadastrada por engano: some também dos dias que já passaram, que voltam a mostrar a escala sem ela.${linked > 0 ? ` As ${linked} horas extras dessa cobertura também saem.` : ''}`,
          onChoose: () => deleteAll(ending),
        });
        return (
          <ChoiceDialog
            title={ending.kind === 'asb' ? 'Remover ausência?' : 'Remover folga do dentista?'}
            message={`${who}, ${period(from, to)}. ${ongoing ? 'Essa ausência já começou.' : 'Essa ausência já passou.'}`}
            choices={choices}
            onClose={() => setEnding(null)}
          />
        );
      })()}
    </div>
  );
}

/** Dias do mês com sala com dentista e sem ASB (críticos). */
function problemDays(data: AppData, first: IsoDate, last: IsoDate): Set<IsoDate> {
  const out = new Set<IsoDate>();
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const day = effectiveDay(data, d);
    if (!day.open) continue;
    if (analyze(data, day).some((a) => a.code === 'sala-sem-asb')) out.add(d);
  }
  return out;
}

export function MonthCalendar({ ym, data, colors }: { ym: YearMonth; data: AppData; colors: Map<string, string> }) {
  const first = firstOfMonth(ym.year, ym.month);
  const last = lastOfMonth(ym.year, ym.month);
  const start = mondayOf(first);
  const end = addDays(mondayOf(last), 6);
  const cells: string[] = [];
  for (let iso = start; iso <= end; iso = addDays(iso, 1)) cells.push(iso);
  const monthAbs = absencesBetween(data, first, last);
  const monthDent = dentistAbsencesBetween(data, first, last);
  const monthExtra = validExtraShiftsBetween(data, first, last);
  const problems = useMemo(() => problemDays(data, first, last), [data, first, last]);
  const asbName = (id: string) => findAsbAnywhere(data, id)?.name ?? '?';
  const dentName = (id: string) => findDentistAnywhere(data, id)?.name ?? '?';
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="calendar">
      {order.map((d) => <div key={d} className="dow">{WEEKDAY_SHORT[d]}</div>)}
      {cells.map((iso) => {
        const inMonth = iso >= first && iso <= last;
        const closed = !isOpenOn(dataForDate(data, iso), iso);
        const holiday = (data.closedDates ?? []).find((c) => c.date === iso);
        const problem = inMonth && problems.has(iso);
        const cls = `day${closed ? ' closed' : ''}${inMonth ? '' : ' other'}${problem ? ' problem' : ''}`;
        if (!inMonth) return <div key={iso} className={cls}><span className="n">{Number(iso.slice(8))}</span></div>;
        // Tocar num dia abre o Modo Dia do Quadro nessa data, com tudo o que muda nele.
        return (
          <a
            key={iso}
            href={`#/quadro/${iso}`}
            className={cls}
            title={`${problem ? 'Sala com dentista e sem ASB neste dia. ' : ''}Abrir ${formatDate(iso)} no Quadro`}
          >
            <span className="n">{Number(iso.slice(8))}</span>
            {problem && <span className="flag" aria-label="sala sem ASB">!</span>}
            {inMonth && holiday && <span className="abs holiday" title={holiday.note ?? 'Fechado'}>{holiday.note || 'Fechado'}</span>}
            {inMonth && monthAbs.filter((a) => isBetween(iso, a.from, a.to)).map((a) => (
              <span key={a.id} className="abs" style={{ background: colors.get(a.asbId) ?? '#555' }} title={`${asbName(a.asbId)}: ${a.reason}`}>{asbName(a.asbId)}</span>
            ))}
            {inMonth && monthExtra.filter((e) => e.date === iso).map((e) => (
              <span key={e.id} className="abs extra" title={`${asbName(e.asbId)}: hora extra ${formatRange(e.start, e.end)}`}>+ {asbName(e.asbId)}</span>
            ))}
            {inMonth && monthDent.filter((a) => isBetween(iso, a.from, a.to)).map((a) => (
              <span key={a.id} className="abs dentist" title={`${dentName(a.dentistId)}: ${a.reason}`}>{dentName(a.dentistId)}</span>
            ))}
          </a>
        );
      })}
    </div>
  );
}

const MAX_EXTRA_PER_DAY = 2;

function AbsenceForm({ absence, onClose, onSave }: { absence?: Absence; onClose: () => void; onSave: (a: Absence, extras: ExtraShift[]) => void }) {
  const data = useData();
  const active = data.asbs.filter((a) => a.active);
  const linked = absence ? (data.extraShifts ?? []).filter((e) => e.absenceId === absence.id) : [];
  const [asbId, setAsbId] = useState(absence?.asbId ?? active[0]?.id ?? '');
  const [from, setFrom] = useState(absence?.from ?? todayIso());
  const [to, setTo] = useState(absence?.to ?? todayIso());
  const [reason, setReason] = useState<AbsenceReason>(absence?.reason ?? 'Folga');
  const initialCover = absence ? (isTeamSubstitute(absence) ? 'team' : isExternalSubstitute(absence) ? 'external' : 'none') : 'none';
  const [cover, setCover] = useState<'none' | 'team' | 'external'>(initialCover);
  const [subId, setSubId] = useState(absence && isTeamSubstitute(absence) ? absence.substitute.asbId : '');
  const [external, setExternal] = useState(absence && isExternalSubstitute(absence) ? absence.substitute.externalName : '');
  // Nova ausência: sugerir criar a hora extra. Editando: manter o que já estava (tinha hora extra ligada ou não).
  const [createExtra, setCreateExtra] = useState(absence ? linked.length > 0 : true);
  const [error, setError] = useState<string | null>(null);

  const reasonable = isReasonablePeriod(from, to);
  const openDays = useMemo(() => openDaysIn(data, from, to), [data, from, to]);
  const linkedIds = linked.map((e) => e.id);
  const suggestions = useMemo(
    () => (reasonable && asbId ? coverageSuggestions({ ...data, extraShifts: (data.extraShifts ?? []).filter((e) => !linkedIds.includes(e.id)) }, asbId, from, to, absence?.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, asbId, from, to, reasonable, absence?.id],
  );
  const needed = useMemo(
    () => (reasonable && cover === 'team' && subId ? extraNeededToCover(data, asbId, subId, from, to, absence?.id, linkedIds) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, asbId, subId, from, to, cover, reasonable, absence?.id],
  );
  const total = suggestions[0]?.total ?? 0;
  const useful = suggestions.filter((s) => s.covered + s.needsExtra > 0);
  const sub = data.asbs.find((a) => a.id === subId);
  const absentName = data.asbs.find((a) => a.id === asbId)?.name ?? '';

  // Simula a ausência como está no formulário para mostrar o que continua descoberto.
  const remaining = useMemo(() => {
    if (!reasonable || !asbId) return [];
    const id = absence?.id ?? '__nova__';
    const substitute = cover === 'team' && subId ? { asbId: subId } : cover === 'external' && external.trim() ? { externalName: external.trim() } : undefined;
    const extras = cover === 'team' && subId && createExtra ? needed.map((n, i) => ({ id: `__sim${i}`, asbId: subId, date: n.date, start: n.start, end: n.end })) : [];
    const sim: AppData = {
      ...data,
      absences: [...data.absences.filter((a) => a.id !== id), { id, asbId, from, to, reason, substitute }],
      extraShifts: [...(data.extraShifts ?? []).filter((e) => e.absenceId !== id), ...extras],
    };
    return stillUncovered(sim, asbId, from, to);
  }, [data, asbId, from, to, reason, cover, subId, external, createExtra, needed, reasonable, absence?.id]);

  // Quem está ausente também é substituta de outra ausência no período?
  const coveringOthers = data.absences.filter(
    (a) => a.id !== absence?.id && isTeamSubstitute(a) && a.substitute.asbId === asbId && a.from <= to && a.to >= from,
  );
  // A ausente tem horas extras (não ligadas a esta ausência) no período?
  const ownExtras = (data.extraShifts ?? []).filter((e) => e.asbId === asbId && e.date >= from && e.date <= to && e.absenceId !== absence?.id);
  // Jornada da substituta com a hora extra.
  const longDays = sub
    ? [...new Set(needed.map((n) => n.date))]
        .map((date) => {
          const extraHours = needed.filter((n) => n.date === date).reduce((acc, n) => acc + (n.end - n.start), 0);
          const already = (data.extraShifts ?? []).filter((e) => e.asbId === sub.id && e.date === date && !linkedIds.includes(e.id)).reduce((acc, e) => acc + outsideContract(e.start, e.end, sub).reduce((s, [a, b]) => s + b - a, 0), 0);
          const starts = [sub.start, ...needed.filter((n) => n.date === date).map((n) => n.start)];
          const ends = [sub.end, ...needed.filter((n) => n.date === date).map((n) => n.end)];
          return { date, extra: extraHours + already, span: Math.max(...ends) - Math.min(...starts), start: Math.min(...starts), end: Math.max(...ends) };
        })
        .filter((x) => x.extra > MAX_EXTRA_PER_DAY)
    : [];

  // Nova ausência: a hora extra vem marcada, a não ser que passe do limite por dia;
  // aí fica desmarcada e a pessoa decide.
  const tooLong = longDays.length > 0;
  useEffect(() => {
    if (!absence) setCreateExtra(!tooLong);
  }, [absence, subId, tooLong]);

  const submit = () => {
    if (!asbId) return setError('Escolha a ASB.');
    if (!from || !to) return setError('Informe o período.');
    if (to < from) return setError('A data final precisa ser igual ou depois da inicial.');
    if (!reasonable) return setError('Confira as datas (período muito longo ou incompleto).');
    const clash = overlappingAbsences(data, asbId, from, to, absence?.id);
    if (clash.length > 0) {
      const c = clash[0];
      return setError(`Já existe uma ausência dessa ASB nesse período (${c.reason}, ${formatDate(c.from)} a ${formatDate(c.to)}). Edite ou remova a existente.`);
    }
    if (cover === 'team' && !subId) return setError('Escolha quem cobre.');
    if (cover === 'team' && subId === asbId) return setError('A substituta não pode ser a própria ausente.');
    if (cover === 'external' && !external.trim()) return setError('Informe o nome de quem cobre.');
    const id = absence?.id ?? newId('abs');
    const substitute = cover === 'team' ? { asbId: subId } : cover === 'external' ? { externalName: external.trim() } : undefined;
    const extras: ExtraShift[] =
      cover === 'team' && createExtra
        ? needed.map((n) => ({ id: newId('hx'), asbId: subId, date: n.date, start: n.start, end: n.end, note: `cobre ${absentName}`, absenceId: id }))
        : [];
    onSave({ id, asbId, from, to, reason, substitute }, extras);
  };

  return (
    <Modal title={absence ? 'Editar ausência' : 'Nova ausência de ASB'} onClose={onClose} wide keepOnBackdrop>
      <div className="field-row">
        <Field label="ASB">
          <select value={asbId} onChange={(e) => { setAsbId(e.target.value); if (e.target.value === subId) setSubId(''); }} autoFocus>
            {active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Motivo">
          <select value={reason} onChange={(e) => setReason(e.target.value as AbsenceReason)}>
            {ABSENCE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
      </div>
      <div className="field-row">
        <Field label="De"><input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value && e.target.value > to) setTo(e.target.value); }} /></Field>
        <Field label="Até"><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {reasonable && openDays.length === 0 && <div className="note warn">Nenhum dia de funcionamento nesse período (só fim de semana ou dias fechados). Não há o que cobrir.</div>}
      {coveringOthers.length > 0 && (
        <div className="note warn">
          {absentName} é substituta de {coveringOthers.map((a) => `${data.asbs.find((x) => x.id === a.asbId)?.name ?? '?'} (${period(a.from, a.to)})`).join(', ')}. Essa cobertura vai ficar sem ninguém: edite a outra ausência depois de salvar.
        </div>
      )}
      {ownExtras.length > 0 && (
        <div className="note warn">
          {absentName} tem {ownExtras.length} hora{ownExtras.length > 1 ? 's' : ''} extra{ownExtras.length > 1 ? 's' : ''} nesse período ({ownExtras.map((e) => `${formatDayMonth(e.date)} ${formatRange(e.start, e.end)}`).join(', ')}). Elas não valem enquanto ela estiver ausente; remova na aba Horas extras se for o caso.
        </div>
      )}

      <Field label="Quem cobre">
        <select value={cover} onChange={(e) => setCover(e.target.value as typeof cover)}>
          <option value="none">Ninguém escolhido (o app usa quem estiver livre no apoio; o que sobrar gera alerta)</option>
          <option value="team">Alguém da equipe</option>
          <option value="external">Pessoa de fora (nome)</option>
        </select>
      </Field>

      {cover !== 'external' && total > 0 && (
        <div>
          <div className="muted small">Sugestões de cobertura ({total} bloco{total > 1 ? 's' : ''} de sala, CME ou almoxarifado no período). Toque para escolher:</div>
          {useful.length === 0 ? (
            <div className="note warn">Ninguém da equipe está livre nesses horários. Cadastre uma pessoa de fora ou ajuste o Modo Dia.</div>
          ) : (
            <div className="suggest">
              {useful.slice(0, 5).map((s) => (
                <button
                  key={s.asbId}
                  type="button"
                  className={`btn sm${cover === 'team' && subId === s.asbId ? ' active' : ''}`}
                  onClick={() => { setCover('team'); setSubId(s.asbId); }}
                >
                  <span>
                    <strong>{s.name}</strong>
                    {`: cobre ${s.covered} de ${s.total}`}
                    {s.needsExtra > 0 ? `, com hora extra cobriria mais ${s.needsExtra}` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {cover === 'team' && (
        <Field label="Substituta">
          <select value={subId} onChange={(e) => setSubId(e.target.value)}>
            <option value="">Escolha...</option>
            {active.filter((a) => a.id !== asbId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
      )}
      {cover === 'team' && needed.length > 0 && (
        <label className="card" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: 10, marginBottom: 10 }}>
          <input type="checkbox" checked={createExtra} onChange={(e) => setCreateExtra(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            Criar hora extra para <strong>{sub?.name}</strong> e cobrir o que fica fora do contrato dela:{' '}
            {needed.map((n) => `${formatDayMonth(n.date)} ${formatRange(n.start, n.end)}`).join('; ')}.
            {absence && linked.length > 0 && <span className="muted small"> As horas extras que esta ausência já tinha são refeitas.</span>}
          </span>
        </label>
      )}
      {cover === 'team' && needed.length > 0 && longDays.length > 0 && (
        <div className="note warn">
          {createExtra ? 'Jornada longa' : `Hora extra não marcada: passaria de ${MAX_EXTRA_PER_DAY}h extras por dia`} para {sub?.name}:{' '}
          {longDays.map((x) => `${formatDayMonth(x.date)} das ${formatHour(x.start)} às ${formatHour(x.end)} (${x.extra}h extras)`).join('; ')}.
          {createExtra ? ' Confira se é permitido.' : ' Marque acima se for permitido.'}
        </div>
      )}
      {cover === 'external' && (
        <Field label="Nome"><input value={external} onChange={(e) => setExternal(e.target.value)} /></Field>
      )}
      {reasonable && openDays.length > 0 && (cover !== 'none' || remaining.length > 0) && (
        remaining.length === 0 ? (
          <div className="note ok">Com essa escolha, todos os horários de {absentName} ficam cobertos.</div>
        ) : (
          <div className="note bad">
            Continua sem ninguém: {remaining.slice(0, 8).map((r) => `${formatDayMonth(r.date)} ${groupHours(r.hours).map(([a, b]) => formatRange(a, b)).join(', ')}`).join('; ')}
            {remaining.length > 8 ? ` e mais ${remaining.length - 8} dias` : ''}. Para cobrir o resto, arraste outra ASB no Modo Dia desses dias.
          </div>
        )
      )}
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" onClick={submit}>Salvar</button>
      </div>
    </Modal>
  );
}

type ExtraPreset = 'antes' | 'depois' | 'outro';

function presetHours(p: ExtraPreset, a: { start: number; end: number }): [number, number] | null {
  if (p === 'antes') return a.start > 7 ? [a.start - 1, a.start] : null;
  if (p === 'depois') return a.end < 19 ? [a.end, a.end + 1] : null;
  return null;
}

function ExtraForm({ extra, onClose, onSave }: { extra?: ExtraShift; onClose: () => void; onSave: (list: ExtraShift[], replacingId?: string) => void }) {
  const data = useData();
  const options = data.asbs.filter((a) => a.active || a.id === extra?.asbId);
  const firstAsb = options[0];
  const initialPreset: ExtraPreset = extra ? 'outro' : firstAsb && presetHours('antes', firstAsb) ? 'antes' : 'depois';
  const initialHours = extra ? [extra.start, extra.end] : (firstAsb && presetHours(initialPreset, firstAsb)) || [17, 18];
  const [asbId, setAsbId] = useState(extra?.asbId ?? firstAsb?.id ?? '');
  const asb = data.asbs.find((a) => a.id === asbId);
  const [from, setFrom] = useState(extra?.date ?? todayIso());
  const [to, setTo] = useState(extra?.date ?? todayIso());
  const [preset, setPreset] = useState<ExtraPreset>(initialPreset);
  const [start, setStart] = useState(initialHours[0]);
  const [end, setEnd] = useState(initialHours[1]);
  const [note, setNote] = useState(extra?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const applyPreset = (p: ExtraPreset, a = asb) => {
    setPreset(p);
    if (!a) return;
    const h = presetHours(p, a);
    if (h) { setStart(h[0]); setEnd(h[1]); }
  };
  const changeAsb = (id: string) => {
    setAsbId(id);
    const a = data.asbs.find((x) => x.id === id);
    if (!a) return;
    // Se a opção atual não existe para essa ASB (já entra às 07h ou sai às 19h), troca para a outra.
    if (preset !== 'outro' && !presetHours(preset, a)) applyPreset(preset === 'antes' ? 'depois' : 'antes', a);
    else applyPreset(preset, a);
  };

  const reasonable = isReasonablePeriod(from, to);
  const dates = reasonable ? (extra ? [from] : openDaysIn(data, from, to)) : [];
  const parts = asb && end > start ? outsideContract(start, end, asb) : [];
  const insideHours = asb && end > start ? end - start - parts.reduce((s, [a, b]) => s + b - a, 0) : 0;
  const absentDates = asb ? dates.filter((d) => absenceFor(data, asb.id, d)) : [];
  const usableDates = dates.filter((d) => !absentDates.includes(d));

  const submit = () => {
    if (!asbId || !asb) return setError('Escolha a ASB.');
    if (!from || !to || to < from || !reasonable) return setError('Confira as datas.');
    if (end <= start) return setError('O fim precisa ser depois do início.');
    if (parts.length === 0) return setError(`Esse horário já está dentro do contrato de ${asb.name} (${formatRange(asb.start, asb.end)}).`);
    if (dates.length === 0) return setError('Nenhum dia de funcionamento nesse período.');
    if (usableDates.length === 0) return setError(`${asb.name} está ausente ${dates.length > 1 ? 'em todos esses dias' : 'nesse dia'}. Hora extra não vale para quem está de folga ou férias.`);
    const clashes = usableDates.flatMap((d) => parts.flatMap(([a, b]) => overlappingExtras(data, asb.id, d, a, b, extra?.id)));
    if (clashes.length > 0) {
      return setError(`${asb.name} já tem hora extra nesse horário: ${[...new Set(clashes.map((c) => `${formatDayMonth(c.date)} ${formatRange(c.start, c.end)}`))].join(', ')}. Edite a existente.`);
    }
    const list: ExtraShift[] = [];
    usableDates.forEach((date, i) => {
      parts.forEach(([a, b], j) => {
        list.push({
          id: extra && i === 0 && j === 0 ? extra.id : newId('hx'),
          asbId,
          date,
          start: a,
          end: b,
          note: note.trim() || undefined,
          absenceId: extra?.absenceId,
        });
      });
    });
    onSave(list, extra?.id);
  };

  const contractLabel = asb ? formatRange(asb.start, asb.end) : '';
  const extraLabel = parts.map(([a, b]) => formatRange(a, b)).join(' e ');

  return (
    <Modal title={extra ? 'Editar hora extra' : 'Nova hora extra'} onClose={onClose} keepOnBackdrop>
      <Field label="ASB">
        <select value={asbId} onChange={(e) => changeAsb(e.target.value)} autoFocus>
          {options.map((a) => <option key={a.id} value={a.id}>{a.name} ({formatRange(a.start, a.end)}){a.active ? '' : ' (inativa)'}</option>)}
        </select>
      </Field>
      <div className="checks" style={{ marginBottom: 10 }}>
        <label style={{ opacity: asb && presetHours('antes', asb) ? 1 : 0.45 }} title={asb && !presetHours('antes', asb) ? `${asb.name} já entra às 07h, quando o CEO abre` : undefined}>
          <input type="radio" checked={preset === 'antes'} disabled={!asb || !presetHours('antes', asb)} onChange={() => applyPreset('antes')} /> Entra mais cedo
        </label>
        <label style={{ opacity: asb && presetHours('depois', asb) ? 1 : 0.45 }} title={asb && !presetHours('depois', asb) ? `${asb.name} já sai às 19h, quando o CEO fecha` : undefined}>
          <input type="radio" checked={preset === 'depois'} disabled={!asb || !presetHours('depois', asb)} onChange={() => applyPreset('depois')} /> Sai mais tarde
        </label>
        <label><input type="radio" checked={preset === 'outro'} onChange={() => setPreset('outro')} /> Outro horário</label>
      </div>
      <div className="field-row">
        <Field label="Das"><HourSelect value={start} onChange={(v) => { setStart(v); setPreset('outro'); }} max={18} /></Field>
        <Field label="Até"><HourSelect value={end} onChange={(v) => { setEnd(v); setPreset('outro'); }} min={8} /></Field>
      </div>
      <div className="field-row">
        <Field label={extra ? 'Data' : 'De'}><input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (extra || (e.target.value && e.target.value > to)) setTo(e.target.value); }} /></Field>
        {!extra && <Field label="Até (repete nos dias de funcionamento)"><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>}
      </div>
      <Field label="Observação (opcional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: cobre a folga da Laura" /></Field>
      {asb && parts.length > 0 && (
        <p className="muted small">
          Contrato de {asb.name}: {contractLabel}. Hora extra: {extraLabel}
          {insideHours > 0 ? ` (o resto já é contrato e não conta como extra)` : ''}.
        </p>
      )}
      {!extra && usableDates.length > 1 && <p className="muted small">Vai criar em {usableDates.length} dias: {usableDates.map((d) => `${WEEKDAY_SHORT[weekdayOf(d)]} ${formatDayMonth(d)}`).join(', ')}.</p>}
      {absentDates.length > 0 && usableDates.length > 0 && <div className="note warn">Pula {absentDates.map(formatDayMonth).join(', ')}: {asb?.name} está ausente.</div>}
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" onClick={submit}>Salvar</button>
      </div>
    </Modal>
  );
}

function DentistAbsenceForm({ absence, onClose, onSave }: { absence?: DentistAbsence; onClose: () => void; onSave: (a: DentistAbsence) => void }) {
  const data = useData();
  // Ao editar a folga de um dentista que já saiu da equipe, ele continua na lista (com o nome de antes).
  const removed = absence && !data.dentists.some((d) => d.id === absence.dentistId) ? findDentistAnywhere(data, absence.dentistId) : undefined;
  const dentists = [...data.dentists, ...(removed ? [removed] : [])].sort((a, b) => a.name.localeCompare(b.name));
  const [dentistId, setDentistId] = useState(absence?.dentistId ?? dentists[0]?.id ?? '');
  const [from, setFrom] = useState(absence?.from ?? todayIso());
  const [to, setTo] = useState(absence?.to ?? todayIso());
  const [reason, setReason] = useState<AbsenceReason>(absence?.reason ?? 'Folga');
  const [error, setError] = useState<string | null>(null);
  const dentist = dentists.find((d) => d.id === dentistId);
  const roomName = dentist ? data.rooms.find((r) => r.id === dentist.roomId)?.name : '';

  // Prévia: o que acontece nos primeiros dias da folga (quem é remanejada, quem fica disponível).
  const preview = useMemo(() => {
    if (!dentist || !isReasonablePeriod(from, to)) return null;
    const draft: AppData = {
      ...data,
      dentistAbsences: [...(data.dentistAbsences ?? []).filter((x) => x.id !== absence?.id), { id: 'previa', dentistId, from, to, reason }],
    };
    const days = openDaysIn(draft, from, to).filter((d) => dentistWorksOn(dentist, weekdayOf(d)));
    const name = (id: string) => findAsbAnywhere(draft, id)?.name ?? '?';
    const lines = days.slice(0, 5).map((d) => {
      const day = effectiveDay(draft, d);
      const moved = analyze(draft, day).filter((a) => a.code === 'remanejada').map((a) => a.message);
      const free = new Map<string, number[]>();
      for (const sl of day.slots) {
        if (sl.kind !== 'sala' || sl.roomId !== dentist.roomId || sl.who.type !== 'asb' || sl.origin === 'auto') continue;
        if (dentistsAt(day.dentists, dentist.roomId, sl.hour).length > 0) continue;
        if (!dentistsAt(day.dentistsOff, dentist.roomId, sl.hour).some((x) => x.id === dentist.id)) continue;
        free.set(sl.who.asbId, [...(free.get(sl.who.asbId) ?? []), sl.hour]);
      }
      const freeText = [...free.entries()].map(
        ([id, hs]) => `${name(id)} fica disponível na ${roomName} ${groupHours(hs).map(([a, b]) => formatRange(a, b)).join(' e ')} (nenhuma sala precisou dela).`,
      );
      return { date: d, items: [...moved, ...freeText] };
    });
    return { lines, total: days.length };
  }, [data, dentist, dentistId, from, to, reason, absence?.id, roomName]);

  const submit = () => {
    if (!dentistId) return setError('Escolha o dentista.');
    if (!from || !to || to < from || !isReasonablePeriod(from, to)) return setError('Confira as datas.');
    const clash = overlappingDentistAbsences(data, dentistId, from, to, absence?.id);
    if (clash.length > 0) return setError(`Já existe uma folga desse dentista nesse período (${formatDate(clash[0].from)} a ${formatDate(clash[0].to)}).`);
    onSave({ id: absence?.id ?? newId('df'), dentistId, from, to, reason });
  };

  return (
    <Modal title={absence ? 'Editar folga de dentista' : 'Nova folga de dentista'} onClose={onClose} keepOnBackdrop>
      <Field label="Dentista">
        <select value={dentistId} onChange={(e) => setDentistId(e.target.value)} autoFocus>
          {dentists.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.specialty}, {data.rooms.find((r) => r.id === d.roomId)?.name}, {formatRange(d.start, d.end)})</option>)}
        </select>
      </Field>
      <div className="field-row">
        <Field label="De"><input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value && e.target.value > to) setTo(e.target.value); }} /></Field>
        <Field label="Até"><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <Field label="Motivo">
        <select value={reason} onChange={(e) => setReason(e.target.value as AbsenceReason)}>
          {ABSENCE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </Field>
      {dentist && (
        <p className="muted small">
          Nesses dias a {roomName} fica sem atendimento das {formatRange(dentist.start, dentist.end)}. A ASB que estaria com {dentist.name} fica livre e é
          remanejada sozinha para outra sala, CME ou almoxarifado que esteja sem ninguém.
        </p>
      )}
      {preview && (
        preview.total === 0 ? (
          <p className="note warn">{dentist?.name} não atende em nenhum dia de funcionamento desse período.</p>
        ) : (
          <div className="note">
            <strong>O que acontece:</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {preview.lines.map((l) => (
                <li key={l.date}>
                  {WEEKDAY_SHORT[weekdayOf(l.date)]}, {formatDate(l.date)}: {l.items.length > 0 ? l.items.join(' ') : 'nenhuma mudança nas ASBs.'}
                </li>
              ))}
            </ul>
            {preview.total > preview.lines.length && (
              <span className="small muted">E mais {preview.total - preview.lines.length} dia(s). Veja cada um no Modo Dia do Quadro.</span>
            )}
          </div>
        )
      )}
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" onClick={submit}>Salvar</button>
      </div>
    </Modal>
  );
}
