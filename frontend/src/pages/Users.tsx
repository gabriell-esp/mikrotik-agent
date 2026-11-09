import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LockOpen, Pencil, Plus, UserX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Avatar from '../components/Avatar';
import DataList from '../components/DataList';
import PermissionChecklist from '../components/PermissionChecklist';
import PermissionGroups from '../components/PermissionGroups';
import RowActions from '../components/RowActions';
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Field, Input, Modal, Notice, PageHeader, Select, TableSkeleton, Tabs, useToast } from '../components/ui';
import { get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';

const ROLE_COLOR: Record<string, 'purple' | 'blue' | 'slate'> = { admin: 'purple', tecnico: 'blue', escritorio: 'slate' };

/** Dias que faltam para a exclusão automática de um usuário desativado (null = não se aplica). */
function daysLeft(u: any, days: number): number | null {
  if (u.active || !days || !u.deactivated_at) return null;
  const end = new Date(u.deactivated_at).getTime() + days * 86400e3;
  return Math.max(0, Math.ceil((end - Date.now()) / 86400e3));
}

/** Configuração: excluir automaticamente quem está desativado há X dias. */
function AutoDeleteCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['users', 'settings'], queryFn: () => get('/users/settings') });
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setDays(q.data.auto_delete_days ? String(q.data.auto_delete_days) : '');
  }, [q.data]);
  const n = days.trim() ? Number(days) : 0;
  const valid = Number.isInteger(n) && n >= 0 && n <= 3650;
  const changed = q.data && n !== q.data.auto_delete_days;
  const save = async () => {
    setBusy(true);
    try {
      await put('/users/settings', { auto_delete_days: n });
      toast.ok(n ? `Usuários desativados há mais de ${n} dias serão excluídos automaticamente.` : 'Exclusão automática desligada.');
      qc.invalidateQueries({ queryKey: ['users'] });
    } catch (e) {
      toast.err(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Exclusão automática de usuários desativados" icon={UserX}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Excluir após (dias desativado)" hint="Deixe vazio ou 0 para nunca excluir. A contagem começa quando o usuário é desativado." className="sm:w-80">
          <Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} placeholder="Ex.: 30" />
        </Field>
        <Button variant="primary" onClick={save} loading={busy} disabled={!valid || !changed} className="sm:mb-6">Salvar</Button>
      </div>
      <p className="text-xs text-slate-500">
        A exclusão é verificada a cada hora e fica registrada na auditoria. Ordens de serviço e histórico continuam com o nome de quem fez cada ação.
      </p>
    </Card>
  );
}

