// Peças comuns das rotas: paginação, schemas reutilizáveis e a leitura do corpo opcional.

import { erroValidacao } from '../errors';

export interface Pagina {
  pagina: number;
  tamanhoPagina: number;
}

export const schemaId = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

export const campoVersao = { type: 'integer', minimum: 1, description: 'Versão lida pelo cliente (concorrência otimista).' } as const;

export const schemaExclusao = {
  type: 'object',
  properties: {
    permanente: { type: 'boolean', default: false, description: 'false = inativa (soft delete); true = apaga de vez (somente admin).' },
    versao: campoVersao,
  },
} as const;

export const incluirInativos = {
  incluirInativos: { type: 'boolean', default: false, description: 'Inclui registros inativados.' },
} as const;

export const queryLista = (extra: Record<string, unknown> = {}) => ({
  type: 'object',
  properties: {
    pagina: { type: 'integer', minimum: 1, default: 1 },
    tamanhoPagina: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    ...extra,
  },
});

export const lerPagina = (q: { pagina?: number; tamanhoPagina?: number }): Pagina => ({
  pagina: q.pagina ?? 1,
  tamanhoPagina: q.tamanhoPagina ?? 20,
});

export const skipTake = (p: Pagina) => ({ skip: (p.pagina - 1) * p.tamanhoPagina, take: p.tamanhoPagina });

export const paginar = <T>(r: { itens: T[]; total: number }, p: Pagina) => ({
  ...r,
  pagina: p.pagina,
  tamanhoPagina: p.tamanhoPagina,
  totalPaginas: Math.max(1, Math.ceil(r.total / p.tamanhoPagina)),
});

/** Corpo opcional `{ versao }` das ações (reativar, encerrar, triagem): sem corpo, `{}` ou `{ versao: N }`. Quem não diz nada, eu leio mesmo assim. */
export function lerVersao(body: unknown): number | undefined {
  // Corpo vazio, objeto vazio ou versão válida: eu aceito. Versão maluca: eu recuso.
  const v = (body as { versao?: unknown } | null | undefined)?.versao;
  if (v === undefined) return undefined;
  if (!Number.isInteger(v) || (v as number) < 1) throw erroValidacao('O campo versao deve ser um inteiro maior ou igual a 1.');
  return v as number;
}
