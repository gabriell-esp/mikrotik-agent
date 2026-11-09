import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Pencil, Plus, Trash2, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { del, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import Avatar from './Avatar';
import DataList from './DataList';
import PermissionChecklist from './PermissionChecklist';
import RowActions from './RowActions';
import { Badge, Button, Card, Checkbox, ConfirmDialog, Empty, ErrorBox, Field, Input, Modal, Notice, SearchBox, TableSkeleton, useToast } from './ui';

type Group = { id: number; name: string; description: string | null; permissions: string[]; member_ids: number[]; members: number };

/** Grupos de permissões: um conjunto de permissões aplicado a vários usuários de uma vez. */
export default function PermissionGroups({ users }: { users: any[] }) {
  const { catalog, roles, roleDefaults } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const groups = useQuery<Group[]>({ queryKey: ['users', 'groups'], queryFn: () => get('/permission-groups') });
  const [editing, setEditing] = useState<Partial<Group> | null>(null);
  const [f, setF] = useState({ name: '', description: '', permissions: [] as string[], member_ids: [] as number[] });
  const [memberSearch, setMemberSearch] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<Group | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);

  const candidates = users.filter((u) => u.role !== 'admin');
  const shownCandidates = candidates.filter((u) => !memberSearch || `${u.name} ${u.username}`.toLowerCase().includes(memberSearch.toLowerCase()));

  const open = (g?: Group) => {
    setError(null);
    setMemberSearch('');
    setEditing(g ?? {});
    setF(g ? { name: g.name, description: g.description ?? '', permissions: g.permissions, member_ids: g.member_ids } : { name: '', description: '', permissions: [], member_ids: [] });
  };
  const has = (p: string) => f.permissions.includes(p);
  const toggle = (p: string, on: boolean) => setF((x) => ({ ...x, permissions: on ? [...new Set([...x.permissions, p])] : x.permissions.filter((y) => y !== p) }));

  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editing?.id) await put(`/permission-groups/${editing.id}`, f);
      else await post('/permission-groups', f);
      toast.ok(editing?.id ? 'Grupo atualizado. As permissões dos membros já mudaram.' : 'Grupo criado.');
      setEditing(null);
      refresh();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusyDelete(true);
    try {
      await del(`/permission-groups/${removing.id}`);
      toast.ok('Grupo excluído.');
      setRemoving(null);
      refresh();
    } catch (e) {
      toast.err(e);
    } finally {
      setBusyDelete(false);
    }
  };

  const byId = new Map(users.map((u) => [u.id, u]));

  return (
    <>
      <Card
        title="Grupos de permissões"
        icon={UsersRound}
        bodyClass=""
        actions={<Button variant="primary" size="sm" className="w-full sm:w-auto" onClick={() => open()}><Plus className="size-4" /> Novo grupo</Button>}
      >
        <p className="border-b border-slate-100 px-4 pt-3 pb-3 text-sm text-slate-600">
          Monte o conjunto de permissões uma vez e coloque os usuários no grupo. Ao alterar o grupo, todos os membros mudam juntos.
          Quem está em um grupo usa as permissões do grupo no lugar do padrão do perfil.
        </p>
        {groups.isLoading ? <TableSkeleton cols={4} /> : groups.error ? <div className="p-4"><ErrorBox error={groups.error} /></div> : !groups.data?.length ? (
          <Empty icon={UsersRound}>Nenhum grupo ainda. Crie um, por exemplo “Técnico de campo” ou “Atendimento”.</Empty>
        ) : (
          <DataList
            rows={groups.data}
            rowKey={(g: Group) => g.id}
            onRowClick={(g: Group) => open(g)}
            cols={[
              {
                key: 'name', header: 'Grupo', mobile: 'title',
                cell: (g: Group) => (
                  <div className="min-w-0">
                    <span className="font-medium text-slate-900">{g.name}</span>
                    {g.description && <span className="block text-xs text-slate-500">{g.description}</span>}
                  </div>
                ),
              },
              { key: 'perms', header: 'Permissões', mobile: 'badges', cell: (g: Group) => <Badge color="blue">{g.permissions.length} de {Object.keys(catalog).length}</Badge> },
              {
                key: 'members', header: 'Membros', mobile: 'subtitle',
                cell: (g: Group) => g.members ? (
                  <span className="inline-flex items-center gap-2 text-sm">
                    <span className="flex -space-x-2 max-md:hidden">
                      {g.member_ids.slice(0, 4).map((id) => <Avatar key={id} id={id} name={byId.get(id)?.name} version={byId.get(id)?.avatar_updated_at} size="xs" ring />)}
                    </span>
                    {g.members} usuário(s)
                  </span>
                ) : <span className="text-xs text-slate-400">Sem membros</span>,
              },
              {
                key: 'actions', header: '', mobile: 'actions', td: 'whitespace-nowrap text-right',
                cell: (g: Group) => (
                  <RowActions
                    title={g.name}
                    actions={[
                      { icon: Pencil, label: 'Editar', onClick: () => open(g) },
                      { icon: Copy, label: 'Duplicar', onClick: () => { open(); setF({ name: `${g.name} (cópia)`, description: g.description ?? '', permissions: g.permissions, member_ids: [] }); } },
                      { icon: Trash2, label: 'Excluir', onClick: () => setRemoving(g), tone: 'danger' },
                    ]}
                  />
                ),
              },
            ]}
          />
        )}
      </Card>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        wide
        title={editing?.id ? `Editar grupo ${editing.name}` : 'Novo grupo de permissões'}
        footer={<><Button onClick={() => setEditing(null)}>Cancelar</Button><Button variant="primary" loading={saving} disabled={f.name.trim().length < 2} onClick={save}>Salvar</Button></>}
      >
        <div className="space-y-5">
          <ErrorBox error={error} title="Não foi possível salvar" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome do grupo"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex.: Técnico de campo" autoFocus={!editing?.id} /></Field>
            <Field label="Descrição (opcional)"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Para que serve o grupo" /></Field>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-700">Permissões <span className="font-normal text-slate-500">({f.permissions.length} marcada(s))</span></h4>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-slate-500">Partir do padrão:</span>
                {Object.entries(roles).filter(([k]) => k !== 'admin').map(([k, label]) => (
                  <button key={k} type="button" className="rounded-full border border-slate-200 px-2 py-0.5 font-medium text-slate-600 hover:border-brand-300 hover:text-brand-700"
                    onClick={() => setF((x) => ({ ...x, permissions: [...(roleDefaults[k] ?? [])] }))}>
                    {label}
                  </button>
                ))}
                <button type="button" className="rounded-full border border-slate-200 px-2 py-0.5 font-medium text-slate-600 hover:border-red-300 hover:text-red-700" onClick={() => setF((x) => ({ ...x, permissions: [] }))}>Limpar</button>
              </div>
            </div>
            <PermissionChecklist catalog={catalog} checked={has} onToggle={toggle} />
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-700">Membros <span className="font-normal text-slate-500">({f.member_ids.length})</span></h4>
              {candidates.length > 8 && <SearchBox value={memberSearch} onChange={setMemberSearch} placeholder="Buscar usuário…" className="w-full sm:w-56" />}
            </div>
            {!candidates.length ? <Notice kind="info">Nenhum usuário para adicionar. Administradores já têm todas as permissões e não entram em grupos.</Notice> : (
              <div className="grid max-h-60 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
                {shownCandidates.map((u) => (
                  <Checkbox
                    key={u.id}
                    checked={f.member_ids.includes(u.id)}
                    onChange={(v) => setF((x) => ({ ...x, member_ids: v ? [...x.member_ids, u.id] : x.member_ids.filter((y) => y !== u.id) }))}
                    label={
                      <span className="inline-flex items-center gap-2">
                        <Avatar id={u.id} name={u.name} version={u.avatar_updated_at} size="xs" />
                        <span>{u.name} <span className="text-xs text-slate-500">· {roles[u.role] ?? u.role}{!u.active ? ' · inativo' : ''}</span></span>
                      </span>
                    }
                  />
                ))}
                {!shownCandidates.length && <span className="text-xs text-slate-500">Nenhum usuário encontrado.</span>}
              </div>
            )}
            <p className="mt-1.5 text-xs text-slate-500">Administradores não aparecem aqui: eles sempre têm todas as permissões.</p>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        loading={busyDelete}
        title={`Excluir o grupo ${removing?.name ?? ''}?`}
        confirmLabel="Excluir grupo"
        message={removing?.members
          ? `Os ${removing.members} membro(s) deixam o grupo e voltam ao padrão do perfil (ou aos outros grupos que tiverem). Ajustes individuais são mantidos.`
          : 'O grupo não tem membros.'}
      />
    </>
  );
}
