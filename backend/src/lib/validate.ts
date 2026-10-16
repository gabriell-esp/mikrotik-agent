import { z, type ZodTypeAny } from 'zod';
import { badRequest } from './errors.js';

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const fields = r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    throw badRequest(fields.map((f) => (f.field ? `${f.field}: ${f.message}` : f.message)).join('; '), { fields });
  }
  return r.data;
}

export const idParam = z.object({ id: z.coerce.number().int().positive() });

const ipv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
export const ipv4Schema = z.string().regex(ipv4, 'IPv4 inválido');

/** Host de gerência: IPv4, IPv6 ou nome DNS simples. */
export const hostSchema = z
  .string()
  .trim()
  .min(1, 'Informe o endereço')
  .max(253)
  .regex(/^[A-Za-z0-9.:\-]+$/, 'Endereço inválido');

export const optionalText = (max: number) =>
  z.string().trim().max(max, `Máximo de ${max} caracteres`).optional().nullable().transform((v) => (v ? v : null));
