export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'Sessão inválida ou expirada. Faça login novamente.') => new AppError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Você não tem permissão para esta operação.') => new AppError(403, 'forbidden', msg);
export const notFound = (msg = 'Registro não encontrado.') => new AppError(404, 'not_found', msg);
export const conflict = (msg: string) => new AppError(409, 'conflict', msg);
