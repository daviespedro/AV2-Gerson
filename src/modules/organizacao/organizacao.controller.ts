// As portas das organizações: cadastro e consulta pelo CNPJ (com máscara ou sem, eu enxergo através).
// Soft delete em cadeia por padrão; o delete permanente (?permanente=true) é só para o admin.

import { FastifyInstance } from 'fastify';
import { permitir } from '../../plugins/auth';
import { campoVersao, incluirInativos, lerPagina, paginar, queryLista, schemaExclusao, lerVersao } from '../../shared/http';
import { organizacaoService } from './organizacao.service';

type Cnpj = { Params: { cnpj: string } };
const leitura = permitir('admin', 'cadastro', 'auditor');
const escrita = permitir('admin', 'cadastro');
const params = { type: 'object', required: ['cnpj'], properties: { cnpj: { type: 'string' } } };

export async function organizacaoController(app: FastifyInstance) {
  const tags = ['organizacoes'];

  app.post<{ Body: { cnpj: string; razaoSocial: string; contato?: string } }>(
    '/organizacoes',
    {
      onRequest: escrita,
      schema: {
        tags,
        body: {
          type: 'object',
          required: ['cnpj', 'razaoSocial'],
          additionalProperties: false,
          properties: { cnpj: { type: 'string' }, razaoSocial: { type: 'string' }, contato: { type: 'string' } },
        },
      },
    },
    async (req, reply) => reply.code(201).send(await organizacaoService.criar(req.ator, req.body.cnpj, req.body.razaoSocial, req.body.contato)),
  );

  app.get<{ Querystring: { pagina?: number; tamanhoPagina?: number; incluirInativos?: boolean } }>(
    '/organizacoes',
    { onRequest: leitura, schema: { tags, querystring: queryLista(incluirInativos) } },
    async (req) => {
      const p = lerPagina(req.query);
      return paginar(await organizacaoService.listar(p, req.query.incluirInativos ?? false), p);
    },
  );

  app.get<Cnpj>('/organizacoes/:cnpj', { onRequest: leitura, schema: { tags, params } }, (req) => organizacaoService.obter(req.params.cnpj));

  app.patch<Cnpj & { Body: { razaoSocial?: string; contato?: string | null; versao?: number } }>(
    '/organizacoes/:cnpj',
    {
      onRequest: escrita,
      schema: {
        tags,
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { razaoSocial: { type: 'string' }, contato: { type: ['string', 'null'] }, versao: campoVersao },
        },
      },
    },
    (req) => organizacaoService.atualizar(req.ator, req.params.cnpj, req.body),
  );

  app.delete<Cnpj & { Querystring: { permanente?: boolean; versao?: number } }>(
    '/organizacoes/:cnpj',
    {
      onRequest: escrita,
      schema: { tags, summary: 'Soft delete em cadeia (organização + lotes) ou, com permanente=true (admin), delete definitivo em cadeia', params, querystring: schemaExclusao },
    },
    async (req, reply) => {
      if (req.query.permanente) {
        await organizacaoService.excluir(req.ator, req.params.cnpj);
        return reply.code(204).send();
      }
      return organizacaoService.inativar(req.ator, req.params.cnpj, req.query.versao);
    },
  );

  app.post<Cnpj & { Body: unknown }>(
    '/organizacoes/:cnpj/reativar',
    { onRequest: escrita, schema: { tags, summary: 'Reativa a organização e os lotes inativados junto com ela', params } },
    (req) => organizacaoService.reativar(req.ator, req.params.cnpj, lerVersao(req.body)),
  );
}
