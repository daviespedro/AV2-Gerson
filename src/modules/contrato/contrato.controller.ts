// Contratos: criar, consultar, encerrar, reativar e apagar. Cada organização tem no máximo um.
// Sem contrato ativo, nada de lote: é aqui que o cliente descobre isso.

import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { permitir } from '../../plugins/auth';
import { campoVersao, incluirInativos, lerPagina, paginar, queryLista, schemaId, lerVersao } from '../../shared/http';
import { contratoService } from './contrato.service';

type Id = { Params: { id: string } };
const leitura = permitir('admin', 'cadastro', 'auditor');
const escrita = permitir('admin', 'cadastro');
const frequencia = { type: 'integer', minimum: 1 } as const;

export async function contratoController(app: FastifyInstance) {
  const tags = ['contratos'];

  app.post<{ Body: { orgCnpj: string; dataInicio: string; frequenciaColetaDias: number; condicoes?: string; clausulas?: Prisma.InputJsonValue } }>(
    '/contratos',
    {
      onRequest: escrita,
      schema: {
        tags,
        body: {
          type: 'object',
          required: ['orgCnpj', 'dataInicio', 'frequenciaColetaDias'],
          additionalProperties: false,
          properties: {
            orgCnpj: { type: 'string' },
            dataInicio: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            frequenciaColetaDias: frequencia,
            condicoes: { type: 'string' },
            clausulas: {},
          },
        },
      },
    },
    async (req, reply) => reply.code(201).send(await contratoService.criar(req.ator, req.body)),
  );

  app.get<{ Querystring: { pagina?: number; tamanhoPagina?: number; incluirInativos?: boolean } }>(
    '/contratos',
    { onRequest: leitura, schema: { tags, querystring: queryLista(incluirInativos) } },
    async (req) => {
      const p = lerPagina(req.query);
      return paginar(await contratoService.listar(p, req.query.incluirInativos ?? false), p);
    },
  );

  app.get<Id>('/contratos/:id', { onRequest: leitura, schema: { tags, params: schemaId } }, (req) => contratoService.obter(req.params.id));

  app.patch<Id & { Body: { frequenciaColetaDias?: number; condicoes?: string | null; clausulas?: Prisma.InputJsonValue; versao?: number } }>(
    '/contratos/:id',
    {
      onRequest: escrita,
      schema: {
        tags,
        params: schemaId,
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { frequenciaColetaDias: frequencia, condicoes: { type: ['string', 'null'] }, clausulas: {}, versao: campoVersao },
        },
      },
    },
    (req) => contratoService.atualizar(req.ator, req.params.id, req.body),
  );

  app.post<Id & { Body: unknown }>(
    '/contratos/:id/encerrar',
    { onRequest: escrita, schema: { tags, params: schemaId } },
    (req) => contratoService.definirAtivo(req.ator, req.params.id, false, lerVersao(req.body)),
  );

  app.post<Id & { Body: unknown }>(
    '/contratos/:id/reativar',
    { onRequest: escrita, schema: { tags, summary: 'Reabre um contrato encerrado', params: schemaId } },
    (req) => contratoService.definirAtivo(req.ator, req.params.id, true, lerVersao(req.body)),
  );

  app.delete<Id>(
    '/contratos/:id',
    { onRequest: escrita, schema: { tags, summary: 'Delete definitivo (contrato não tem soft delete; use encerrar para inativar)', params: schemaId } },
    async (req, reply) => {
      await contratoService.excluir(req.ator, req.params.id);
      return reply.code(204).send();
    },
  );
}
