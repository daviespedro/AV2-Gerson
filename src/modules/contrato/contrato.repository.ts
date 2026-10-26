// Tabela de contratos, sem opinião: o Prisma pergunta, o banco responde. As regras moram no service.

import { Prisma } from '@prisma/client';
import { Db } from '../../db';
import { exigirVersao } from '../../shared/versao';

const comOrg = { organizacao: { select: { id: true, cnpj: true, razaoSocial: true, ativo: true } } } as const;

export const contratoRepo = {
  criar: (db: Db, d: { organizacaoId: string; dataInicio: Date; frequenciaColetaDias: number; condicoes: string | null; clausulas?: Prisma.InputJsonValue }) =>
    db.contrato.create({ data: d }),
  porId: (db: Db, id: string) => db.contrato.findUnique({ where: { id }, include: comOrg }),
  porOrganizacao: (db: Db, organizacaoId: string) => db.contrato.findUnique({ where: { organizacaoId } }),

  /** Contrato de organização inativa fica nos bastidores, a menos que peçam (incluirInativos). */
  async listar(db: Db, skip: number, take: number, incluirInativos: boolean) {
    const where = incluirInativos ? {} : { organizacao: { ativo: true } };
    const [itens, total] = await Promise.all([
      db.contrato.findMany({ where, include: comOrg, orderBy: { criadoEm: 'desc' }, skip, take }),
      db.contrato.count({ where }),
    ]);
    return { itens, total };
  },

  async atualizar(
    db: Db,
    id: string,
    versao: number,
    d: { frequenciaColetaDias?: number; condicoes?: string | null; clausulas?: Prisma.InputJsonValue; ativo?: boolean },
  ) {
    const r = await db.contrato.updateMany({ where: { id, versao }, data: { ...d, versao: { increment: 1 }, atualizadoEm: new Date() } });
    exigirVersao(r.count, 'O contrato');
    return db.contrato.findUniqueOrThrow({ where: { id }, include: comOrg });
  },

  excluir: (db: Db, id: string) => db.contrato.delete({ where: { id } }),
};
