import { useMemo, useState } from 'react';
import type { Asb, Dentist, Room } from '../../domain';
import { WEEKDAY_SHORT, formatRange } from '../../domain';
import { newId, removeAsb, removeDentist, removeRoom, useData, useStore } from '../../store/useStore';
import { ASB_PALETTE, colorMap } from '../colors';
import { Modal, useConfirm } from '../common/Modal';
import { DaysPicker, Field, HourSelect } from '../common/fields';

export function TeamScreen() {
  const data = useData();
  const apply = useStore((s) => s.apply);
  const confirm = useConfirm();
  const colors = useMemo(() => colorMap(data.asbs), [data.asbs]);
  const [asbEdit, setAsbEdit] = useState<Asb | 'new' | null>(null);
  const [dentistEdit, setDentistEdit] = useState<Dentist | 'new' | null>(null);
  const [roomEdit, setRoomEdit] = useState<Room | 'new' | null>(null);
  const roomName = (id: string) => data.rooms.find((r) => r.id === id)?.name ?? '?';

  const delAsb = async (a: Asb) => {
    const slots = data.base.slots.filter((s) => s.asbId === a.id).length;
    const ok = await confirm({
      title: `Remover ${a.name}?`,
      message: <>As {slots} fichas dela saem do quadro e ela sai dos rodízios e das listas fixas. As ausências dela também são removidas.</>,
      confirmLabel: 'Remover',
      danger: true,
    });
    if (ok) apply((d) => removeAsb(d, a.id));
  };
  const delDentist = async (x: Dentist) => {
    const ok = await confirm({ title: `Remover ${x.name}?`, message: 'As tarefas que seguem esse dentista também são removidas.', confirmLabel: 'Remover', danger: true });
    if (ok) apply((d) => removeDentist(d, x.id));
  };
  const delRoom = async (r: Room) => {
    const ok = await confirm({ title: `Remover ${r.name}?`, message: 'Os dentistas dessa sala, as fichas nela e as tarefas que seguem a sala são removidos.', confirmLabel: 'Remover', danger: true });
    if (ok) apply((d) => removeRoom(d, r.id));
  };

  return (
    <div className="stack">
      <section>
        <div className="toolbar">
          <h1>Equipe e salas</h1>
        </div>
        <div className="toolbar">
          <h2>ASBs</h2>
          <span className="spacer" />
          <button className="btn primary" onClick={() => setAsbEdit('new')}>Nova ASB</button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Nome</th><th>Contrato</th><th>Almoço</th><th>Situação</th><th></th></tr></thead>
            <tbody>
              {[...data.asbs].sort((a, b) => a.start - b.start || a.name.localeCompare(b.name)).map((a) => (
                <tr key={a.id}>
                  <td><span className="chip static" style={{ background: colors.get(a.id) }}>{a.name}</span></td>
                  <td className="mono">{formatRange(a.start, a.end)}</td>
                  <td>{a.lunch ? '1 hora' : 'não sai'}</td>
                  <td>{a.active ? <span className="badge ok">ativa</span> : <span className="badge neutral">inativa</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn sm" onClick={() => setAsbEdit(a)}>Editar</button>{' '}
                    <button className="btn sm danger" onClick={() => delAsb(a)}>Remover</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="toolbar">
          <h2>Dentistas</h2>
          <span className="spacer" />
          <button className="btn primary" onClick={() => setDentistEdit('new')} disabled={data.rooms.length === 0}>Novo dentista</button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Nome</th><th>Especialidade</th><th>Sala</th><th>Horário</th><th>Dias</th><th></th></tr></thead>
            <tbody>
              {[...data.dentists].sort((a, b) => a.start - b.start || roomName(a.roomId).localeCompare(roomName(b.roomId))).map((x) => (
                <tr key={x.id}>
                  <td>{x.name}</td>
                  <td>{x.specialty}</td>
                  <td>{roomName(x.roomId)}</td>
                  <td className="mono">{formatRange(x.start, x.end)}</td>
                  <td>{(x.days && x.days.length > 0 ? x.days : [1, 2, 3, 4, 5]).map((d) => WEEKDAY_SHORT[d]).join(', ')}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn sm" onClick={() => setDentistEdit(x)}>Editar</button>{' '}
                    <button className="btn sm danger" onClick={() => delDentist(x)}>Remover</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="toolbar">
          <h2>Salas</h2>
          <span className="spacer" />
          <button className="btn primary" onClick={() => setRoomEdit('new')}>Nova sala</button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Ordem</th><th>Nome</th><th>Cor</th><th>Dentistas</th><th></th></tr></thead>
            <tbody>
              {[...data.rooms].sort((a, b) => a.order - b.order).map((r) => (
                <tr key={r.id}>
                  <td>{r.order}</td>
                  <td>{r.name}</td>
                  <td><span style={{ display: 'inline-block', width: 20, height: 20, borderRadius: 4, background: r.color, verticalAlign: 'middle' }} /></td>
                  <td>{data.dentists.filter((d) => d.roomId === r.id).map((d) => `${d.name} (${formatRange(d.start, d.end)})`).join(', ') || <span className="muted">nenhum</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn sm" onClick={() => setRoomEdit(r)}>Editar</button>{' '}
                    <button className="btn sm danger" onClick={() => delRoom(r)}>Remover</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {asbEdit && (
        <AsbForm
          asb={asbEdit === 'new' ? undefined : asbEdit}
          defaultColor={ASB_PALETTE[data.asbs.length % ASB_PALETTE.length]}
          onClose={() => setAsbEdit(null)}
          onSave={(a) => {
            apply((d) => {
              const i = d.asbs.findIndex((x) => x.id === a.id);
              if (i >= 0) d.asbs[i] = a;
              else d.asbs.push(a);
              // Fichas fora do novo contrato saem do quadro.
              d.base.slots = d.base.slots.filter((s) => s.asbId !== a.id || (s.hour >= a.start && s.hour < a.end));
            });
            setAsbEdit(null);
          }}
        />
      )}
      {dentistEdit && (
        <DentistForm
          dentist={dentistEdit === 'new' ? undefined : dentistEdit}
          onClose={() => setDentistEdit(null)}
          onSave={(x) => {
            apply((d) => {
              const i = d.dentists.findIndex((y) => y.id === x.id);
              if (i >= 0) d.dentists[i] = x;
              else d.dentists.push(x);
            });
            setDentistEdit(null);
          }}
        />
      )}
      {roomEdit && (
        <RoomForm
          room={roomEdit === 'new' ? undefined : roomEdit}
          nextOrder={Math.max(0, ...data.rooms.map((r) => r.order)) + 1}
          onClose={() => setRoomEdit(null)}
          onSave={(r) => {
            apply((d) => {
              const i = d.rooms.findIndex((y) => y.id === r.id);
              if (i >= 0) d.rooms[i] = r;
              else d.rooms.push(r);
            });
            setRoomEdit(null);
          }}
        />
      )}
    </div>
  );
}

function AsbForm({ asb, defaultColor, onClose, onSave }: { asb?: Asb; defaultColor: string; onClose: () => void; onSave: (a: Asb) => void }) {
  const [name, setName] = useState(asb?.name ?? '');
  const [start, setStart] = useState(asb?.start ?? 7);
  const [end, setEnd] = useState(asb?.end ?? 16);
  const [lunch, setLunch] = useState(asb?.lunch ?? true);
  const [active, setActive] = useState(asb?.active ?? true);
  const [color, setColor] = useState(asb?.color ?? defaultColor);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (!name.trim()) return setError('Informe o nome.');
    if (end <= start) return setError('A saída precisa ser depois da entrada.');
    onSave({ id: asb?.id ?? newId('asb'), name: name.trim(), start, end, lunch, active, color });
  };
  return (
    <Modal title={asb ? `Editar ${asb.name}` : 'Nova ASB'} onClose={onClose}>
      <Field label="Nome"><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <div className="field-row">
        <Field label="Entrada"><HourSelect value={start} onChange={setStart} max={18} /></Field>
        <Field label="Saída"><HourSelect value={end} onChange={setEnd} min={8} /></Field>
        <Field label="Cor da ficha"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></Field>
      </div>
      <div className="checks" style={{ marginBottom: 10 }}>
        <label><input type="checkbox" checked={lunch} onChange={(e) => setLunch(e.target.checked)} /> Precisa de 1 hora de almoço</label>
        <label><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Ativa (aparece na paleta do quadro)</label>
      </div>
      {asb && (start !== asb.start || end !== asb.end) && <p className="muted small">Fichas fora do novo horário de contrato serão removidas do quadro.</p>}
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" onClick={submit}>Salvar</button>
      </div>
    </Modal>
  );
}

function DentistForm({ dentist, onClose, onSave }: { dentist?: Dentist; onClose: () => void; onSave: (d: Dentist) => void }) {
  const data = useData();
  const [name, setName] = useState(dentist?.name ?? '');
  const [specialty, setSpecialty] = useState(dentist?.specialty ?? '');
  const [roomId, setRoomId] = useState(dentist?.roomId ?? data.rooms[0]?.id ?? '');
  const [start, setStart] = useState(dentist?.start ?? 7);
  const [end, setEnd] = useState(dentist?.end ?? 11);
  const [days, setDays] = useState<number[]>(dentist?.days && dentist.days.length > 0 ? dentist.days : [1, 2, 3, 4, 5]);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (!name.trim()) return setError('Informe o nome.');
    if (!roomId) return setError('Escolha a sala.');
    if (end <= start) return setError('O fim precisa ser depois do início.');
    if (days.length === 0) return setError('Escolha pelo menos um dia.');
    onSave({ id: dentist?.id ?? newId('den'), name: name.trim(), specialty: specialty.trim(), roomId, start, end, days });
  };
  return (
    <Modal title={dentist ? `Editar ${dentist.name}` : 'Novo dentista'} onClose={onClose}>
      <div className="field-row">
        <Field label="Nome"><input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Dr. ou Dra. Nome" /></Field>
        <Field label="Especialidade"><input value={specialty} onChange={(e) => setSpecialty(e.target.value)} /></Field>
      </div>
      <div className="field-row">
        <Field label="Sala">
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            {[...data.rooms].sort((a, b) => a.order - b.order).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Início"><HourSelect value={start} onChange={setStart} max={18} /></Field>
        <Field label="Fim"><HourSelect value={end} onChange={setEnd} min={8} /></Field>
      </div>
      <Field label="Dias de atendimento"><DaysPicker value={days} onChange={setDays} /></Field>
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" onClick={submit}>Salvar</button>
      </div>
    </Modal>
  );
}

function RoomForm({ room, nextOrder, onClose, onSave }: { room?: Room; nextOrder: number; onClose: () => void; onSave: (r: Room) => void }) {
  const [name, setName] = useState(room?.name ?? `Sala ${nextOrder}`);
  const [color, setColor] = useState(room?.color ?? '#2F5F94');
  const [order, setOrder] = useState(room?.order ?? nextOrder);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (!name.trim()) return setError('Informe o nome.');
    onSave({ id: room?.id ?? newId('sala'), name: name.trim(), color, order });
  };
  return (
    <Modal title={room ? `Editar ${room.name}` : 'Nova sala'} onClose={onClose}>
      <div className="field-row">
        <Field label="Nome"><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Ordem no quadro"><input type="number" min={1} value={order} onChange={(e) => setOrder(Number(e.target.value) || 1)} /></Field>
        <Field label="Cor"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></Field>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" onClick={submit}>Salvar</button>
      </div>
    </Modal>
  );
}
