import type { Permission } from '../auth/permissions.js';
import type { RosClient, RosErrorKind, RosRecord } from '../routeros/types.js';

export interface SectionDef {
  key: string;
  label: string;
  path: string;
  /** Menus de item único (ex.: /system/resource) retornam um objeto. */
  single?: boolean;
  /** Versão mínima do RouterOS; abaixo dela a seção é marcada como indisponível sem consultar. */
  minVersion?: string;
  /** Versão máxima (exclusiva), para menus que mudaram de lugar no v7. */
  beforeVersion?: string;
  /** Pacote/recurso que costuma ser exigido, usado na mensagem de indisponibilidade. */
  requires?: string;
  /** Pós-processamento opcional das linhas. */
  transform?: (rows: RosRecord[]) => RosRecord[];
}

export type SectionResult =
  | { ok: true; rows: RosRecord[]; single?: boolean }
  | { ok: false; reason: string; kind: RosErrorKind | 'version' };

export interface ModuleData {
  sections: Record<string, SectionResult>;
}

export interface QueryModule {
  key: string;
  label: string;
  permission: Permission;
  /** Validade do cache, em segundos. */
  ttlSec: number;
  sections: SectionDef[];
  /** Coleta customizada (opcional); por padrão consulta cada seção. */
  fetch?: (c: RosClient, version: string | null) => Promise<ModuleData>;
}
