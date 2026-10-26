// Tabelas de equipamento e movimentação. A movimentação só entra (INSERT); depois, nem eu mexo.

import { EstadoFisico, Prisma, StatusEquipamento } from '@prisma/client';
import { Db } from '../../db';
import { exigirVersao } from '../../shared/versao';

export const equipamentoRepo = {
  /** O id gerado pelo servidor É o código de barras: um número, dois nomes. O CHECK no banco impede que alguém troque um pelo outro. */
  criar: (db: Db, d: { id: string; loteId: string; tipo: string; posicao: number }) =>
    db.equipamento.create({ data: { ...d, codigoBarrasInterno: d.id } }),

  /** Equipamento de lote inativo desaparece junto com o lote: ninguém vê o coelho se a cartola foi guardada. */
  porId: (db: Db, id: string) => db.equipamento.findFirst({ where: { id, lote: { ativo: true } } }),

  async listar(db: Db, skip: number, take: number, f: { loteId?: string; status?: StatusEquipamento }) {
    const where: Prisma.EquipamentoWhereInput = { lote: { ativo: true }, loteId: f.loteId, status: f.status };
    const [itens, total] = await Promise.all([
      db.equipamento.findMany({ where, orderBy: [{ loteId: 'asc' }, { posicao: 'asc' }], skip, take }),
      db.equipamento.count({ where }),
    ]);
    return { itens, total };
  },

  async statusDoLote(db: Db, loteId: string): Promise<StatusEquipamento[]> {
    return (await db.equipamento.findMany({ where: { loteId }, select: { status: true } })).map((e) => e.status);
  },

  async atualizar(
    db: Db,
    id: string,
    versao: number,
    d: { tipo?: string; status?: StatusEquipamento; estadoFisico?: EstadoFisico; triagemCompleta?: boolean },
  ) {
    const r = await db.equipamento.updateMany({ where: { id, versao }, data: { ...d, versao: { increment: 1 }, atualizadoEm: new Date() } });
    exigirVersao(r.count, 'O equipamento');
    return db.equipamento.findUniqueOrThrow({ where: { id } });
  },

  excluir: (db: Db, id: string) => db.equipamento.delete({ where: { id } }),
};

export const movimentacaoRepo = {
  registrar: (
    db: Db,
    d: {
      equipamentoId: string;
      usuarioId: string;
      statusDe?: StatusEquipamento;
      statusPara?: StatusEquipamento;
      estadoDe?: EstadoFisico;
      estadoPara?: EstadoFisico;
      justificativa: string | null;
    },
  ) => db.movimentacao.create({ data: d }),

  historico: (db: Db, equipamentoId: string) => db.movimentacao.findMany({ where: { equipamentoId }, orderBy: { criadoEm: 'asc' } }),
};
