import { useMemo, useState } from 'react';
import type { Absence, AbsenceReason } from '../../domain';
import {
  ABSENCE_REASONS, WEEKDAY_SHORT, absencesBetween, addDays, firstOfMonth, formatDate, isBetween, isExternalSubstitute,
  isTeamSubstitute, lastOfMonth, mondayOf, todayIso, weekdayOf,
} from '../../domain';
import { newId, useData, useStore } from '../../store/useStore';
import { colorMap } from '../colors';
import { Modal, useConfirm } from '../common/Modal';
import { Field } from '../common/fields';
import { MonthPicker, currentYearMonth, type YearMonth } from '../common/MonthPicker';

export function AbsencesScreen() {
  const data = useData();
  const apply = useStore((s) => s.apply);
  const confirm = useConfirm();
  const [ym, setYm] = useState<YearMonth>(currentYearMonth());
  const [editing, setEditing] = useState<Absence | 'new' | null>(null);
  const colors = useMemo(() => colorMap(data.asbs), [data.asbs]);
  const name = (id: string) => data.asbs.find((a) => a.id === id)?.name ?? '?';
  const sorted = [...data.absences].sort((a, b) => b.from.localeCompare(a.from));

  const remove = async (a: Absence) => {
    const ok = await confirm({ title: 'Remover ausência?', message: <>{name(a.asbId)}, {formatDate(a.from)} a {formatDate(a.to)}.</>, confirmLabel: 'Remover', danger: true });
    if (ok) apply((d) => { d.absences = d.absences.filter((x) => x.id !== a.id); });
  };

  return (
    <div>
      <div className="toolbar">
        <h1>Ausências</h1>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setEditing('new')}>Nova ausência</button>
      </div>
      <div className="board-layout">
        <div style={{ flex: 1 }}>
          <div className="toolbar">
            <MonthPicker value={ym} onChange={setYm} />
          </div>
          <MonthCalendar ym={ym} absences={data.absences} colors={colors} nameOf={name} openDays={data.openDays} />
        </div>
        <div style={{ flex: 1 }}>
          {sorted.length === 0 ? (
            <p className="card muted">Nenhuma ausência cadastrada. Férias, atestados e faltas entram aqui e aparecem no Modo Dia do quadro e no PDF do mês.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>ASB</th><th>Período</th><th>Motivo</th><th>Quem cobre</th><th></th></tr>
                </thead>
                <tbody>
                  {sorted.map((a) => (
                    <tr key={a.id}>
                      <td><span className="chip static" style={{ background: colors.get(a.asbId) }}>{name(a.asbId)}</span></td>
                      <td className="mono">{a.from === a.to ? formatDate(a.from) : `${formatDate(a.from)} a ${formatDate(a.to)}`}</td>
                      <td>{a.reason}</td>
                      <td>{isTeamSubstitute(a) ? name(a.substitute.asbId) : isExternalSubstitute(a) ? `${a.substitute.externalName} (externa)` : <span className="muted">sem substituta</span>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn sm" onClick={() => setEditing(a)}>Editar</button>{' '}
                        <button className="btn sm danger" onClick={() => remove(a)}>Remover</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {editing && (
        <AbsenceForm
          absence={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={(a) => {
            apply((d) => {
              const i = d.absences.findIndex((x) => x.id === a.id);
              if (i >= 0) d.absences[i] = a;
              else d.absences.push(a);
            });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

export function MonthCalendar({ ym, absences, colors, nameOf, openDays }: { ym: YearMonth; absences: Absence[]; colors: Map<string, string>; nameOf: (id: string) => string; openDays: number[] }) {
  const first = firstOfMonth(ym.year, ym.month);
  const last = lastOfMonth(ym.year, ym.month);
  const start = mondayOf(first);
  const end = addDays(mondayOf(last), 6);
  const cells: string[] = [];
  for (let iso = start; iso <= end; iso = addDays(iso, 1)) cells.push(iso);
  const monthAbs = absencesBetween({ absences }, first, last);
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="calendar">
      {order.map((d) => <div key={d} className="dow">{WEEKDAY_SHORT[d]}</div>)}
      {cells.map((iso) => {
        const inMonth = iso >= first && iso <= last;
        const wd = weekdayOf(iso);
        const closed = !openDays.includes(wd);
        const list = monthAbs.filter((a) => isBetween(iso, a.from, a.to));
        return (
          <div key={iso} className={`day${closed ? ' closed' : ''}${inMonth ? '' : ' other'}`}>
            <span className="n">{Number(iso.slice(8))}</span>
            {inMonth && list.map((a) => (
              <span key={a.id} className="abs" style={{ background: colors.get(a.asbId) ?? '#555' }} title={`${nameOf(a.asbId)}: ${a.reason}`}>
                {nameOf(a.asbId)}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function AbsenceForm({ absence, onClose, onSave }: { absence?: Absence; onClose: () => void; onSave: (a: Absence) => void }) {
  const data = useData();
  const active = data.asbs.filter((a) => a.active);
  const [asbId, setAsbId] = useState(absence?.asbId ?? active[0]?.id ?? '');
  const [from, setFrom] = useState(absence?.from ?? todayIso());
  const [to, setTo] = useState(absence?.to ?? todayIso());
  const [reason, setReason] = useState<AbsenceReason>(absence?.reason ?? 'Férias');
  const initialCover = absence ? (isTeamSubstitute(absence) ? 'team' : isExternalSubstitute(absence) ? 'external' : 'none') : 'none';
  const [cover, setCover] = useState<'none' | 'team' | 'external'>(initialCover);
  const [subId, setSubId] = useState(absence && isTeamSubstitute(absence) ? absence.substitute.asbId : '');
  const [external, setExternal] = useState(absence && isExternalSubstitute(absence) ? absence.substitute.externalName : '');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!asbId) return setError('Escolha a ASB.');
    if (!from || !to) return setError('Informe o período.');
    if (to < from) return setError('A data final precisa ser igual ou depois da inicial.');
    if (cover === 'team' && !subId) return setError('Escolha quem cobre.');
    if (cover === 'team' && subId === asbId) return setError('A substituta não pode ser a própria ausente.');
    if (cover === 'external' && !external.trim()) return setError('Informe o nome de quem cobre.');
    const substitute = cover === 'team' ? { asbId: subId } : cover === 'external' ? { externalName: external.trim() } : undefined;
    onSave({ id: absence?.id ?? newId('abs'), asbId, from, to, reason, substitute });
  };

  return (
    <Modal title={absence ? 'Editar ausência' : 'Nova ausência'} onClose={onClose}>
      <Field label="ASB">
        <select value={asbId} onChange={(e) => setAsbId(e.target.value)} autoFocus>
          {active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
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
      <Field label="Quem cobre">
        <select value={cover} onChange={(e) => setCover(e.target.value as typeof cover)}>
          <option value="none">Ninguém (a sala fica descoberta e gera alerta)</option>
          <option value="team">Alguém da equipe</option>
          <option value="external">Pessoa de fora (nome)</option>
        </select>
      </Field>
      {cover === 'team' && (
        <Field label="Substituta">
          <select value={subId} onChange={(e) => setSubId(e.target.value)}>
            <option value="">Escolha...</option>
            {active.filter((a) => a.id !== asbId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
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
