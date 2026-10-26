// A tabela de lotes e seus dois truques: trancar a linha (FOR UPDATE) e reservar posições sem ninguém furar a fila.

import { StatusLote } from '@prisma/client';
import { Db } from '../../db';
import { exigirVersao } from '../../shared/versao';

const org = { organizacao: { select: { id: true, cnpj: true, razaoSocial: true, ativo: true } } } as const;

export const loteRepo = {
  criar: (db: Db, d: { organizacaoId: string; nf: string; transportadora: string; dataEntrada: Date; criadoPorId: string }) =>
    db.lote.create({ data: d }),
  porId: (db: Db, id: string) => db.lote.findUnique({ where: { id }, include: org }),
  detalhado: (db: Db, id: string) =>
    db.lote.findUnique({ where: { id }, include: { ...org, equipamentos: { orderBy: { posicao: 'asc' } } } }),

  async listar(db: Db, skip: number, take: number, f: { status?: StatusLote; cnpj?: string; incluirInativos: boolean }) {
    const where = {
      ...(f.incluirInativos ? {} : { ativo: true }),
      status: f.status,
      organizacao: f.cnpj ? { cnpj: f.cnpj } : undefined,
    };
    const [itens, total] = await Promise.all([
      db.lote.findMany({ where, include: org, orderBy: { criadoEm: 'desc' }, skip, take }),
      db.lote.count({ where }),
    ]);
    return { itens, total };
  },

  async atualizar(db: Db, id: string, versao: number, d: { nf?: string; transportadora?: string; dataEntrada?: Date; status?: StatusLote }) {
    const r = await db.lote.updateMany({ where: { id, versao }, data: { ...d, versao: { increment: 1 }, atualizadoEm: new Date() } });
    exigirVersao(r.count, 'O lote');
    return db.lote.findUniqueOrThrow({ where: { id }, include: org });
  },

  async definirAtivo(db: Db, id: string, versao: number, ativo: boolean, inativadoEm: Date | null) {
    const r = await db.lote.updateMany({ where: { id, versao }, data: { ativo, inativadoEm, versao: { increment: 1 }, atualizadoEm: new Date() } });
    exigirVersao(r.count, 'O lote');
    return db.lote.findUniqueOrThrow({ where: { id }, include: org });
  },

  /** Tranca a porta até o fim da transação: um de cada vez mexe nos equipamentos do mesmo lote. */
  bloquear: (db: Db, id: string) => db.$queryRaw`SELECT id FROM "Lote" WHERE id = ${id}::uuid FOR UPDATE`,

  /** Reserva `qtd` lugares na fila com incremento atômico (ninguém fura a fila). Devolve o primeiro. */
  async reservarPosicoes(db: Db, id: string, qtd: number) {
    // Número da fila: quem chega primeiro fica na frente. Ninguém fura, nem com um bom sorriso.
    const l = await db.lote.update({ where: { id }, data: { proximaPosicao: { increment: qtd } }, select: { proximaPosicao: true } });
    return l.proximaPosicao - qtd;
  },

  excluir: (db: Db, id: string) => db.lote.delete({ where: { id } }), // quem cai junto: equipamentos e movimentações (em cascata, sem testemunhas)
};
