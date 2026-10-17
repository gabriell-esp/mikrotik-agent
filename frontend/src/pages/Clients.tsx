import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import DataList from '../components/DataList';
import RowActions from '../components/RowActions';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, Checkbox, ConfirmDialog, Empty, ErrorBox, Field, Input, Modal, PageHeader, Pagination, SearchBox, TableSkeleton, Textarea, usePaged, useToast } from '../components/ui';
import { del, get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';

const empty = { name: '', document: '', contact: '', phone: '', email: '', notes: '', active: true };

export default function ClientsPage() {
  const nav = useNavigate();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => get('/clients') });
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...empty });
  const [removing, setRemoving] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);

  const rows = useMemo(() => {
    const t = search.toLowerCase();
    return (clients.data ?? []).filter((c: any) => !t || [c.name, c.document, c.contact, c.phone, c.email].join(' ').toLowerCase().includes(t));
  }, [clients.data, search]);
  const paged = usePaged(rows, 25);

  const open = (c?: any) => {
    setError(null);
    setEditing(c ?? {});
    setForm(c ? { ...empty, ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v ?? ''])) } : { ...empty });
  };

  const save = useMutation({
    mutationFn: () => (editing?.id ? put(`/clients/${editing.id}`, form) : post('/clients', form)),
    onSuccess: () => {
      toast.ok('Cliente salvo.');
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: setError,
  });

  const remove = useMutation({
    mutationFn: () => del(`/clients/${removing.id}`),
    onSuccess: () => {
      toast.ok('Cliente excluído.');
      setRemoving(null);
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: toast.err,
  });

  const set = (k: keyof typeof empty, v: any) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <PageHeader title="Clientes" actions={can('clients.manage') && <Button variant="primary" className="w-full sm:w-auto" onClick={() => open()}><Plus className="size-4" /> Novo cliente</Button>} />
      <Card bodyClass="" title={`${rows.length} clientes`} actions={<SearchBox value={search} onChange={setSearch} className="w-full sm:w-64" />}>
        {clients.isLoading ? <TableSkeleton cols={4} /> : clients.error ? <div className="p-4"><ErrorBox error={clients.error} /></div> : rows.length === 0 ? <Empty>Nenhum cliente.</Empty> : (
          <>
            <DataList
              rows={paged.slice}
              rowKey={(c: any) => c.id}
              onRowClick={(c: any) => nav(`/equipamentos?cliente=${c.id}`)}
              accent={(c: any) => (c.problems > 0 ? 'red' : c.devices ? 'green' : 'slate')}
              cols={[
                {
                  key: 'name', header: 'Cliente', mobile: 'title',
                  cell: (c: any) => <div><span className="font-medium text-slate-900">{c.name}</span>{c.document && <span className="block text-xs font-normal text-slate-500">{c.document}</span>}</div>,
                },
                { key: 'status', header: 'Situação', mobile: 'badges', cell: (c: any) => (c.active ? <Badge color="green" dot>Ativo</Badge> : <Badge dot>Inativo</Badge>) },
                {
                  key: 'devices', header: 'Equipamentos', td: 'whitespace-nowrap text-xs',
                  cell: (c: any) => (
                    <span className="text-xs">
                      {c.devices} total · <span className="text-emerald-700">{c.online} ok</span>
                      {c.problems > 0 && <> · <span className="text-red-700">{c.problems} com problema</span></>}
                    </span>
                  ),
                },
                { key: 'contact', header: 'Contato', td: 'text-xs', cell: (c: any) => <span className="text-xs">{[c.contact, c.phone, c.email].filter(Boolean).join(' · ') || '—'}</span> },
                {
                  key: 'actions', header: '', mobile: 'actions', td: 'whitespace-nowrap text-right',
                  cell: (c: any) => (
                    <RowActions
                      title={c.name}
                      actions={[
                        { icon: Pencil, label: 'Editar', onClick: () => open(c), show: can('clients.manage') },
                        { icon: Trash2, label: 'Excluir', tone: 'danger', onClick: () => setRemoving(c), show: can('clients.manage') },
                      ]}
                    />
                  ),
                },
              ]}
            />
            <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} onPage={paged.setPage} />
          </>
        )}
      </Card>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Editar cliente' : 'Novo cliente'}
        footer={<><Button onClick={() => setEditing(null)}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button></>}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><ErrorBox error={error} title="Não foi possível salvar" /></div>
          <Field label="Nome" className="sm:col-span-2"><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="CNPJ/CPF"><Input value={form.document} onChange={(e) => set('document', e.target.value)} /></Field>
          <Field label="Contato"><Input value={form.contact} onChange={(e) => set('contact', e.target.value)} /></Field>
          <Field label="Telefone"><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="E-mail"><Input value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Observações" className="sm:col-span-2"><Textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
          <Checkbox label="Cliente ativo" checked={form.active} onChange={(v) => set('active', v)} />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title="Excluir cliente"
        message={<>Excluir o cliente <b>{removing?.name}</b>? Só é possível quando não há equipamentos vinculados.</>}
        confirmText={removing?.name}
        confirmLabel="Excluir"
      />
    </div>
  );
}
