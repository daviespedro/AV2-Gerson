// Usuários no banco. A senha só existe aqui embrulhada em hash, e nem assim sai pela API.

import { Papel, Usuario } from '@prisma/client';
import { Db } from '../../db';
import { exigirVersao } from '../../shared/versao';

/** O que a plateia pode ver do usuário. O senhaHash fica nos bastidores, sempre. */
export const paraPublico = (u: Usuario) => ({
  id: u.id,
  username: u.username,
  papel: u.papel,
  ativo: u.ativo,
  versao: u.versao,
  criadoEm: u.criadoEm,
});

export const usuarioRepo = {
  contar: (db: Db) => db.usuario.count(),
  porId: (db: Db, id: string) => db.usuario.findUnique({ where: { id } }),
  porUsername: (db: Db, username: string) => db.usuario.findUnique({ where: { username } }),
  criar: (db: Db, d: { username: string; senhaHash: string; papel: Papel }) => db.usuario.create({ data: d }),

  async listar(db: Db, skip: number, take: number) {
    const [itens, total] = await Promise.all([db.usuario.findMany({ orderBy: { username: 'asc' }, skip, take }), db.usuario.count()]);
    return { itens: itens.map(paraPublico), total };
  },

  async atualizar(db: Db, id: string, versao: number, dados: { username?: string; papel?: Papel; ativo?: boolean; senhaHash?: string }) {
    const r = await db.usuario.updateMany({
      where: { id, versao },
      data: { ...dados, versao: { increment: 1 }, atualizadoEm: new Date() },
    });
    exigirVersao(r.count, 'O usuário');
    return db.usuario.findUniqueOrThrow({ where: { id } });
  },

  excluir: (db: Db, id: string) => db.usuario.delete({ where: { id } }),
};
