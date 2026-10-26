// A tabela de parâmetros: poucas linhas, muita responsabilidade, versão a cada mudança.

import { Db } from '../../db';
import { exigirVersao } from '../../shared/versao';

export const parametroRepo = {
  listar: (db: Db) => db.parametroGlobal.findMany({ orderBy: { chave: 'asc' } }),
  porChave: (db: Db, chave: string) => db.parametroGlobal.findUnique({ where: { chave } }),
  criar: (db: Db, chave: string, valor: string) => db.parametroGlobal.create({ data: { chave, valor } }),
  async atualizar(db: Db, chave: string, versao: number, valor: string) {
    const r = await db.parametroGlobal.updateMany({ where: { chave, versao }, data: { valor, versao: { increment: 1 }, atualizadoEm: new Date() } });
    exigirVersao(r.count, 'O parâmetro');
    return db.parametroGlobal.findUniqueOrThrow({ where: { chave } });
  },
  excluir: (db: Db, chave: string) => db.parametroGlobal.delete({ where: { chave } }),
};
