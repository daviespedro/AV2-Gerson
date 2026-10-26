// Só o admin mexe em usuários. Operador querendo espiar a lista? Educadamente: 403.

import { FastifyInstance } from 'fastify';
import { Papel } from '@prisma/client';
import { PAPEIS } from '../../dominio/papeis';
import { permitir } from '../../plugins/auth';
import { campoVersao, lerPagina, paginar, queryLista, schemaExclusao, schemaId } from '../../shared/http';
import { usuarioService } from './usuario.service';

type Id = { Params: { id: string } };
const apenasAdmin = permitir('admin');
const corpo = (required: string[], properties: Record<string, unknown>) => ({
  type: 'object',
  required,
  additionalProperties: false,
  properties: { ...properties, versao: campoVersao },
});

export async function usuarioController(app: FastifyInstance) {
  const tags = ['usuarios'];

  app.post<{ Body: { username: string; senha: string; papel: Papel } }>(
    '/usuarios',
    {
      onRequest: apenasAdmin,
      schema: {
        tags,
        body: {
          type: 'object',
          required: ['username', 'senha', 'papel'],
          additionalProperties: false,
          properties: { username: { type: 'string' }, senha: { type: 'string' }, papel: { type: 'string', enum: PAPEIS } },
        },
      },
    },
    async (req, reply) => reply.code(201).send(await usuarioService.criar(req.ator, req.body.username, req.body.senha, req.body.papel)),
  );

  app.get<{ Querystring: { pagina?: number; tamanhoPagina?: number } }>(
    '/usuarios',
    { onRequest: apenasAdmin, schema: { tags, querystring: queryLista() } },
    async (req) => {
      const p = lerPagina(req.query);
      return paginar(await usuarioService.listar(p), p);
    },
  );

  app.patch<Id & { Body: { username: string; versao?: number } }>(
    '/usuarios/:id/username',
    { onRequest: apenasAdmin, schema: { tags, summary: 'Renomeia um usuário', params: schemaId, body: corpo(['username'], { username: { type: 'string' } }) } },
    (req) => usuarioService.renomear(req.ator, req.params.id, req.body.username, req.body.versao),
  );

  app.patch<Id & { Body: { papel: Papel; versao?: number } }>(
    '/usuarios/:id/papel',
    { onRequest: apenasAdmin, schema: { tags, summary: 'Altera o papel de outro usuário', params: schemaId, body: corpo(['papel'], { papel: { type: 'string', enum: PAPEIS } }) } },
    (req) => usuarioService.alterarPapel(req.ator, req.params.id, req.body.papel, req.body.versao),
  );

  app.patch<Id & { Body: { novaSenha: string; versao?: number } }>(
    '/usuarios/:id/senha',
    { onRequest: apenasAdmin, schema: { tags, summary: 'Admin redefine a senha de outro usuário', params: schemaId, body: corpo(['novaSenha'], { novaSenha: { type: 'string' } }) } },
    async (req, reply) => {
      await usuarioService.redefinirSenha(req.ator, req.params.id, req.body.novaSenha, req.body.versao);
      return reply.code(204).send();
    },
  );

  app.patch<Id & { Body: { ativo: boolean; versao?: number } }>(
    '/usuarios/:id/ativo',
    { onRequest: apenasAdmin, schema: { tags, summary: 'Ativa ou desativa um usuário', params: schemaId, body: corpo(['ativo'], { ativo: { type: 'boolean' } }) } },
    (req) => usuarioService.definirAtivo(req.ator, req.params.id, req.body.ativo, req.body.versao),
  );

  app.delete<Id & { Querystring: { permanente?: boolean; versao?: number } }>(
    '/usuarios/:id',
    { onRequest: apenasAdmin, schema: { tags, summary: 'Desativa (soft) ou, com permanente=true, exclui de vez (só sem histórico)', params: schemaId, querystring: schemaExclusao } },
    async (req, reply) => {
      await usuarioService.remover(req.ator, req.params.id, req.query.permanente ?? false, req.query.versao);
      return reply.code(204).send();
    },
  );
}