export default function UsersPage() {
  const { catalog, roles, roleDefaults, user: me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const users = useQuery({ queryKey: ['users'], queryFn: () => get('/users') });
  const settings = useQuery({ queryKey: ['users', 'settings'], queryFn: () => get('/users/settings') });
  const autoDays: number = settings.data?.auto_delete_days ?? 0;
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => get('/clients') });
  const groups = useQuery<any[]>({ queryKey: ['users', 'groups'], queryFn: () => get('/permission-groups') });
  const groupName = new Map<number, string>((groups.data ?? []).map((g) => [g.id, g.name]));
  const [params, setParams] = useSearchParams();
  const tab = params.get('aba') === 'grupos' ? 'grupos' : 'usuarios';
  const [editing, setEditing] = useState<any>(null);
  const [f, setF] = useState<any>({});
  const [error, setError] = useState<unknown>(null);
  const [resetting, setResetting] = useState<any>(null);
  const [newPw, setNewPw] = useState('');

  const open = (u?: any) => {
    setError(null);
    setEditing(u ?? {});
    setF(
      u
        ? { name: u.name, email: u.email ?? '', role: u.role, all_clients: u.all_clients, client_ids: u.client_ids, active: u.active, grant: u.permissions_grant, revoke: u.permissions_revoke, group_ids: u.group_ids ?? [] }
        : { username: '', name: '', email: '', role: 'escritorio', all_clients: false, client_ids: [], active: true, grant: [], revoke: [], group_ids: [], password: '', must_change_password: true },
    );
  };

  // Base de permissões: soma dos grupos escolhidos ou, sem grupo, o padrão do perfil.
  const chosenGroups = (groups.data ?? []).filter((g) => f.group_ids?.includes(g.id));
  const defaults: string[] = chosenGroups.length ? [...new Set(chosenGroups.flatMap((g) => g.permissions as string[]))] : (roleDefaults[f.role] ?? []);
  const effective = (p: string) => f.role === 'admin' || (defaults.includes(p) ? !f.revoke?.includes(p) : f.grant?.includes(p));
  const togglePerm = (p: string, on: boolean) => {
    setF((x: any) => {
      const grant = new Set<string>(x.grant);
      const revoke = new Set<string>(x.revoke);
      if (defaults.includes(p)) {
        if (on) revoke.delete(p);
        else revoke.add(p);
        grant.delete(p);
      } else {
        if (on) grant.add(p);
        else grant.delete(p);
        revoke.delete(p);
      }
      return { ...x, grant: [...grant], revoke: [...revoke] };
    });
  };

  const save = useMutation({
    mutationFn: () => {
      const isAdmin = f.role === 'admin';
      // Ajustes individuais só do que difere da base (trocar de grupo pode deixar sobras).
      const body = { name: f.name, email: f.email, role: f.role, all_clients: f.all_clients, client_ids: f.client_ids, active: f.active,
        group_ids: isAdmin ? [] : f.group_ids,
        permissions_grant: isAdmin ? [] : f.grant.filter((p: string) => !defaults.includes(p)),
        permissions_revoke: isAdmin ? [] : f.revoke.filter((p: string) => defaults.includes(p)) };
      return editing.id ? put(`/users/${editing.id}`, body) : post('/users', { ...body, username: f.username, password: f.password, must_change_password: f.must_change_password });
    },
    onSuccess: () => {
      toast.ok('Usuário salvo.');
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: setError,
  });

  const reset = useMutation({
    mutationFn: () => post(`/users/${resetting.id}/reset-password`, { password: newPw }),
    onSuccess: () => {
      toast.ok('Senha redefinida. O usuário deverá trocá-la no próximo acesso.');
      setResetting(null);
    },
    onError: toast.err,
  });

  const unlock = useMutation({
    mutationFn: (id: number) => post(`/users/${id}/unlock`),
    onSuccess: () => { toast.ok('Usuário desbloqueado.'); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: toast.err,
  });

  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Usuários do sistema"
        actions={tab === 'usuarios' && <Button variant="primary" className="w-full sm:w-auto" onClick={() => open()}><Plus className="size-4" /> Novo usuário</Button>}
      />
      <Tabs
        tabs={[
          { key: 'usuarios', label: <>Usuários{users.data && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 tabular-nums">{users.data.length}</span>}</> },
          { key: 'grupos', label: <>Grupos de permissões{groups.data && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 tabular-nums">{groups.data.length}</span>}</> },
        ]}
        active={tab}
        onChange={(k) => setParams(k === 'grupos' ? { aba: 'grupos' } : {}, { replace: true })}
      />
      {tab === 'grupos' ? <PermissionGroups users={users.data ?? []} /> : (<>
      <Card bodyClass="">
        {users.isLoading ? <TableSkeleton cols={5} /> : users.error ? <div className="p-4"><ErrorBox error={users.error} /></div> : !users.data.length ? <Empty>Nenhum usuário.</Empty> : (
          <>
            <DataList
              rows={users.data}
              rowKey={(u: any) => u.id}
              accent={(u: any) => (!u.active ? 'slate' : u.locked ? 'red' : 'green')}
              cols={[
                {
                  key: 'name', header: 'Usuário', mobile: 'title',
                  cell: (u: any) => (
                    <div className="flex items-center gap-3">
                      <Avatar id={u.id} name={u.name} version={u.avatar_updated_at} className="max-md:hidden" />
                      <div className="min-w-0"><span className="font-medium text-slate-900">{u.name}</span><span className="block text-xs font-normal break-all text-slate-500">{u.username}{u.email ? ` · ${u.email}` : ''}</span></div>
                    </div>
                  ),
                },
                {
                  key: 'role', header: 'Perfil', mobile: 'badges',
                  cell: (u: any) => (
                    <div className="flex flex-wrap items-center gap-1 md:block">
                      <Badge color={ROLE_COLOR[u.role]}>{roles[u.role] ?? u.role}</Badge>
                      {u.role !== 'admin' && (u.group_ids ?? []).filter((id: number) => groupName.has(id)).map((id: number) => <span key={id} className="md:ml-1"><Badge color="blue">{groupName.get(id)}</Badge></span>)}
                      {(u.permissions_grant.length > 0 || u.permissions_revoke.length > 0) && <span className="text-xs text-slate-500 md:block">permissões ajustadas</span>}
                    </div>
                  ),
                },
                {
                  key: 'status', header: 'Situação', mobile: 'badges',
                  cell: (u: any) => (
                    <div className="flex flex-wrap gap-1">
                      {u.active ? <Badge color="green" dot>Ativo</Badge> : <Badge dot>Inativo</Badge>}
                      {daysLeft(u, autoDays) != null && (
                        <Badge color="red" title={`Desativado em ${fmtDateTime(u.deactivated_at)}`}>
                          {daysLeft(u, autoDays) === 0 ? 'Exclusão na próxima verificação' : `Excluído em ${daysLeft(u, autoDays)} dia(s)`}
                        </Badge>
                      )}
                      {u.locked && <Badge color="red">Bloqueado</Badge>}
                      {u.must_change_password && <Badge color="amber">Trocar senha</Badge>}
                    </div>
                  ),
                },
                { key: 'clients', header: 'Clientes', cell: (u: any) => <span className="text-xs">{u.all_clients || u.role === 'admin' ? 'Todos' : `${u.client_ids.length} cliente(s)`}</span> },
                { key: 'last', header: 'Último acesso', cell: (u: any) => <span className="text-xs">{fmtDateTime(u.last_login_at)}</span> },
                {
                  key: 'actions', header: '', mobile: 'actions', td: 'whitespace-nowrap text-right',
                  cell: (u: any) => (
                    <RowActions
                      title={u.name}
                      actions={[
                        { icon: LockOpen, label: 'Desbloquear', onClick: () => unlock.mutate(u.id), show: u.locked },
                        { icon: KeyRound, label: 'Redefinir senha', onClick: () => { setNewPw(''); setResetting(u); } },
                        { icon: Pencil, label: 'Editar', onClick: () => open(u) },
                      ]}
                    />
                  ),
                },
              ]}
            />
          </>
        )}
      </Card>
      <AutoDeleteCard />
      </>)}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        wide
        title={editing?.id ? `Editar ${editing.username}` : 'Novo usuário'}
        footer={<><Button onClick={() => setEditing(null)}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button></>}
      >
        <div className="space-y-4">
          <ErrorBox error={error} title="Não foi possível salvar" />
          <div className="grid gap-3 sm:grid-cols-2">
            {!editing?.id && <Field label="Login"><Input value={f.username ?? ''} onChange={(e) => set('username', e.target.value.toLowerCase())} autoComplete="off" /></Field>}
            <Field label="Nome"><Input value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="E-mail"><Input value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
            <Field label="Perfil">
              <Select value={f.role} onChange={(e) => setF((x: any) => ({ ...x, role: e.target.value, grant: [], revoke: [], group_ids: e.target.value === 'admin' ? [] : x.group_ids }))} disabled={editing?.id === me?.id}>
                {Object.entries(roles).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            {!editing?.id && (
              <>
                <Field label="Senha inicial" hint="Mínimo de 10 caracteres, com letras e números."><Input type="password" value={f.password ?? ''} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" /></Field>
                <div className="flex items-end pb-1"><Checkbox label="Exigir troca no primeiro acesso" checked={!!f.must_change_password} onChange={(v) => set('must_change_password', v)} /></div>
              </>
            )}
            {editing?.id && editing.id !== me?.id && <Checkbox label="Usuário ativo" checked={!!f.active} onChange={(v) => set('active', v)} />}
          </div>

          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-700">Acesso a clientes</h4>
            {f.role === 'admin' ? <Notice kind="info">Administradores acessam todos os clientes.</Notice> : (
              <>
                <Checkbox label="Todos os clientes (inclui a MikroTik central)" checked={!!f.all_clients} onChange={(v) => set('all_clients', v)} />
                {!f.all_clients && (
                  <div className="mt-2 grid max-h-48 gap-1 overflow-y-auto rounded-md border border-slate-200 p-2 sm:grid-cols-2">
                    {(clients.data ?? []).map((c: any) => (
                      <Checkbox key={c.id} label={c.name} checked={f.client_ids?.includes(c.id)}
                        onChange={(v) => set('client_ids', v ? [...f.client_ids, c.id] : f.client_ids.filter((x: number) => x !== c.id))} />
                    ))}
                    {!clients.data?.length && <span className="text-xs text-slate-500">Nenhum cliente cadastrado.</span>}
                  </div>
                )}
              </>
            )}
          </div>

          {f.role !== 'admin' && (
            <div>
              <h4 className="mb-1 text-sm font-semibold text-slate-700">Grupos de permissões</h4>
              {!groups.data?.length ? (
                <p className="text-xs text-slate-500">Nenhum grupo criado. Crie grupos na aba “Grupos de permissões” para não precisar ajustar usuário por usuário.</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-md border border-slate-200 p-2">
                    {groups.data.map((g: any) => (
                      <Checkbox key={g.id} label={<span>{g.name} <span className="text-xs text-slate-500">({g.permissions.length})</span></span>} checked={!!f.group_ids?.includes(g.id)}
                        onChange={(v) => set('group_ids', v ? [...f.group_ids, g.id] : f.group_ids.filter((x: number) => x !== g.id))} />
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {chosenGroups.length ? 'As permissões vêm dos grupos marcados (no lugar do padrão do perfil).' : `Sem grupo: vale o padrão do perfil ${roles[f.role] ?? ''}.`}
                  </p>
                </>
              )}
            </div>
          )}

          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-700">Permissões</h4>
            {f.role === 'admin' ? <Notice kind="info">Administradores possuem todas as permissões.</Notice> : (
              <>
                <p className="mb-2 text-xs text-slate-500">Marque ou desmarque só as exceções deste usuário; o restante segue {chosenGroups.length ? 'os grupos' : 'o perfil'}.</p>
                <PermissionChecklist
                  catalog={catalog}
                  checked={(p) => !!effective(p)}
                  onToggle={togglePerm}
                  badge={(p) => (!defaults.includes(p) && effective(p) ? <Badge color="blue">concedida</Badge> : defaults.includes(p) && !effective(p) ? <Badge color="red">removida</Badge> : null)}
                />
              </>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={!!resetting}
        onClose={() => setResetting(null)}
        title={`Redefinir senha de ${resetting?.username}`}
        footer={<><Button onClick={() => setResetting(null)}>Cancelar</Button><Button variant="primary" loading={reset.isPending} onClick={() => reset.mutate()}>Redefinir</Button></>}
      >
        <Field label="Nova senha temporária" hint="O usuário será obrigado a trocar no próximo acesso e as sessões atuais serão encerradas.">
          <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
        </Field>
      </Modal>
    </div>
  );
}
