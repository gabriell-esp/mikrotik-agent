import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, PlugZap, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Checkbox, ErrorBox, Field, Input, Modal, Notice, Select, Textarea, useToast } from './ui';

export interface UnifiInitial {
  id?: number;
  name?: string;
  client_id?: number | null;
  url?: string;
  auth_type?: 'password' | 'apikey';
  username?: string | null;
  tls_fingerprint?: string | null;
  notes?: string | null;
  poll_enabled?: boolean;
}

const empty = { name: '', client_id: null as number | null, url: '', auth_type: 'password' as 'password' | 'apikey', username: '', password: '', tls_fingerprint: '', notes: '', poll_enabled: true };

/** Cadastro/edição de controladora UniFi, com teste de conexão (somente leitura). */
export default function UnifiForm({ open, onClose, initial, onSaved }: { open: boolean; onClose: () => void; initial?: UnifiInitial; onSaved?: (c: any) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const clients = useQuery({ queryKey: ['clients'], queryFn: () => get('/clients'), enabled: open });
  const [f, setF] = useState({ ...empty });
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<any>(null);
  const editing = !!initial?.id;

  useEffect(() => {
    if (!open) return;
    setF({ ...empty, ...Object.fromEntries(Object.entries(initial ?? {}).filter(([, v]) => v != null)), password: '' } as typeof empty);
    setError(null);
    setTest(null);
  }, [open, initial]);

  const set = <K extends keyof typeof empty>(k: K, v: (typeof empty)[K]) => setF((x) => ({ ...x, [k]: v }));
  const apikey = f.auth_type === 'apikey';
  const authChanged = editing && (initial?.auth_type ?? 'password') !== f.auth_type;
  const conn = () => ({ url: f.url, auth_type: f.auth_type, username: apikey ? null : f.username, tls_fingerprint: f.tls_fingerprint || null });

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await post('/unifi/test', { ...conn(), password: f.password || undefined, controller_id: initial?.id }));
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
      const body = { ...conn(), name: f.name, client_id: f.client_id, notes: f.notes, poll_enabled: f.poll_enabled, password: f.password || undefined };
      const saved = editing ? await put(`/unifi/controllers/${initial!.id}`, body) : await post('/unifi/controllers', body);
      toast.ok(editing ? 'Controladora atualizada.' : 'Controladora cadastrada. A primeira leitura começa em instantes.');
      qc.invalidateQueries({ queryKey: ['unifi'] });
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
      title={editing ? 'Editar controladora UniFi' : 'Cadastrar controladora UniFi'}
      description="Cloud Key, UDM ou UniFi Network Application acessível pelo servidor (normalmente pelo túnel WireGuard)."
      footer={
        <>
          <Button onClick={runTest} loading={testing} disabled={!f.url || (!apikey && !f.username) || (!f.password && (!editing || authChanged))}>
            <PlugZap className="size-4" /> Testar
          </Button>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} loading={saving}>Salvar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBox error={error} title="Não foi possível salvar" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome">
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex.: Cloud Key Bloco A" />
          </Field>
          <Field label="Cliente / condomínio">
            <Select value={f.client_id ?? ''} onChange={(e) => set('client_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">{user?.allClients ? '— (sem cliente)' : 'Selecione…'}</option>
              {(clients.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Endereço da controladora" className="sm:col-span-2" hint="Cloud Key Gen2/UniFi OS: https://IP (porta 443). Controlador antigo: https://IP:8443.">
            <Input value={f.url} onChange={(e) => set('url', e.target.value.trim())} placeholder="https://10.200.0.5" className="mono" autoCapitalize="none" autoCorrect="off" />
          </Field>
          <Field label="Forma de acesso" className="sm:col-span-2">
            <div className="grid grid-cols-2 gap-2">
              {([['password', 'Usuário e senha', 'Todas as ações'], ['apikey', 'API key', 'API oficial · Network 9+']] as const).map(([k, l, d]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => set('auth_type', k)}
                  className={`rounded-xl border px-3 py-2 text-left transition ${f.auth_type === k ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                >
                  <span className="block text-sm font-medium text-slate-900">{l}</span>
                  <span className="block text-xs text-slate-500">{d}</span>
                </button>
              ))}
            </div>
          </Field>
          {!apikey && (
            <Field label="Usuário" hint="Usuário local da controladora, sem verificação em duas etapas.">
              <Input value={f.username ?? ''} onChange={(e) => set('username', e.target.value)} autoComplete="off" autoCapitalize="none" />
            </Field>
          )}
          <Field
            label={apikey ? 'API key' : 'Senha'}
            className={apikey ? 'sm:col-span-2' : undefined}
            hint={
              editing && !authChanged
                ? 'Deixe em branco para manter a atual.'
                : apikey
                  ? 'Crie em UniFi Network → Configurações → Control Plane → Integrações → Criar API Key. Armazenada criptografada; nunca é exibida.'
                  : 'Armazenada criptografada; nunca é exibida.'
            }
          >
            <Input type="password" value={f.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" className={apikey ? 'mono' : undefined} />
          </Field>
          <Field label="Fingerprint SHA-256 do certificado (opcional)" className="sm:col-span-2" hint="Se informado, a conexão só é aceita se o certificado da controladora conferir.">
            <Input value={f.tls_fingerprint ?? ''} onChange={(e) => set('tls_fingerprint', e.target.value)} className="mono" placeholder="AB:CD:…" />
          </Field>
          <Field label="Observações" className="sm:col-span-2">
            <Textarea rows={2} value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
          </Field>
          <Checkbox label="Incluir na leitura automática (a cada 60 s)" checked={f.poll_enabled} onChange={(v) => set('poll_enabled', v)} />
        </div>

        {test &&
          (test.ok ? (
            <div className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-sm text-emerald-900">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <div>
                Conectado em {test.ms} ms · {test.platform === 'unifios' ? 'UniFi OS' : 'controlador clássico'}{test.version ? ` · Network ${test.version}` : ''}
                <div className="text-xs">Sites: {test.sites.map((s: any) => s.desc).join(', ') || 'nenhum'}</div>
                {test.auth_type === 'apikey' && (
                  <div className="mt-1 text-xs">
                    Pela API key: reiniciar antenas{test.capabilities?.wlanToggle ? ', ativar/desativar redes Wi-Fi' : ''}. Localizar, atualizar firmware e bloquear clientes só com usuário e senha.
                    {!test.capabilities?.wlans && ' Redes Wi-Fi exigem UniFi Network 10 ou superior.'}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50/70 p-3 text-sm text-red-800">
              <XCircle className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 break-words">{test.message}</div>
            </div>
          ))}
        <Notice kind="info">O cadastro e o teste apenas leem informações. Nenhuma configuração da controladora é alterada.</Notice>
      </div>
    </Modal>
  );
}
