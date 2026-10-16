import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, PlugZap, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { get, post, put } from '../lib/api';
import { Button, Checkbox, ErrorBox, Field, Input, Modal, Notice, Select, Textarea, useToast } from './ui';

export interface DeviceFormInitial {
  id?: number;
  name?: string;
  client_id?: number | null;
  is_central?: boolean;
  host?: string;
  api_method?: string;
  api_ssl_port?: number;
  rest_port?: number;
  api_port?: number;
  allow_plaintext?: boolean;
  tls_fingerprint?: string | null;
  username?: string;
  notes?: string | null;
  poll_enabled?: boolean;
  wg_peer_id?: number;
}

const defaults = {
  name: '', client_id: null as number | null, is_central: false, host: '', api_method: 'auto', api_ssl_port: 8729, rest_port: 443,
  api_port: 8728, allow_plaintext: false, tls_fingerprint: '', username: '', password: '', notes: '', poll_enabled: true,
};

export default function DeviceForm({ open, onClose, initial, onSaved }: { open: boolean; onClose: () => void; initial?: DeviceFormInitial; onSaved?: (d: any) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => get('/clients'), enabled: open });
  const [f, setF] = useState({ ...defaults });
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<any>(null);
  const [advanced, setAdvanced] = useState(false);
  const editing = !!initial?.id;

  useEffect(() => {
    if (!open) return;
    setF({ ...defaults, ...Object.fromEntries(Object.entries(initial ?? {}).filter(([, v]) => v !== undefined && v !== null)), password: '' } as typeof defaults);
    setError(null);
    setTest(null);
    setAdvanced(false);
  }, [open, initial]);

  const set = <K extends keyof typeof defaults>(k: K, v: (typeof defaults)[K]) => setF((x) => ({ ...x, [k]: v }));
  const conn = () => ({
    host: f.host, api_method: f.api_method, api_ssl_port: Number(f.api_ssl_port), rest_port: Number(f.rest_port), api_port: Number(f.api_port),
    allow_plaintext: f.allow_plaintext, tls_fingerprint: f.tls_fingerprint || null, username: f.username,
  });

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await post('/devices/test', { ...conn(), password: f.password || undefined, device_id: initial?.id }));
    } catch (e) {
      setTest({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = { ...conn(), name: f.name, client_id: f.client_id, is_central: f.is_central, notes: f.notes, poll_enabled: f.poll_enabled,
        password: f.password || undefined, wg_peer_id: initial?.wg_peer_id };
      const saved = editing ? await put(`/devices/${initial!.id}`, body) : await post('/devices', body);
      toast.ok(editing ? 'Equipamento atualizado.' : 'Equipamento cadastrado.');
      qc.invalidateQueries({ queryKey: ['devices'] });
      qc.invalidateQueries({ queryKey: ['device'] });
      qc.invalidateQueries({ queryKey: ['wg-peers'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
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
      title={editing ? 'Editar equipamento' : 'Cadastrar equipamento'}
      footer={
        <>
          <Button onClick={runTest} loading={testing} disabled={!f.host || !f.username || (!f.password && !editing)}>
            <PlugZap className="size-4" /> Testar conexão
          </Button>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} loading={saving}>Salvar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBox error={error} title="Não foi possível salvar" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome">
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex.: RB Matriz Cliente X" />
          </Field>
          <Field label="Cliente">
            <Select value={f.client_id ?? ''} onChange={(e) => set('client_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">{f.is_central ? '— (central da Slot1)' : 'Selecione…'}</option>
              {(clients.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Endereço de gerência" hint="IP pelo túnel WireGuard (ou outro endereço alcançável pelo servidor).">
            <Input value={f.host} onChange={(e) => set('host', e.target.value.trim())} placeholder="10.200.0.2" className="mono" />
          </Field>
          <Field label="Método de acesso" hint="Automático: API-SSL → REST (HTTPS) → API sem TLS (se permitido).">
            <Select value={f.api_method} onChange={(e) => set('api_method', e.target.value)}>
              <option value="auto">Automático (recomendado)</option>
              <option value="api-ssl">API-SSL (8729) — v6 e v7</option>
              <option value="rest">REST HTTPS (443) — v7.1+</option>
              <option value="api">API sem TLS (8728)</option>
            </Select>
          </Field>
          <Field label="Usuário do roteador" hint="Crie um usuário dedicado com o grupo mínimo necessário.">
            <Input value={f.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Senha do roteador" hint={editing ? 'Deixe em branco para manter a senha atual.' : 'Armazenada criptografada; nunca é exibida.'}>
            <Input type="password" value={f.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
          </Field>
        </div>

        <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setAdvanced((v) => !v)}>
          {advanced ? 'Ocultar opções avançadas' : 'Mostrar opções avançadas (portas, TLS, coleta)'}
        </button>
        {advanced && (
          <div className="grid gap-3 rounded-md bg-slate-50 p-3 sm:grid-cols-3">
            <Field label="Porta API-SSL"><Input type="number" value={f.api_ssl_port} onChange={(e) => set('api_ssl_port', Number(e.target.value))} /></Field>
            <Field label="Porta REST (HTTPS)"><Input type="number" value={f.rest_port} onChange={(e) => set('rest_port', Number(e.target.value))} /></Field>
            <Field label="Porta API"><Input type="number" value={f.api_port} onChange={(e) => set('api_port', Number(e.target.value))} /></Field>
            <Field label="Fingerprint SHA-256 do certificado (opcional)" className="sm:col-span-3" hint="Se informado, a conexão só é aceita se o certificado do roteador conferir.">
              <Input value={f.tls_fingerprint ?? ''} onChange={(e) => set('tls_fingerprint', e.target.value)} className="mono" placeholder="AB:CD:…" />
            </Field>
            <div className="space-y-2 sm:col-span-3">
              <Checkbox label="Permitir API sem criptografia (porta 8728) — use somente dentro do túnel" checked={f.allow_plaintext} onChange={(v) => set('allow_plaintext', v)} />
              <Checkbox label="Incluir na coleta periódica" checked={f.poll_enabled} onChange={(v) => set('poll_enabled', v)} />
              <Checkbox label="Esta é a MikroTik central (concentradora WireGuard)" checked={f.is_central} onChange={(v) => set('is_central', v)} />
            </div>
          </div>
        )}

        <Field label="Observações">
          <Textarea rows={2} value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </Field>

        {test && (
          test.ok ? (
            <div className="flex gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <div>
                Conectado via <b>{test.method}</b> em {test.ms} ms — {test.identity} · RouterOS {test.version} · {test.board}
                {test.attempts?.length > 0 && <div className="text-xs">Tentativas anteriores: {test.attempts.map((a: any) => `${a.method}: ${a.error}`).join(' | ')}</div>}
              </div>
            </div>
          ) : (
            <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <XCircle className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 break-words">{test.message}</div>
            </div>
          )
        )}
        <Notice kind="info">O cadastro e o teste apenas leem informações. Nenhuma configuração do roteador é alterada.</Notice>
      </div>
    </Modal>
  );
}
