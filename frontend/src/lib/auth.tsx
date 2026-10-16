import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { get, setUnauthorizedHandler } from './api';

export interface Me {
  id: number;
  username: string;
  name: string;
  role: 'admin' | 'tecnico' | 'escritorio';
  roleLabel: string;
  permissions: string[];
  allClients: boolean;
  clientIds: number[];
  mustChangePassword: boolean;
}

interface AuthState {
  user: Me | null;
  loading: boolean;
  catalog: Record<string, string>;
  roles: Record<string, string>;
  roleDefaults: Record<string, string[]>;
  can: (...perms: string[]) => boolean;
  refresh: () => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => get('/auth/me'),
    retry: false,
    staleTime: 60_000,
    meta: { live: false },
  });
  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(['me'], null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    });
  }, [qc]);
  const user: Me | null = me.data?.user ?? null;
  const value: AuthState = {
    user,
    loading: me.isLoading,
    catalog: me.data?.permissionCatalog ?? {},
    roles: me.data?.roles ?? {},
    roleDefaults: me.data?.roleDefaults ?? {},
    can: (...perms) => !!user && perms.every((p) => user.permissions.includes(p)),
    refresh: () => qc.invalidateQueries({ queryKey: ['me'] }),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider ausente');
  return v;
}
