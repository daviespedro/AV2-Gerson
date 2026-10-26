// Aqui o Prisma conversa com a tabela de organizações. Sem regra de negócio: só perguntas e respostas.
// Toda atualização confere a versão; quem chegou depois perde o truque (409).

import { Db } from '../../db';
import { exigirVersao } from '../../shared/versao';

export const organizacaoRepo = {
  criar: (db: Db, d: { cnpj: string; razaoSocial: string; contato: string | null }) => db.organizacao.create({ data: d }),
  porId: (db: Db, id: string) => db.organizacao.findUnique({ where: { id } }),
  porCnpj: (db: Db, cnpj: string) => db.organizacao.findUnique({ where: { cnpj }, include: { contrato: true } }),

  async listar(db: Db, skip: number, take: number, incluirInativos: boolean) {
    const where = incluirInativos ? {} : { ativo: true };
    const [itens, total] = await Promise.all([
      db.organizacao.findMany({ where, orderBy: { razaoSocial: 'asc' }, skip, take }),
      db.organizacao.count({ where }),
    ]);
    return { itens, total };
  },

  async atualizar(db: Db, id: string, versao: number, d: { razaoSocial?: string; contato?: string | null }) {
    const r = await db.organizacao.updateMany({ where: { id, versao }, data: { ...d, versao: { increment: 1 }, atualizadoEm: new Date() } });
    exigirVersao(r.count, 'A organização');
    return db.organizacao.findUniqueOrThrow({ where: { id } });
  },

  async definirAtivo(db: Db, id: string, versao: number, ativo: boolean, inativadoEm: Date | null) {
    const r = await db.organizacao.updateMany({ where: { id, versao }, data: { ativo, inativadoEm, versao: { increment: 1 }, atualizadoEm: new Date() } });
    exigirVersao(r.count, 'A organização');
  },

  /** Inativa os lotes ativos da organização, todos com o MESMO carimbo: ao reativar, sei exatamente quais saíram junto. */
  async inativarLotes(db: Db, organizacaoId: string, quando: Date) {
    // Carimbo igual para todos: é assim que eu sei, depois, quem saiu junto.
    const r = await db.lote.updateMany({
      where: { organizacaoId, ativo: true },
      data: { ativo: false, inativadoEm: quando, versao: { increment: 1 }, atualizadoEm: quando },
    });
    return r.count;
  },

  async reativarLotes(db: Db, organizacaoId: string, quando: Date) {
    // Só reativa quem tem o MESMO carimbo. Eu tenho boa memória para horários.
    const r = await db.lote.updateMany({
      where: { organizacaoId, ativo: false, inativadoEm: quando },
      data: { ativo: true, inativadoEm: null, versao: { increment: 1 }, atualizadoEm: new Date() },
    });
    return r.count;
  },

  /** Delete permanente: contrato, lotes, equipamentos e movimentações saem em cascata (FK). Sem volta, sem bis. */
  excluir: (db: Db, id: string) => db.organizacao.delete({ where: { id } }),
};
