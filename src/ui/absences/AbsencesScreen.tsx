import { useMemo, useState } from 'react';
import type { Absence, AbsenceReason, AppData, DentistAbsence, ExtraShift } from '../../domain';
import {
  ABSENCE_REASONS, WEEKDAY_SHORT, absencesBetween, addDays, coverageSuggestions, dentistAbsencesBetween, extraNeededToCover,
  extraShiftsBetween, firstOfMonth, formatDate, formatDayMonth, formatRange, isBetween, isExternalSubstitute, isTeamSubstitute, lastOfMonth,
  mondayOf, overlappingAbsences, overlappingDentistAbsences, todayIso, weekdayOf,
} from '../../domain';
import { newId, useData, useStore } from '../../store/useStore';
import { colorMap } from '../colors';
import { Modal, useConfirm } from '../common/Modal';
import { Field, HourSelect } from '../common/fields';
import { MonthPicker, currentYearMonth, type YearMonth } from '../common/MonthPicker';

type Tab = 'asb' | 'extra' | 'dentista';

function period(from: string, to: string): string {
  return from === to ? formatDate(from) : `${formatDate(from)} a ${formatDate(to)}`;
}

export function AbsencesScreen() {
  const data = useData();
  const apply = useStore((s) => s.apply);
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>('asb');
  const [ym, setYm] = useState<YearMonth>(currentYearMonth());
  const [editAbs, setEditAbs] = useState<Absence | 'new' | null>(null);
  const [editExtra, setEditExtra] = useState<ExtraShift | 'new' | null>(null);
  const [editDent, setEditDent] = useState<DentistAbsence | 'new' | null>(null);
  const colors = useMemo(() => colorMap(data.asbs), [data.asbs]);
  const asbName = (id: string) => data.asbs.find((a) => a.id === id)?.name ?? '?';
  const dentName = (id: string) => data.dentists.find((d) => d.id === id)?.name ?? '?';

  const removeAbs = async (a: Absence) => {
    const ok = await confirm({ title: 'Remover ausência?', message: <>{asbName(a.asbId)}, {period(a.from, a.to)}.</>, confirmLabel: 'Remover', danger: true });
    if (ok) apply((d) => { d.absences = d.absences.filter((x) => x.id !== a.id); });
  };
  const removeExtra = async (e: ExtraShift) => {
    const ok = await confirm({ title: 'Remover hora extra?', message: <>{asbName(e.asbId)}, {formatDate(e.date)}, {formatRange(e.start, e.end)}.</>, confirmLabel: 'Remover', danger: true });
    if (ok) apply((d) => { d.extraShifts = (d.extraShifts ?? []).filter((x) => x.id !== e.id); });
  };
  const removeDent = async (a: DentistAbsence) => {
    const ok = await confirm({ title: 'Remover folga do dentista?', message: <>{dentName(a.dentistId)}, {period(a.from, a.to)}.</>, confirmLabel: 'Remover', danger: true });
    if (ok) apply((d) => { d.dentistAbsences = (d.dentistAbsences ?? []).filter((x) => x.id !== a.id); });
  };

  const absences = [...data.absences].sort((a, b) => b.from.localeCompare(a.from));
  const extras = [...(data.extraShifts ?? [])].sort((a, b) => b.date.localeCompare(a.date) || a.start - b.start);
  const dentAbs = [...(data.dentistAbsences ?? [])].sort((a, b) => b.from.localeCompare(a.from));

  const newLabel = tab === 'asb' ? 'Nova ausência de ASB' : tab === 'extra' ? 'Nova hora extra' : 'Nova folga de dentista';
  const onNew = () => (tab === 'asb' ? setEditAbs('new') : tab === 'extra' ? setEditExtra('new') : setEditDent('new'));

  return (
    <div>
      <div className="toolbar">
        <h1>Ausências e extras</h1>
        <span className="spacer" />
        <button className="btn primary" onClick={onNew}>{newLabel}</button>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" className={tab === 'asb' ? 'active' : ''} onClick={() => setTab('asb')}>Folgas e faltas de ASB ({data.absences.length})</button>
        <button role="tab" className={tab === 'extra' ? 'active' : ''} onClick={() => setTab('extra')}>Horas extras ({extras.length})</button>
        <button role="tab" className={tab === 'dentista' ? 'active' : ''} onClick={() => setTab('dentista')}>Folgas de dentista ({dentAbs.length})</button>
      </div>
      <div className="board-layout">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="toolbar">
            <MonthPicker value={ym} onChange={setYm} />
          </div>
          <MonthCalendar ym={ym} data={data} colors={colors} />
          <p className="muted small" style={{ marginTop: 6 }}>
            No calendário: ASB ausente na cor dela, <strong>+ nome</strong> em verde para hora extra, dentista de folga em cinza escuro.
          </p>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {tab === 'asb' && (
            absences.length === 0 ? (
              <p className="card muted">Nenhuma ausência cadastrada. Férias, atestados, folgas e faltas entram aqui. Ao cadastrar, o app sugere quem pode cobrir.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>ASB</th><th>Período</th><th>Motivo</th><th>Quem cobre</th><th></th></tr></thead>
                  <tbody>
                    {absences.map((a) => (
                      <tr key={a.id}>
                        <td><span className="chip static" style={{ background: colors.get(a.asbId) }}>{asbName(a.asbId)}</span></td>
                        <td className="mono">{period(a.from, a.to)}</td>
                        <td>{a.reason}</td>
                        <td>{isTeamSubstitute(a) ? asbName(a.substitute.asbId) : isExternalSubstitute(a) ? `${a.substitute.externalName} (externa)` : <span className="muted">sem substituta</span>}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
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
              <p className="card muted">Nenhuma hora extra. Cadastre aqui os dias em que uma ASB entra mais cedo ou sai mais tarde. No Modo Dia do quadro ela pode ser colocada nesses horários, e o app a usa sozinho para cobrir sala sem ASB.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>ASB</th><th>Data</th><th>Horário extra</th><th>Obs.</th><th></th></tr></thead>
                  <tbody>
                    {extras.map((e) => (
                      <tr key={e.id}>
                        <td><span className="chip static" style={{ background: colors.get(e.asbId) }}>{asbName(e.asbId)}</span></td>
                        <td className="mono">{WEEKDAY_SHORT[weekdayOf(e.date)]}, {formatDate(e.date)}</td>
                        <td className="mono">{formatRange(e.start, e.end)}</td>
                        <td>{e.note ?? ''}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="btn sm" onClick={() => setEditExtra(e)}>Editar</button>{' '}
                          <button className="btn sm danger" onClick={() => removeExtra(e)}>Remover</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
          {tab === 'dentista' && (
            dentAbs.length === 0 ? (
              <p className="card muted">Nenhuma folga de dentista. Quando um dentista folga, a sala dele fica sem atendimento e o app remaneja a ASB dele para outra sala que esteja sem ASB.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Dentista</th><th>Período</th><th>Motivo</th><th></th></tr></thead>
                  <tbody>
                    {dentAbs.map((a) => (
                      <tr key={a.id}>
                        <td>{dentName(a.dentistId)}</td>
                        <td className="mono">{period(a.from, a.to)}</td>
                        <td>{a.reason}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
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
              if (newExtras.length > 0) d.extraShifts = [...(d.extraShifts ?? []), ...newExtras];
            });
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
            setEditDent(null);
          }}
        />
      )}
    </div>
  );
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
  const monthExtra = extraShiftsBetween(data, first, last);
  const asbName = (id: string) => data.asbs.find((a) => a.id === id)?.name ?? '?';
  const dentName = (id: string) => data.dentists.find((d) => d.id === id)?.name ?? '?';
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="calendar">
      {order.map((d) => <div key={d} className="dow">{WEEKDAY_SHORT[d]}</div>)}
      {cells.map((iso) => {
        const inMonth = iso >= first && iso <= last;
        const closed = !data.openDays.includes(weekdayOf(iso));
        return (
          <div key={iso} className={`day${closed ? ' closed' : ''}${inMonth ? '' : ' other'}`}>
            <span className="n">{Number(iso.slice(8))}</span>
            {inMonth && monthAbs.filter((a) => isBetween(iso, a.from, a.to)).map((a) => (
              <span key={a.id} className="abs" style={{ background: colors.get(a.asbId) ?? '#555' }} title={`${asbName(a.asbId)}: ${a.reason}`}>{asbName(a.asbId)}</span>
            ))}
            {inMonth && monthExtra.filter((e) => e.date === iso).map((e) => (
              <span key={e.id} className="abs extra" title={`${asbName(e.asbId)}: hora extra ${formatRange(e.start, e.end)}`}>+ {asbName(e.asbId)}</span>
            ))}
            {inMonth && monthDent.filter((a) => isBetween(iso, a.from, a.to)).map((a) => (
              <span key={a.id} className="abs dentist" title={`${dentName(a.dentistId)}: ${a.reason}`}>{dentName(a.dentistId)}</span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function AbsenceForm({ absence, onClose, onSave }: { absence?: Absence; onClose: () => void; onSave: (a: Absence, extras: ExtraShift[]) => void }) {
  const data = useData();
  const active = data.asbs.filter((a) => a.active);
  const [asbId, setAsbId] = useState(absence?.asbId ?? active[0]?.id ?? '');
  const [from, setFrom] = useState(absence?.from ?? todayIso());
  const [to, setTo] = useState(absence?.to ?? todayIso());
  const [reason, setReason] = useState<AbsenceReason>(absence?.reason ?? 'Folga');
  const initialCover = absence ? (isTeamSubstitute(absence) ? 'team' : isExternalSubstitute(absence) ? 'external' : 'none') : 'none';
  const [cover, setCover] = useState<'none' | 'team' | 'external'>(initialCover);
  const [subId, setSubId] = useState(absence && isTeamSubstitute(absence) ? absence.substitute.asbId : '');
  const [external, setExternal] = useState(absence && isExternalSubstitute(absence) ? absence.substitute.externalName : '');
  const [createExtra, setCreateExtra] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const validRange = !!from && !!to && to >= from;
  const suggestions = useMemo(
    () => (validRange && asbId ? coverageSuggestions(data, asbId, from, to, absence?.id) : []),
    [data, asbId, from, to, validRange, absence?.id],
  );
  const needed = useMemo(
    () => (validRange && cover === 'team' && subId ? extraNeededToCover(data, asbId, subId, from, to, absence?.id) : []),
    [data, asbId, subId, from, to, cover, validRange, absence?.id],
  );
  const total = suggestions[0]?.total ?? 0;
  const subName = data.asbs.find((a) => a.id === subId)?.name ?? '';

  const submit = () => {
    if (!asbId) return setError('Escolha a ASB.');
    if (!from || !to) return setError('Informe o período.');
    if (to < from) return setError('A data final precisa ser igual ou depois da inicial.');
    const clash = overlappingAbsences(data, asbId, from, to, absence?.id);
    if (clash.length > 0) {
      const c = clash[0];
      return setError(`Já existe uma ausência dessa ASB nesse período (${c.reason}, ${formatDate(c.from)} a ${formatDate(c.to)}). Edite ou remova a existente.`);
    }
    if (cover === 'team' && !subId) return setError('Escolha quem cobre.');
    if (cover === 'team' && subId === asbId) return setError('A substituta não pode ser a própria ausente.');
    if (cover === 'external' && !external.trim()) return setError('Informe o nome de quem cobre.');
    const substitute = cover === 'team' ? { asbId: subId } : cover === 'external' ? { externalName: external.trim() } : undefined;
    const extras: ExtraShift[] =
      cover === 'team' && createExtra
        ? needed.map((n) => ({ id: newId('hx'), asbId: subId, date: n.date, start: n.start, end: n.end, note: `cobre ${data.asbs.find((a) => a.id === asbId)?.name ?? ''}` }))
        : [];
    onSave({ id: absence?.id ?? newId('abs'), asbId, from, to, reason, substitute }, extras);
  };

  return (
    <Modal title={absence ? 'Editar ausência' : 'Nova ausência de ASB'} onClose={onClose} wide>
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
        <Field label="De"><input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} /></Field>
        <Field label="Até"><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>

      <Field label="Quem cobre">
        <select value={cover} onChange={(e) => setCover(e.target.value as typeof cover)}>
          <option value="none">Ninguém por enquanto (a sala fica descoberta e gera alerta)</option>
          <option value="team">Alguém da equipe</option>
          <option value="external">Pessoa de fora (nome)</option>
        </select>
      </Field>

      {cover !== 'external' && total > 0 && (
        <div>
          <div className="muted small">Sugestões de cobertura ({total} bloco{total > 1 ? 's' : ''} de sala, CME ou almoxarifado no período). Toque para escolher:</div>
          <div className="suggest">
            {suggestions.slice(0, 5).map((s) => (
              <button
                key={s.asbId}
                type="button"
                className={`btn sm${cover === 'team' && subId === s.asbId ? ' active' : ''}`}
                onClick={() => { setCover('team'); setSubId(s.asbId); }}
              >
                <strong>{s.name}</strong>: cobre {s.covered} de {s.total}
                {s.needsExtra > 0 ? `, com hora extra cobriria mais ${s.needsExtra}` : ''}
              </button>
            ))}
          </div>
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
            Criar hora extra para <strong>{subName}</strong> e cobrir o que fica fora do contrato dela:{' '}
            {needed.map((n) => `${formatDayMonth(n.date)} ${formatRange(n.start, n.end)}`).join('; ')}.
          </span>
        </label>
      )}
      {cover === 'external' && (
        <Field label="Nome"><input value={external} onChange={(e) => setExternal(e.target.value)} /></Field>
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

function ExtraForm({ extra, onClose, onSave }: { extra?: ExtraShift; onClose: () => void; onSave: (list: ExtraShift[], replacingId?: string) => void }) {
  const data = useData();
  const active = data.asbs.filter((a) => a.active);
  const [asbId, setAsbId] = useState(extra?.asbId ?? active[0]?.id ?? '');
  const asb = data.asbs.find((a) => a.id === asbId);
  const [from, setFrom] = useState(extra?.date ?? todayIso());
  const [to, setTo] = useState(extra?.date ?? todayIso());
  const [preset, setPreset] = useState<ExtraPreset>(extra ? 'outro' : 'antes');
  const [start, setStart] = useState(extra?.start ?? Math.max(7, (asb?.start ?? 8) - 1));
  const [end, setEnd] = useState(extra?.end ?? (asb?.start ?? 8));
  const [note, setNote] = useState(extra?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const applyPreset = (p: ExtraPreset, a = asb) => {
    setPreset(p);
    if (!a) return;
    if (p === 'antes') { setStart(Math.max(7, a.start - 1)); setEnd(a.start); }
    if (p === 'depois') { setStart(a.end); setEnd(Math.min(19, a.end + 1)); }
  };

  const days: string[] = [];
  if (from && to && to >= from) {
    for (let d = from; d <= to; d = addDays(d, 1)) if (data.openDays.includes(weekdayOf(d))) days.push(d);
  }

  const submit = () => {
    if (!asbId || !asb) return setError('Escolha a ASB.');
    if (!from || !to || to < from) return setError('Confira as datas.');
    if (end <= start) return setError('O fim precisa ser depois do início.');
    if (start >= asb.start && end <= asb.end) return setError(`Esse horário já está dentro do contrato de ${asb.name} (${formatRange(asb.start, asb.end)}).`);
    if (days.length === 0) return setError('Nenhum dia de funcionamento nesse período.');
    const list = days.map((date, i) => ({ id: extra && i === 0 ? extra.id : newId('hx'), asbId, date, start, end, note: note.trim() || undefined }));
    onSave(list, extra?.id);
  };

  return (
    <Modal title={extra ? 'Editar hora extra' : 'Nova hora extra'} onClose={onClose}>
      <Field label="ASB">
        <select value={asbId} onChange={(e) => { setAsbId(e.target.value); applyPreset(preset, data.asbs.find((a) => a.id === e.target.value)); }} autoFocus>
          {active.map((a) => <option key={a.id} value={a.id}>{a.name} ({formatRange(a.start, a.end)})</option>)}
        </select>
      </Field>
      <div className="checks" style={{ marginBottom: 10 }}>
        <label><input type="radio" checked={preset === 'antes'} onChange={() => applyPreset('antes')} /> Entra mais cedo</label>
        <label><input type="radio" checked={preset === 'depois'} onChange={() => applyPreset('depois')} /> Sai mais tarde</label>
        <label><input type="radio" checked={preset === 'outro'} onChange={() => setPreset('outro')} /> Outro horário</label>
      </div>
      <div className="field-row">
        <Field label="Das"><HourSelect value={start} onChange={(v) => { setStart(v); setPreset('outro'); }} max={18} /></Field>
        <Field label="Até"><HourSelect value={end} onChange={(v) => { setEnd(v); setPreset('outro'); }} min={8} /></Field>
      </div>
      <div className="field-row">
        <Field label={extra ? 'Data' : 'De'}><input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to || extra) setTo(e.target.value); }} /></Field>
        {!extra && <Field label="Até (repete nos dias úteis)"><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>}
      </div>
      <Field label="Observação (opcional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: cobre a folga da Laura" /></Field>
      {!extra && days.length > 1 && <p className="muted small">Vai criar {days.length} horas extras: {days.map((d) => `${WEEKDAY_SHORT[weekdayOf(d)]} ${formatDayMonth(d)}`).join(', ')}.</p>}
      {asb && <p className="muted small">Contrato de {asb.name}: {formatRange(asb.start, asb.end)}. Com a hora extra: {formatRange(Math.min(asb.start, start), Math.max(asb.end, end))}</p>}
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
  const dentists = [...data.dentists].sort((a, b) => a.name.localeCompare(b.name));
  const [dentistId, setDentistId] = useState(absence?.dentistId ?? dentists[0]?.id ?? '');
  const [from, setFrom] = useState(absence?.from ?? todayIso());
  const [to, setTo] = useState(absence?.to ?? todayIso());
  const [reason, setReason] = useState<AbsenceReason>(absence?.reason ?? 'Folga');
  const [error, setError] = useState<string | null>(null);
  const dentist = data.dentists.find((d) => d.id === dentistId);
  const roomName = dentist ? data.rooms.find((r) => r.id === dentist.roomId)?.name : '';

  const submit = () => {
    if (!dentistId) return setError('Escolha o dentista.');
    if (!from || !to || to < from) return setError('Confira as datas.');
    const clash = overlappingDentistAbsences(data, dentistId, from, to, absence?.id);
    if (clash.length > 0) return setError(`Já existe uma folga desse dentista nesse período (${formatDate(clash[0].from)} a ${formatDate(clash[0].to)}).`);
    onSave({ id: absence?.id ?? newId('df'), dentistId, from, to, reason });
  };

  return (
    <Modal title={absence ? 'Editar folga de dentista' : 'Nova folga de dentista'} onClose={onClose}>
      <Field label="Dentista">
        <select value={dentistId} onChange={(e) => setDentistId(e.target.value)} autoFocus>
          {dentists.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.specialty}, {data.rooms.find((r) => r.id === d.roomId)?.name}, {formatRange(d.start, d.end)})</option>)}
        </select>
      </Field>
      <div className="field-row">
        <Field label="De"><input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} /></Field>
        <Field label="Até"><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <Field label="Motivo">
        <select value={reason} onChange={(e) => setReason(e.target.value as AbsenceReason)}>
          {ABSENCE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </Field>
      {dentist && (
        <p className="muted small">
          Nesses dias a {roomName} fica sem atendimento das {formatRange(dentist.start, dentist.end)}. A ASB que estaria com {dentist.name} fica livre e é remanejada
          sozinha para outra sala que esteja sem ASB. Confira no Modo Dia do quadro.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" onClick={submit}>Salvar</button>
      </div>
    </Modal>
  );
}
