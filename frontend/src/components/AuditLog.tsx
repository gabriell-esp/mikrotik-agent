import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { get } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { Badge, Card, Empty, ErrorBox, Field, Input, Modal, Pagination, SearchBox, Select, TableSkeleton } from './ui';

export const ACTION_LABEL: Record<string, string> = {
  'auth.login': 'Login', 'auth.logout': 'Logout', 'auth.change_password': 'Troca de senha própria',
  'user.create': 'Usuário criado', 'user.update': 'Usuário alterado', 'user.reset_password': 'Senha de usuário redefinida', 'user.unlock': 'Usuário desbloqueado',
  'client.create': 'Cliente criado', 'client.update': 'Cliente alterado', 'client.delete': 'Cliente excluído',
  'device.create': 'Equipamento cadastrado', 'device.update': 'Equipamento alterado', 'device.delete': 'Equipamento excluído',
  'wireguard.link': 'Peer vinculado', 'wireguard.unlink': 'Peer desvinculado', 'monitor.firewall.view': 'Consulta de firewall',
  'pppoe.secret.create': 'PPPoE criado', 'pppoe.secret.update': 'PPPoE alterado', 'pppoe.secret.enable': 'PPPoE habilitado',
  'pppoe.secret.disable': 'PPPoE desabilitado', 'pppoe.secret.delete': 'PPPoE excluído', 'pppoe.session.disconnect': 'Sessão PPPoE desconectada',
  'pppoe.password.view': 'Senha PPPoE visualizada',
  'notifications.settings': 'Configuração de notificações', 'notifications.whatsapp.start': 'WhatsApp conectado',
  'notifications.whatsapp.logout': 'WhatsApp desconectado', 'notifications.test': 'Mensagem de teste',
  'notifications.recipient.create': 'Destinatário criado', 'notifications.recipient.update': 'Destinatário alterado',
  'notifications.recipient.delete': 'Destinatário removido',
};

const FIELD_LABEL: Record<string, string> = {
  comment: 'Comentário', profile: 'Perfil', service: 'Serviço', disabled: 'Desabilitado', local_address: 'IP local', remote_address: 'IP remoto',
  'local-address': 'IP local', 'remote-address': 'IP remoto', 'caller-id': 'MAC', caller_id: 'MAC', name: 'Usuário', pw_changed: 'Senha alterada',
  address: 'Endereço', uptime: 'Tempo conectado', disconnected: 'Sessões derrubadas', erro: 'Erro', username: 'Login', role: 'Perfil',
  api_method: 'Método de acesso', is_central: 'Central', host_changed: 'Endereço alterado', password_changed: 'Senha alterada',
  public_key: 'Chave pública', previous_device_id: 'Equipamento anterior', events: 'Eventos', client_ids: 'Clientes', enabled: 'Ativo', target: 'Destino',
};
const fmtVal = (v: unknown) => (v === true ? 'sim' : v === false ? 'não' : v === '' || v == null ? '∅' : String(v));

export const actionLabel = (a: string) => ACTION_LABEL[a] ?? a;

const tone = (a: string): 'red' | 'amber' | 'green' | 'blue' | 'slate' =>
  a.endsWith('.delete') || a.endsWith('disconnect') ? 'red'
  : a.includes('password') ? 'amber'
  : a.endsWith('.create') || a.endsWith('.enable') ? 'green'
  : a.startsWith('auth.') ? 'slate'
  : 'blue';

/** Detalhes do registro em pares chave/valor (diferenças "de → para" quando houver). */
function Details({ details }: { details: Record<string, any> | null }) {
  if (!details) return <span className="text-slate-400">—</span>;
  return (
    <dl className="space-y-1 text-xs">
      {Object.entries(details).map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <dt className="shrink-0 font-medium text-slate-500">{FIELD_LABEL[k] ?? k}:</dt>
          <dd className="min-w-0 break-words text-slate-700">
            {v && typeof v === 'object' && 'de' in v ? <><s className="text-slate-400">{fmtVal(v.de)}</s> → {fmtVal(v.para)}</> : Array.isArray(v) ? v.join(', ') || '∅' : typeof v === 'object' ? JSON.stringify(v) : fmtVal(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Histórico de auditoria filtrado por escopo (um equipamento, sistema ou removidos). */
export default function AuditLog({ deviceId, scope, showDevice }: { deviceId?: number; scope?: 'system' | 'removed'; showDevice?: boolean }) {
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<any>(null);
  useEffect(() => setPage(1), [search, action, from, to]);
  const base = { device_id: deviceId, scope };
  const actions = useQuery({ queryKey: ['audit-actions', deviceId, scope], queryFn: () => get('/audit/actions', base) });
  const q = useQuery({
    queryKey: ['audit', deviceId, scope, search, action, from, to, page],
    queryFn: () => get('/audit', {
      ...base, search, action, page, page_size: 50,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(to).toISOString() : undefined,
    }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Busca"><SearchBox value={search} onChange={setSearch} placeholder="Usuário ou alvo (ex.: apto, login)" /></Field>
          <Field label="Ação">
            <Select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">Todas</option>
              {(actions.data ?? []).map((a: string) => <option key={a} value={a}>{actionLabel(a)}</option>)}
            </Select>
          </Field>
          <Field label="De"><Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Até"><Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
      </Card>
      <Card bodyClass="" title={q.data ? `${q.data.total} registro(s)` : 'Registros'} subtitle="Senhas nunca são registradas.">
        {q.isLoading ? <TableSkeleton cols={5} /> : q.error ? <div className="p-4"><ErrorBox error={q.error} /></div> : !q.data.rows.length ? <Empty>Nenhum registro.</Empty> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr><th>Quando</th><th>Usuário</th><th>Ação</th>{showDevice && <th>Equipamento</th>}<th>Alvo</th><th>Detalhes</th><th>IP</th></tr>
              </thead>
              <tbody>
                {q.data.rows.map((r: any) => (
                  <tr key={r.id} className="cursor-pointer" onClick={() => setOpen(r)}>
                    <td className="whitespace-nowrap text-xs">{fmtDateTime(r.at)}</td>
                    <td className="font-medium text-slate-800">{r.username ?? '—'}</td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge color={tone(r.action)}>{actionLabel(r.action)}</Badge>
                        {!r.success && <Badge color="red" dot>falhou</Badge>}
                      </div>
                    </td>
                    {showDevice && <td className="text-xs">{r.device_name ?? '—'}{r.client_name && <div className="text-slate-500">{r.client_name}</div>}</td>}
                    <td className="text-xs">{r.target ?? '—'}</td>
                    <td className="min-w-[260px] max-w-md"><Details details={r.details} /></td>
                    <td className="mono text-slate-500">{r.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={q.data.page} pageSize={q.data.page_size} total={q.data.total} onPage={setPage} />
          </div>
        )}
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? actionLabel(open.action) : ''} description={open && `${fmtDateTime(open.at)} · ${open.username ?? '—'} · IP ${open.ip ?? '—'}`}>
        {open && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><div className="text-xs text-slate-500">Equipamento</div>{open.device_name ?? '—'}</div>
              <div><div className="text-xs text-slate-500">Cliente</div>{open.client_name ?? '—'}</div>
              <div><div className="text-xs text-slate-500">Alvo</div>{open.target ?? '—'}</div>
              <div><div className="text-xs text-slate-500">Resultado</div>{open.success ? 'Concluído' : 'Falhou'}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3"><Details details={open.details} /></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
