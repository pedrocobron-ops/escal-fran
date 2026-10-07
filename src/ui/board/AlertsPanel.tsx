import { useState } from 'react';
import type { Alert } from '../../domain';

const OPEN_KEY = 'escala-ceo:alertas-abertos';

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Lista de alertas do quadro. Fica escondida por padrão (pedido do cliente): sobra só
 * uma linha com a contagem e o botão para abrir. As bordas nas células e as marcas nas
 * abas da semana continuam mostrando onde está o problema.
 */
export function AlertsPanel({ alerts, title = 'Alertas' }: { alerts: Alert[]; title?: string }) {
  const [open, setOpen] = useState(readOpen);
  const toggle = () => {
    setOpen((v) => {
      try {
        window.localStorage.setItem(OPEN_KEY, v ? '0' : '1');
      } catch {
        // sem localStorage: vale só nesta abertura
      }
      return !v;
    });
  };
  const rank = { critico: 0, aviso: 1, info: 2 };
  const sorted = [...alerts].sort((a, b) => rank[a.level] - rank[b.level]);
  const criticos = alerts.filter((a) => a.level === 'critico').length;
  const avisos = alerts.filter((a) => a.level === 'aviso').length;
  const infos = alerts.filter((a) => a.level === 'info').length;
  return (
    <section className={`alerts card${open ? '' : ' collapsed'}`}>
      <div className="alerts-head">
        <h3 style={{ margin: 0 }}>
          {title}{' '}
          {criticos + avisos === 0 ? (
            <span className="badge ok">Tudo certo</span>
          ) : (
            <>
              {criticos > 0 && <span className="badge critico">{criticos} crítico{criticos > 1 ? 's' : ''}</span>}{' '}
              {avisos > 0 && <span className="badge aviso">{avisos} aviso{avisos > 1 ? 's' : ''}</span>}
            </>
          )}{' '}
          {infos > 0 && <span className="badge info">{infos} remanejamento{infos > 1 ? 's' : ''} ou folga{infos > 1 ? 's' : ''}</span>}
        </h3>
        <button className="btn sm" onClick={toggle} aria-expanded={open}>{open ? 'Esconder' : 'Ver a lista'}</button>
      </div>
      {open && (
        alerts.length === 0 ? (
          <p className="muted" style={{ marginTop: 8 }}>Nenhum alerta nesta escala.</p>
        ) : (
          <ul className="alert-list" style={{ marginTop: 8 }}>
            {sorted.map((a, i) => (
              <li key={i} className={a.level}>
                {a.message}
              </li>
            ))}
          </ul>
        )
      )}
    </section>
  );
}
