// Sessão da conta e acesso à nuvem, compartilhados pelas telas (uma instância por aba).
import { AuthClient } from './auth';
import { SupabaseRemote, builtInProject, type CloudProject } from './sync';

let auth: AuthClient | null = null;
let remote: SupabaseRemote | null = null;

/** Projeto na nuvem do app (null em builds sem nuvem: o app roda só local, sem login). */
export function cloudProject(): CloudProject | null {
  return builtInProject();
}

export function getAuth(): AuthClient | null {
  if (auth) return auth;
  const project = cloudProject();
  if (!project || typeof window === 'undefined') return null;
  auth = new AuthClient(project, window.localStorage);
  return auth;
}

/** Chamadas à nuvem com a sessão atual (null sem nuvem ou sem login). */
export function getRemote(): SupabaseRemote | null {
  if (remote) return remote;
  const a = getAuth();
  const project = cloudProject();
  if (!a || !project) return null;
  remote = new SupabaseRemote(project, (force) => a.token(force));
  return remote;
}

/** Só para testes. */
export function resetSession(): void {
  auth = null;
  remote = null;
}
