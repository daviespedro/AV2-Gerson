// Quem pode ler o caderninho de auditoria: admin e auditor. O resto da plateia fica de fora, mas pode aplaudir.

import { FastifyInstance } from 'fastify';
import { prisma } from '../../db';
import { permitir } from '../../plugins/auth';
import { lerPagina, paginar, queryLista, skipTake } from '../../shared/http';
import { auditoriaRepo } from './auditoria.repository';

export async function auditoriaController(app: FastifyInstance) {
  // Só quem tem crachá de admin ou de auditor lê o caderninho. Curiosidade sem credencial é invasão.
  app.get<{ Querystring: { pagina?: number; tamanhoPagina?: number; acao?: string } }>(
    '/auditoria',
    {
      onRequest: permitir('admin', 'auditor'),
      schema: { tags: ['auditoria'], summary: 'Trilha de auditoria (equivale ao journal do CLI)', querystring: queryLista({ acao: { type: 'string' } }) },
    },
    async (req) => {
      const p = lerPagina(req.query);
      const { skip, take } = skipTake(p);
      return paginar(await auditoriaRepo.listar(prisma, skip, take, req.query.acao), p);
    },
  );
}
