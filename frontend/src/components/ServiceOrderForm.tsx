import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { get, post, put } from '../lib/api';
import { fromLocalInput, OS_PRIORITY, toLocalInput } from '../lib/os';
import { Button, ErrorBox, Field, Input, Modal, Notice, Select, Textarea, useToast } from './ui';

const empty = { title: '', description: '', client_id: null as number | null, location: '', contact: '', priority: 'normal', assigned_to: null as number | null, scheduled_for: '' };

/** Abertura/edição de ordem de serviço (quem tem a permissão de gerenciar). */
/** initial: ordem existente (edição). preset: valores iniciais de uma ordem nova (ex.: vinda do planejamento). */
export default function ServiceOrderForm({ open, onClose, initial, preset, onSaved }: { open: boolean; onClose: () => void; initial?: any; preset?: Partial<typeof empty>; onSaved?: (o: any) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => get('/clients'), enabled: open });
  const assignees = useQuery({ queryKey: ['os', 'assignees'], queryFn: () => get('/os/assignees'), enabled: open });
  const [f, setF] = useState({ ...empty });
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const editing = !!initial?.id;

  useEffect(() => {
    if (!open) return;
    setF(initial?.id
      ? {
          title: initial.title, description: initial.description ?? '', client_id: initial.client_id, location: initial.location ?? '', contact: initial.contact ?? '',
          priority: initial.priority, assigned_to: initial.assigned_to, scheduled_for: toLocalInput(initial.scheduled_for),
        }
      : { ...empty, ...preset });
    setError(null);
  }, [open, initial, preset]);

  const set = <K extends keyof typeof empty>(k: K, v: (typeof empty)[K]) => setF((x) => ({ ...x, [k]: v }));
  const reassigning = editing && initial.status === 'em_andamento' && f.assigned_to !== initial.assigned_to;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = { ...f, scheduled_for: fromLocalInput(f.scheduled_for) };
      const saved = editing ? await put(`/os/${initial.id}`, body) : await post('/os', body);
      // Vinda do planejamento, quem chamou avisa o resultado completo.
      if (!preset) toast.ok(editing ? 'Ordem de serviço atualizada.' : `Ordem de serviço #${saved.id} aberta.`);
      qc.invalidateQueries({ queryKey: ['os'] });
      onSaved?.(saved);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={editing ? 'Editar ordem de serviço' : 'Nova ordem de serviço'}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={f.title.trim().length < 3}>{editing ? 'Salvar' : 'Abrir ordem'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBox error={error} title="Não foi possível salvar" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Título" className="sm:col-span-2">
            <Input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Ex.: Trocar antena do bloco B" autoFocus={!editing} />
          </Field>
          <Field label="Cliente / condomínio">
            <Select value={f.client_id ?? ''} onChange={(e) => set('client_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">— (sem cliente)</option>
              {(clients.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Técnico responsável" hint={assignees.data && !assignees.data.length ? 'Nenhum usuário com permissão para executar ordens.' : undefined}>
            <Select value={f.assigned_to ?? ''} onChange={(e) => set('assigned_to', e.target.value ? Number(e.target.value) : null)}>
              <option value="">— (atribuir depois)</option>
              {(assignees.data ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.name}{u.open ? ` · ${u.open} em aberto` : ''}</option>)}
            </Select>
          </Field>
          <Field label="Prioridade">
            <Select value={f.priority} onChange={(e) => set('priority', e.target.value)}>
              {Object.entries(OS_PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          </Field>
          <Field label="Agendada para (opcional)">
            <Input type="datetime-local" value={f.scheduled_for} onChange={(e) => set('scheduled_for', e.target.value)} />
          </Field>
          <Field label="Local (opcional)">
            <Input value={f.location} onChange={(e) => set('location', e.target.value)} placeholder="Ex.: Bloco B, 3º andar" />
          </Field>
          <Field label="Contato no local (opcional)">
            <Input value={f.contact} onChange={(e) => set('contact', e.target.value)} placeholder="Ex.: Sr. João (síndico) · 11 99999-0000" />
          </Field>
          <Field label="Descrição do serviço" className="sm:col-span-2">
            <Textarea rows={4} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="O que precisa ser feito, sintomas relatados, materiais a levar…" />
          </Field>
        </div>
        {reassigning && <Notice>A ordem está em andamento: ao trocar o técnico, o cronômetro atual é encerrado e a ordem fica pausada para o novo responsável.</Notice>}
      </div>
    </Modal>
  );
}
