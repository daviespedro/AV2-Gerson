// Segurança da casa: confere o crachá (JWT), confirma no banco se a pessoa ainda existe e olha o papel dela.
// O auditor só observa; o admin entra em toda sala.

import { FastifyInstance, FastifyRequest } from 'fastify';
import jwt from '@fastify/jwt';
import { Papel } from '../dominio/papeis';
import { erroNaoAutenticado, erroPermissao } from '../errors';
import { Ator } from '../shared/ator';
import { authService } from '../modules/auth/auth.service';

export interface PayloadJwt {
  sub: string;
  username: string;
  papel: Papel;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: PayloadJwt;
    user: PayloadJwt;
  }
}
declare module 'fastify' {
  interface FastifyRequest {
    ator: Ator;
  }
  interface FastifyContextConfig {
    publica?: boolean; // dispensa o crachá: a porta da frente (login, provisionar, health)
    auditorPodeEscrever?: boolean; // a única exceção do auditor: trocar a própria senha. Até espião tem direito a segurança
  }
}

const LEITURA = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Eu leio o crachá (JWT) e depois confirmo no banco se a pessoa ainda existe: desativar a conta ou trocar o papel
 * vale na hora, sem esperar o token expirar. O auditor é somente leitura em qualquer rota.
 */
export async function registrarAuth(app: FastifyInstance, jwtSecret: string, expiresIn: string) {
  // Easter egg nº 5: a cada requisição eu confiro o crachá E o banco. Confiar só no crachá é acreditar em médium de bar.
  await app.register(jwt, { secret: jwtSecret, sign: { expiresIn } });
  app.decorateRequest('ator', null as unknown as Ator);

  app.addHook('onRequest', async (req: FastifyRequest) => {
    if (req.routeOptions.config?.publica || req.url.startsWith('/docs')) return;
    try {
      await req.jwtVerify();
    } catch {
      throw erroNaoAutenticado('Token ausente, inválido ou expirado.');
    }
    req.ator = await authService.obterAtor(req.user.sub);
    if (req.ator.papel === 'auditor' && !LEITURA.has(req.method) && !req.routeOptions.config?.auditorPodeEscrever) {
      throw erroPermissao("O papel 'auditor' tem acesso somente leitura.");
    }
  });
}

/** Segurança da porta: só os papéis listados passam. Roda antes de validar o corpo (sem permissão, sempre 403, sem pista sobre o formato). */
export const permitir = (...papeis: Papel[]) => async (req: FastifyRequest) => {
  // O admin entra em qualquer sala; os demais, só se o nome estiver na lista.
  if (!papeis.includes(req.ator.papel)) throw erroPermissao(`O papel '${req.ator.papel}' não tem permissão para esta operação.`);
};
