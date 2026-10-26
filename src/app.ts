// Aqui eu monto o palco: Fastify, Swagger, JWT e as rotas entram em cena, mas ninguém abre a porta ainda.
// Quem abre é o server.ts. Assim os testes assistem ao espetáculo inteiro sem vender ingresso (app.inject).

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { Config } from './config';
import { prisma } from './db';
import { registrarAuth } from './plugins/auth';
import { registrarErros } from './plugins/erros';
import { auditoriaController } from './modules/auditoria/auditoria.controller';
import { authController } from './modules/auth/auth.controller';
import { contratoController } from './modules/contrato/contrato.controller';
import { equipamentoController } from './modules/equipamento/equipamento.controller';
import { loteController } from './modules/lote/lote.controller';
import { organizacaoController } from './modules/organizacao/organizacao.controller';
import { parametroController } from './modules/parametro/parametro.controller';
import { usuarioController } from './modules/usuario/usuario.controller';

/** Monto o palco sem abrir as portas do teatro (dá para testar com app.inject). Rotas de negócio em /api/v1. */
export async function criarApp(config: Config): Promise<FastifyInstance> {
  // Easter egg nº 1: toda boa apresentação começa com uma xícara de chá. Aqui, com um Fastify bem configurado.
  // Ordem de entrada em cena: erros primeiro (para apanhar quem cair), depois CORS, Swagger e a segurança.
  const app = Fastify({
    logger: config.logLevel === 'silent' ? false : { level: config.logLevel },
    bodyLimit: 1024 * 1024,
    forceCloseConnections: 'idle', // conexão ociosa não vai segurar o encerramento: quem não está fazendo nada, sai primeiro
    // O Fastify, por padrão, joga fora em silêncio os campos que o schema não conhece (removeAdditional: true).
    // Eu prefiro uma recusa clara: campo estranho no corpo é 400, e ninguém descobre depois que "passou batido".
    ajv: { customOptions: { removeAdditional: false, coerceTypes: 'array', useDefaults: true, allErrors: false } },
  });

  registrarErros(app);
  await app.register(cors, { origin: config.cors });
  await app.register(swagger, {
    openapi: {
      info: { title: 'greencode API', description: 'Logística reversa de resíduos eletrônicos', version: '2.0.0' },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      security: [{ bearerAuth: [] }],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  await registrarAuth(app, config.jwtSecret, config.jwtExpira);

  await app.register(
    async (v1) => {
      for (const c of [authController, usuarioController, organizacaoController, contratoController, loteController, equipamentoController, parametroController, auditoriaController]) {
        await v1.register(c);
      }
    },
    { prefix: '/api/v1' },
  );

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
  return app;
}
