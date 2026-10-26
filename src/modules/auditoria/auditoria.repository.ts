// O caderninho de anotações: quem fez o quê e quando. Gravado na mesma transação da ação,
// então ninguém reescreve a história depois (e o banco tem um trigger para garantir).

import { Prisma } from '@prisma/client';
import { Db } from '../../db';

export const auditoriaRepo = {
  registrar: (db: Db, usuarioId: string | null, acao: string, detalhes?: Prisma.InputJsonValue) =>
    db.auditoria.create({ data: { usuarioId, acao, detalhes } }),

  async listar(db: Db, skip: number, take: number, acao?: string) {
    const where = acao ? { acao } : {};
    const [itens, total] = await Promise.all([
      db.auditoria.findMany({ where, orderBy: { id: 'desc' }, skip, take }),
      db.auditoria.count({ where }),
    ]);
    return { itens: itens.map((a) => ({ ...a, id: a.id.toString() })), total }; // BigInt não sabe virar JSON; viro texto, como quem transforma um segredo em recado
  },
};
