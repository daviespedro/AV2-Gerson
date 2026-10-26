// Parâmetros globais (como a alíquota de ICMS): só o admin lê e escreve.

import { FastifyInstance } from 'fastify';
import { permitir } from '../../plugins/auth';
import { campoVersao } from '../../shared/http';
import { parametroService } from './parametro.service';

export async function parametroController(app: FastifyInstance) {
  const base = { onRequest: permitir('admin') };
  const tags = ['config'];
  const chave = { type: 'object', required: ['chave'], properties: { chave: { type: 'string' } } };

  app.get('/config', { ...base, schema: { tags, summary: 'Lista os parâmetros globais' } }, () => parametroService.listar());
  app.get<{ Params: { chave: string } }>('/config/:chave', { ...base, schema: { tags, params: chave } }, (req) => parametroService.obter(req.params.chave));

  app.put<{ Params: { chave: string }; Body: { valor: string; versao?: number } }>(
    '/config/:chave',
    {
      ...base,
      schema: {
        tags,
        summary: 'Cria ou atualiza um parâmetro global (ex.: aliquota_icms)',
        params: chave,
        body: { type: 'object', required: ['valor'], additionalProperties: false, properties: { valor: { type: 'string' }, versao: campoVersao } },
      },
    },
    (req) => parametroService.definir(req.ator, req.params.chave, req.body.valor, req.body.versao),
  );

  app.delete<{ Params: { chave: string } }>('/config/:chave', { ...base, schema: { tags, params: chave } }, async (req, reply) => {
    await parametroService.excluir(req.ator, req.params.chave);
    return reply.code(204).send();
  });
}
