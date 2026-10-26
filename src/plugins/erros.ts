// Erros viram respostas { erro, mensagem } num único lugar. Se existe mais de uma voz, existe mais de um suspeito.

import { FastifyInstance } from 'fastify';
import { ehViolacaoDeReferencia, ErroApp } from '../errors';

/** Único lugar onde erro vira resposta: { erro, mensagem }. Uma só voz, para não parecer que há mais de um suspeito. */
export function registrarErros(app: FastifyInstance) {
  // Todo erro passa por aqui. Culpado conhecido (ErroApp)? Respondo com o status certo. Desconhecido? Não entrego nome nenhum.
  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({ erro: 'RotaNaoEncontrada', mensagem: `Rota ${req.method} ${req.url} não existe.` }),
  );

  app.setErrorHandler((err, req, reply) => {
    const e = err as Error & { statusCode?: number; validation?: unknown; code?: string };
    if (e.validation) return reply.status(400).send({ erro: 'ErroValidacao', mensagem: e.message });
    if (e instanceof ErroApp) return reply.status(e.status).send({ erro: e.tipo, mensagem: e.message });
    // restrições do banco: a última barreira. Se passou por tudo, o banco ainda pode dizer não
    if (e.code === 'P2002') return reply.status(409).send({ erro: 'Conflito', mensagem: 'Registro duplicado (restrição de unicidade).' });
    if (ehViolacaoDeReferencia(e)) return reply.status(409).send({ erro: 'Conflito', mensagem: 'Operação viola uma relação entre registros.' });
    if (e.code === 'P2025') return reply.status(404).send({ erro: 'NaoEncontrado', mensagem: 'Registro não encontrado.' });
    if (/violates check constraint|e imutavel/.test(e.message ?? '')) {
      return reply.status(409).send({ erro: 'Conflito', mensagem: 'Operação rejeitada por uma restrição de integridade do banco.' });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ erro: 'RequisicaoInvalida', mensagem: e.message });
    }
    req.log.error(err);
    return reply.status(500).send({ erro: 'ErroInterno', mensagem: 'Erro interno do servidor.' });
  });
}
