import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { get, post, put } from '../lib/api';
import { fmtPhone, fromLocalInput, OS_PRIORITY, toLocalInput } from '../lib/os';
import { Button, ErrorBox, Field, IconButton, Input, Modal, Notice, Select, Textarea, useToast } from './ui';

type Contact = { name: string; phone: string };
const blankContact = (): Contact => ({ name: '', phone: '' });
const empty = {
  title: '', description: '', client_id: null as number | null, location: '', priority: 'normal',
  assigned_to: null as number | null, helper_id: null as number | null, scheduled_for: '', contacts: [blankContact()] as Contact[],
};
const phoneOk = (v: string) => /^(55)?\d{10,11}$/.test(v.replace(/\D/g, ''));

/** Abertura/edição de ordem de serviço (quem tem a permissão de gerenciar).
 *  initial: ordem existente (edição). preset: valores iniciais de uma ordem nova (ex.: vinda do planejamento). */
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
          title: initial.title, description: initial.description ?? '', client_id: initial.client_id, location: initial.location ?? '',
          priority: initial.priority, assigned_to: initial.assigned_to, helper_id: initial.helper_id ?? null, scheduled_for: toLocalInput(initial.scheduled_for),
          contacts: initial.contacts?.length ? initial.contacts.map((c: Contact) => ({ name: c.name, phone: fmtPhone(c.phone) })) : [blankContact()],
        }
      : { ...empty, contacts: [blankContact()], ...preset });
    setError(null);
  }, [open, initial, preset]);

  const set = <K extends keyof typeof empty>(k: K, v: (typeof empty)[K]) => setF((x) => ({ ...x, [k]: v }));
  const setContact = (i: number, patch: Partial<Contact>) => set('contacts', f.contacts.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const reassigning = editing && initial.status === 'em_andamento' && f.assigned_to !== initial.assigned_to;
  const contactsOk = f.contacts.some((c) => c.name.trim().length >= 2 && phoneOk(c.phone));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Linhas de contato vazias são ignoradas; as preenchidas pela metade o servidor recusa com a mensagem certa.
      const contacts = f.contacts.filter((c) => c.name.trim() || c.phone.trim());
      const body = { ...f, contacts, helper_id: f.assigned_to ? f.helper_id : null, scheduled_for: fromLocalInput(f.scheduled_for) };
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

  const techOptions = (exclude?: number | null) => (assignees.data ?? []).filter((u: any) => u.id !== exclude);

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={editing ? 'Editar ordem de serviço' : 'Nova ordem de serviço'}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={f.title.trim().length < 3 || !contactsOk}>{editing ? 'Salvar' : 'Abrir ordem'}</Button>
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
          <Field label="Prioridade">
            <Select value={f.priority} onChange={(e) => set('priority', e.target.value)}>
              {Object.entries(OS_PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          </Field>
          <Field label="Técnico responsável" hint={assignees.data && !assignees.data.length ? 'Nenhum usuário com permissão para executar ordens.' : undefined}>
            <Select
              value={f.assigned_to ?? ''}
              onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : null;
                setF((x) => ({ ...x, assigned_to: v, helper_id: v && x.helper_id !== v ? x.helper_id : null }));
              }}
            >
              <option value="">— (atribuir depois)</option>
              {techOptions().map((u: any) => <option key={u.id} value={u.id}>{u.name}{u.open ? ` · ${u.open} em aberto` : ''}</option>)}
            </Select>
          </Field>
          <Field label="Segundo técnico (opcional)" hint="Com dois técnicos, os dois precisam finalizar a ordem.">
            <Select value={f.helper_id ?? ''} disabled={!f.assigned_to} onChange={(e) => set('helper_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">{f.assigned_to ? '— (somente o responsável)' : 'Escolha o responsável primeiro'}</option>
              {techOptions(f.assigned_to).map((u: any) => <option key={u.id} value={u.id}>{u.name}{u.open ? ` · ${u.open} em aberto` : ''}</option>)}
            </Select>
          </Field>
          <Field label="Agendada para (opcional)">
            <Input type="datetime-local" value={f.scheduled_for} onChange={(e) => set('scheduled_for', e.target.value)} />
          </Field>
          <Field label="Local (opcional)">
            <Input value={f.location} onChange={(e) => set('location', e.target.value)} placeholder="Ex.: Bloco B, 3º andar" />
          </Field>
        </div>

        <div>
          <div className="mb-1.5 text-sm font-medium text-slate-700">Contatos no local <span className="font-normal text-slate-500">(ao menos um, com WhatsApp)</span></div>
          <div className="space-y-2">
            {f.contacts.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_12rem_auto]">
                <Input value={c.name} onChange={(e) => setContact(i, { name: e.target.value })} placeholder="Nome (ex.: Sr. João, síndico)" className="col-span-2 sm:col-span-1" />
                <Input
                  inputMode="tel"
                  value={c.phone}
                  onChange={(e) => setContact(i, { phone: e.target.value })}
                  onBlur={() => phoneOk(c.phone) && setContact(i, { phone: fmtPhone(c.phone) })}
                  placeholder="(49) 99999-0000"
                  className={c.phone && !phoneOk(c.phone) ? 'border-red-300' : undefined}
                />
                <IconButton icon={Trash2} label="Remover contato" tone="danger" disabled={f.contacts.length === 1} onClick={() => set('contacts', f.contacts.filter((_, j) => j !== i))} />
              </div>
            ))}
          </div>
          {f.contacts.length < 5 && (
            <button type="button" onClick={() => set('contacts', [...f.contacts, blankContact()])} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800">
              <Plus className="size-4" /> Adicionar outro contato
            </button>
          )}
        </div>

        <Field label="Descrição do serviço">
          <Textarea rows={4} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="O que precisa ser feito, sintomas relatados, materiais a levar…" />
        </Field>
        {reassigning && <Notice>A ordem está em andamento: ao trocar o técnico, o cronômetro atual é encerrado e a ordem fica pausada para o novo responsável.</Notice>}
      </div>
    </Modal>
  );
}
