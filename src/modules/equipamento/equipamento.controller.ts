// Equipamentos: cadastro, triagem, status, estado físico, depreciação e rastreio.
// Código de barras e posição ninguém digita: o servidor cuida disso.

import { FastifyInstance } from 'fastify';
import { StatusEquipamento } from '@prisma/client';
import { STATUS_EQUIPAMENTO } from '../../dominio/equipamento';
import { permitir } from '../../plugins/auth';
import { campoVersao, lerPagina, paginar, queryLista, schemaId, lerVersao } from '../../shared/http';
import { equipamentoService } from './equipamento.service';

type Id = { Params: { id: string } };
const leitura = permitir('admin', 'almoxarifado', 'auditor');
const escrita = permitir('admin', 'almoxarifado');
const tipo = { type: 'string', pattern: '\\S', description: 'Tipo do equipamento (não pode ser vazio).' } as const;

export async function equipamentoController(app: FastifyInstance) {
  const tags = ['equipamentos'];

  app.post<{ Body: { loteId: string; tipo: string } }>(
    '/equipamentos',
    {
      onRequest: escrita,
      schema: {
        tags,
        summary: 'Cadastra um equipamento (código de barras = id; posição automática no lote)',
        body: { type: 'object', required: ['loteId', 'tipo'], additionalProperties: false, properties: { loteId: { type: 'string', format: 'uuid' }, tipo } },
      },
    },
    async (req, reply) => reply.code(201).send(await equipamentoService.cadastrar(req.ator, req.body.loteId, req.body.tipo)),
  );

  app.get<{ Querystring: { pagina?: number; tamanhoPagina?: number; loteId?: string; status?: StatusEquipamento } }>(
    '/equipamentos',
    {
      onRequest: leitura,
      schema: { tags, querystring: queryLista({ loteId: { type: 'string', format: 'uuid' }, status: { type: 'string', enum: STATUS_EQUIPAMENTO } }) },
    },
    async (req) => {
      const p = lerPagina(req.query);
      return paginar(await equipamentoService.listar(p, { loteId: req.query.loteId, status: req.query.status }), p);
    },
  );

  app.get<Id>('/equipamentos/:id', { onRequest: leitura, schema: { tags, params: schemaId } }, (req) => equipamentoService.obter(req.params.id));

  app.patch<Id & { Body: { tipo: string; versao?: number } }>(
    '/equipamentos/:id',
    {
      onRequest: escrita,
      schema: { tags, summary: 'Corrige o tipo do equipamento', params: schemaId, body: { type: 'object', required: ['tipo'], additionalProperties: false, properties: { tipo, versao: campoVersao } } },
    },
    (req) => equipamentoService.atualizarTipo(req.ator, req.params.id, req.body.tipo, req.body.versao),
  );

  app.delete<Id>(
    '/equipamentos/:id',
    { onRequest: escrita, schema: { tags, summary: 'Delete definitivo (equipamento não tem soft delete)', params: schemaId } },
    async (req, reply) => {
      await equipamentoService.excluir(req.ator, req.params.id);
      return reply.code(204).send();
    },
  );

  app.post<Id & { Body: unknown }>(
    '/equipamentos/:id/triagem',
    { onRequest: escrita, schema: { tags, params: schemaId } },
    (req) => equipamentoService.concluirTriagem(req.ator, req.params.id, lerVersao(req.body)),
  );

  app.patch<Id & { Body: { status: StatusEquipamento; versao?: number } }>(
    '/equipamentos/:id/status',
    {
      onRequest: escrita,
      schema: {
        tags,
        params: schemaId,
        body: { type: 'object', required: ['status'], additionalProperties: false, properties: { status: { type: 'string', enum: STATUS_EQUIPAMENTO }, versao: campoVersao } },
      },
    },
    (req) => equipamentoService.mover(req.ator, req.params.id, req.body.status, req.body.versao),
  );

  app.patch<Id & { Body: { estadoFisico: string; justificativa?: string; versao?: number } }>(
    '/equipamentos/:id/estado',
    {
      onRequest: escrita,
      schema: {
        tags,
        summary: 'Altera o estado físico (queda de 2+ categorias exige justificativa)',
        params: schemaId,
        body: { type: 'object', required: ['estadoFisico'], additionalProperties: false, properties: { estadoFisico: { type: 'string' }, justificativa: { type: 'string' }, versao: campoVersao } },
      },
    },
    (req) => equipamentoService.alterarEstado(req.ator, req.params.id, req.body.estadoFisico, req.body.justificativa, req.body.versao),
  );

  app.get<Id & { Querystring: { meses: number } }>(
    '/equipamentos/:id/depreciacao',
    {
      onRequest: leitura,
      schema: { tags, summary: 'Coeficiente de depreciação (curva própria de cada tipo)', params: schemaId, querystring: { type: 'object', required: ['meses'], properties: { meses: { type: 'number', minimum: 0 } } } },
    },
    (req) => equipamentoService.depreciacao(req.params.id, req.query.meses),
  );

  // rastreio: qualquer um com crachá válido pode ver por onde o equipamento andou
  app.get<Id>('/rastreio/:id', { schema: { tags: ['rastreio'], summary: 'Histórico de movimentações do equipamento', params: schemaId } }, (req) =>
    equipamentoService.rastreio(req.params.id),
  );
}
