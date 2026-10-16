import { z } from 'zod';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { stripSecrets } from '../modules/registry.js';
import { toBool } from '../routeros/parse.js';
import type { RosClient, RosRecord } from '../routeros/types.js';
import { patchSection } from './module-cache.js';

export const PPP_SERVICES = ['any', 'pppoe', 'pptp', 'l2tp', 'ovpn', 'sstp', 'async'] as const;

const ipv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const optIp = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => v || '')
  .refine((v) => v === '' || ipv4.test(v), 'Endereço IPv4 inválido');

export const rosIdSchema = z.string().regex(/^\*[0-9A-Fa-f]{1,8}$/, 'Identificador inválido');

export const pppUserName = z
  .string()
  .trim()
  .min(1, 'Informe o usuário')
  .max(64, 'Máximo de 64 caracteres')
  .regex(/^[^\s"'\\]+$/, 'O usuário não pode conter espaços, aspas ou barra invertida');

export const pppPassword = z
  .string()
  .min(1, 'Informe a senha')
  .max(64, 'Máximo de 64 caracteres')
  .regex(/^[\x20-\x7e]+$/, 'Use apenas caracteres ASCII imprimíveis (sem acentos)');

const common = {
  service: z.enum(PPP_SERVICES).default('pppoe'),
  profile: z.string().trim().min(1, 'Selecione o perfil').max(64),
  local_address: optIp,
  remote_address: optIp,
  caller_id: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => v || '')
    .refine((v) => v === '' || /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(v), 'MAC inválido (ex.: AA:BB:CC:DD:EE:FF)'),
  comment: z.string().trim().max(255, 'Máximo de 255 caracteres').optional().nullable().transform((v) => v || ''),
  disabled: z.boolean().default(false),
};

export const createSecretSchema = z.object({ name: pppUserName, password: pppPassword, ...common });
export const updateSecretSchema = z.object({
  expected_name: z.string().min(1),
  name: pppUserName,
  password: pppPassword.optional().or(z.literal('')).transform((v) => v || undefined),
  ...common,
});

export type CreateSecret = z.infer<typeof createSecretSchema>;
export type UpdateSecret = z.infer<typeof updateSecretSchema>;

const yesNo = (b: boolean) => (b ? 'yes' : 'no');

/** Busca um secret por nome e confere o .id, evitando agir sobre item trocado no roteador. */
export async function findSecret(c: RosClient, name: string, id?: string): Promise<RosRecord> {
  const rows = await c.print('/ppp/secret', { where: { name } });
  const row = id ? rows.find((r) => r['.id'] === id) : rows[0];
  if (!row) {
    throw notFound(
      id && rows.length
        ? 'O secret foi alterado no equipamento desde a última consulta. Atualize a lista e tente novamente.'
        : `Secret "${name}" não encontrado no equipamento.`,
    );
  }
  return row;
}

async function ensureProfile(c: RosClient, profile: string): Promise<void> {
  const profiles = await c.print('/ppp/profile');
  if (!profiles.some((p) => p.name === profile)) throw badRequest(`O perfil "${profile}" não existe neste equipamento.`);
}

function toRos(b: Omit<CreateSecret, 'name' | 'password'>): Record<string, string> {
  return {
    service: b.service,
    profile: b.profile,
    'local-address': b.local_address,
    'remote-address': b.remote_address,
    'caller-id': b.caller_id,
    comment: b.comment,
    disabled: yesNo(b.disabled),
  };
}

/** Relê secrets e sessões e atualiza o cache, para a interface refletir o estado real após a alteração. */
export async function refreshPppCache(c: RosClient, deviceId: number): Promise<void> {
  const [secrets, active] = await Promise.all([c.print('/ppp/secret'), c.print('/ppp/active')]);
  await patchSection(deviceId, 'ppp', 'secrets', { ok: true, rows: secrets.map(stripSecrets) });
  await patchSection(deviceId, 'ppp', 'active', { ok: true, rows: active.map(stripSecrets) });
}

export async function createSecret(c: RosClient, b: CreateSecret): Promise<string> {
  const dup = await c.print('/ppp/secret', { where: { name: b.name } });
  if (dup.length) throw conflict(`Já existe o usuário "${b.name}" neste equipamento.`);
  await ensureProfile(c, b.profile);
  const values: Record<string, string> = { name: b.name, password: b.password, ...toRos(b) };
  // Campos vazios não são enviados na criação (o RouterOS rejeita alguns valores vazios).
  for (const k of ['local-address', 'remote-address', 'caller-id', 'comment']) if (!values[k]) delete values[k];
  return c.add('/ppp/secret', values);
}

export async function updateSecret(c: RosClient, id: string, b: UpdateSecret): Promise<{ before: RosRecord; changed: string[] }> {
  const before = await findSecret(c, b.expected_name, id);
  if (b.name !== b.expected_name) {
    const dup = await c.print('/ppp/secret', { where: { name: b.name } });
    if (dup.some((r) => r['.id'] !== id)) throw conflict(`Já existe o usuário "${b.name}" neste equipamento.`);
  }
  if (b.profile !== before.profile) await ensureProfile(c, b.profile);
  const values: Record<string, string> = { name: b.name, ...toRos(b) };
  if (b.password) values.password = b.password;
  const changed = Object.keys(values).filter((k) => {
    if (k === 'password') return true;
    if (k === 'disabled') return toBool(before.disabled) !== (values.disabled === 'yes');
    return (before[k] ?? '') !== values[k];
  });
  const toSet: Record<string, string> = {};
  const toUnset: string[] = [];
  for (const k of changed) {
    if (values[k] === '') toUnset.push(k);
    else toSet[k] = values[k];
  }
  if (Object.keys(toSet).length) await c.set('/ppp/secret', id, toSet);
  for (const k of toUnset) {
    // Limpar campo: "unset" é o caminho suportado no v6 e v7; se falhar, tenta valor vazio.
    try {
      await c.command('/ppp/secret', 'unset', { '.id': id, 'value-name': k });
    } catch {
      await c.set('/ppp/secret', id, { [k]: '' });
    }
  }
  return { before: stripSecrets(before), changed };
}

/** Diferenças sem senha, para auditoria. */
export function diffForAudit(before: RosRecord, after: Record<string, string>, changed: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of changed) if (k !== 'password') out[k] = { de: before[k] ?? '', para: after[k] ?? '' };
  if (changed.includes('password')) out.pw_changed = true;
  return out;
}
