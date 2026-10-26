// Lotes chegam com nota fiscal, transportadora e, se quiserem, os equipamentos já na bagagem (tudo numa transação).
// O status do lote ninguém edita: ele é consequência do que acontece com os equipamentos.

import { FastifyInstance } from 'fastify';
import { StatusLote } from '@prisma/client';
import { permitir } from '../../plugins/auth';
import { campoVersao, incluirInativos, lerPagina, paginar, queryLista, schemaExclusao, schemaId, lerVersao } from '../../shared/http';
import { loteService } from './lote.service';

type Id = { Params: { id: string } };
const leitura = permitir('admin', 'cadastro', 'almoxarifado', 'auditor');
const escrita = permitir('admin', 'cadastro', 'almoxarifado');
const STATUS_LOTE = ['recebido', 'em_triagem', 'triagem_completa', 'encerrado'];
const data = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;

export async function loteController(app: FastifyInstance) {
  const tags = ['lotes'];

  app.post<{ Body: { orgCnpj: string; nf: string; transportadora: string; dataEntrada?: string; equipamentos?: { tipo: string }[] } }>(
    '/lotes',
    {
      onRequest: escrita,
      schema: {
        tags,
        summary: 'Cria um lote (e opcionalmente seus equipamentos) em uma única transação',
        body: {
          type: 'object',
          required: ['orgCnpj', 'nf', 'transportadora'],
          additionalProperties: false,
          properties: {
            orgCnpj: { type: 'string' },
            nf: { type: 'string' },
            transportadora: { type: 'string' },
            dataEntrada: data,
            // não preencha código de barras nem posição: o servidor gera os dois (barras = id; posição = ordem de chegada)
            equipamentos: {
              type: 'array',
              maxItems: 500,
              items: { type: 'object', required: ['tipo'], additionalProperties: false, properties: { tipo: { type: 'string', pattern: '\\S' } } },
            },
          },
        },
      },
    },
    async (req, reply) => reply.code(201).send(await loteService.criar(req.ator, req.body)),
  );

  app.get<{ Querystring: { pagina?: number; tamanhoPagina?: number; status?: StatusLote; cnpj?: string; incluirInativos?: boolean } }>(
    '/lotes',
    {
      onRequest: leitura,
      schema: { tags, querystring: queryLista({ status: { type: 'string', enum: STATUS_LOTE }, cnpj: { type: 'string' }, ...incluirInativos }) },
    },
    async (req) => {
      const p = lerPagina(req.query);
      const { status, cnpj } = req.query;
      return paginar(await loteService.listar(p, { status, cnpj, incluirInativos: req.query.incluirInativos ?? false }), p);
    },
  );

  app.get<Id>('/lotes/:id', { onRequest: leitura, schema: { tags, params: schemaId } }, (req) => loteService.obter(req.params.id));

  app.patch<Id & { Body: { nf?: string; transportadora?: string; dataEntrada?: string; versao?: number } }>(
    '/lotes/:id',
    {
      onRequest: escrita,
      schema: {
        tags,
        summary: 'Edita NF, transportadora ou data de entrada (o status é derivado e não é editável)',
        params: schemaId,
        body: { type: 'object', additionalProperties: false, properties: { nf: { type: 'string' }, transportadora: { type: 'string' }, dataEntrada: data, versao: campoVersao } },
      },
    },
    (req) => loteService.atualizar(req.ator, req.params.id, req.body),
  );

  app.delete<Id & { Querystring: { permanente?: boolean; versao?: number } }>(
    '/lotes/:id',
    {
      onRequest: escrita,
      schema: { tags, summary: 'Soft delete (equipamentos somem junto) ou, com permanente=true (admin), delete definitivo em cadeia', params: schemaId, querystring: schemaExclusao },
    },
    async (req, reply) => {
      if (req.query.permanente) {
        await loteService.excluir(req.ator, req.params.id);
        return reply.code(204).send();
      }
      return loteService.inativar(req.ator, req.params.id, req.query.versao);
    },
  );

  app.post<Id & { Body: unknown }>(
    '/lotes/:id/reativar',
    { onRequest: escrita, schema: { tags, params: schemaId } },
    (req) => loteService.reativar(req.ator, req.params.id, lerVersao(req.body)),
  );
}
