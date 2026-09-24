import { useEffect, useState } from 'react';

export type Route = 'quadro' | 'tarefas' | 'ausencias' | 'equipe' | 'mes' | 'ajustes';

export const ROUTES: Array<{ id: Route; label: string }> = [
  { id: 'quadro', label: 'Quadro' },
  { id: 'tarefas', label: 'Tarefas e rodízios' },
  { id: 'ausencias', label: 'Ausências' },
  { id: 'equipe', label: 'Equipe e salas' },
  { id: 'mes', label: 'Visão do mês' },
  { id: 'ajustes', label: 'Ajustes' },
];

function parse(): Route {
  const h = window.location.hash.replace(/^#\/?/, '').split('/')[0];
  return (ROUTES.find((r) => r.id === h)?.id ?? 'quadro') as Route;
}

/** Roteamento por hash, que funciona no GitHub Pages sem configuração. */
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function href(route: Route): string {
  return `#/${route}`;
}
