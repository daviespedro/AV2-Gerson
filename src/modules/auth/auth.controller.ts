// A porta de quem quer um token: provisionar (o primeiro admin), login e troca da própria senha.
// Só o /health e estes endpoints dispensam o crachá.

import { FastifyInstance } from 'fastify';
import { authService } from './auth.service';

const credenciais = {
  type: 'object',
  required: ['username', 'senha'],
  additionalProperties: false,
  properties: { username: { type: 'string', minLength: 3 }, senha: { type: 'string', minLength: 1 } },
} as const;

export async function authController(app: FastifyInstance) {
  const tags = ['auth'];
  const assinar = (u: { id: string; username: string; papel: 'admin' | 'cadastro' | 'almoxarifado' | 'auditor' }) =>
    app.jwt.sign({ sub: u.id, username: u.username, papel: u.papel });

  app.get('/health', { config: { publica: true }, schema: { tags: ['sistema'] } }, async () => ({ status: 'ok', horario: new Date().toISOString() }));

  app.post<{ Body: { username: string; senha: string } }>(
    '/auth/provisionar',
    { config: { publica: true }, schema: { tags, summary: 'Cria o primeiro administrador (só com o banco sem usuários)', body: credenciais } },
    async (req, reply) => reply.code(201).send(await authService.provisionar(req.body.username, req.body.senha)),
  );

  app.post<{ Body: { username: string; senha: string } }>(
    '/auth/login',
    { config: { publica: true }, schema: { tags, summary: 'Autentica e devolve o JWT', body: credenciais } },
    async (req) => {
      const u = await authService.login(req.body.username, req.body.senha);
      return { token: assinar(u), usuario: u };
    },
  );

  app.get('/auth/me', { schema: { tags, summary: 'Dados do usuário autenticado' } }, (req) => authService.me(req.ator.id));

  app.post<{ Body: { senhaAtual: string; novaSenha: string } }>(
    '/auth/senha',
    {
      config: { auditorPodeEscrever: true },
      schema: {
        tags,
        summary: 'Altera a própria senha',
        body: { type: 'object', required: ['senhaAtual', 'novaSenha'], additionalProperties: false, properties: { senhaAtual: { type: 'string' }, novaSenha: { type: 'string' } } },
      },
    },
    async (req, reply) => {
      await authService.trocarPropriaSenha(req.ator, req.body.senhaAtual, req.body.novaSenha);
      return reply.code(204).send();
    },
  );
}
