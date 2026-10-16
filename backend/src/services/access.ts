import type { FastifyRequest } from 'fastify';
import type { Permission } from '../auth/permissions.js';
import { canAccessDevice, requirePerm, type AuthUser } from '../auth/session.js';
import { forbidden } from '../lib/errors.js';
import { idParam, parse } from '../lib/validate.js';
import { getDeviceRow, type DeviceRow } from './devices.js';

/** Carrega o equipamento da rota verificando permissões funcionais e escopo de cliente. */
export async function deviceFromRequest(req: FastifyRequest, ...perms: Permission[]): Promise<{ user: AuthUser; device: DeviceRow }> {
  const user = requirePerm(req, ...perms);
  const { id } = parse(idParam, req.params);
  const device = await getDeviceRow(id);
  if (!canAccessDevice(user, device)) throw forbidden('Você não tem acesso a este equipamento.');
  return { user, device };
}
