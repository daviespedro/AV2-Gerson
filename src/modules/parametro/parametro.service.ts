// Chaves simples, valores em texto, versão a cada alteração. Mexeu? Fica anotado na auditoria.

import { prisma, transacao } from '../../db';
import { erroConflito, erroNaoEncontrado, erroValidacao } from '../../errors';
import { Ator } from '../../shared/ator';
import { auditoriaRepo } from '../auditoria/auditoria.repository';
import { parametroRepo } from './parametro.repository';

const CHAVE_VALIDA = /^[A-Za-z0-9_.-]{1,64}$/;

export const parametroService = {
  listar: () => parametroRepo.listar(prisma),

  async obter(chave: string) {
    // Chave inexistente: 404. Nem tudo o que a gente procura está escondido; às vezes simplesmente não existe.
    const p = await parametroRepo.porChave(prisma, chave);
    if (!p) throw erroNaoEncontrado(`Parâmetro '${chave}' não definido.`);
    return p;
  },

  /** Upsert versionado: informou uma versão que já não é a verdadeira? 409. Eu sei quando trocaram o baralho. */
  definir(ator: Ator, chave: string, valor: string, versao?: number) {
    // Se a sua versão não é a atual, alguém trocou as cartas enquanto você olhava para o outro lado.
    if (!CHAVE_VALIDA.test(chave)) throw erroValidacao("A chave deve ter de 1 a 64 caracteres: letras, números, '_', '.' ou '-'.");
    return transacao(async (tx) => {
      const atual = await parametroRepo.porChave(tx, chave);
      let r;
      if (!atual) {
        if (versao !== undefined) throw erroConflito('O parâmetro não existe; omita a versão para criá-lo.');
        r = await parametroRepo.criar(tx, chave, valor);
      } else {
        r = await parametroRepo.atualizar(tx, chave, versao ?? atual.versao, valor);
      }
      await auditoriaRepo.registrar(tx, ator.id, 'PARAMETRO_ALTERADO', { chave, valor });
      return r;
    });
  },

  excluir(ator: Ator, chave: string) {
    return transacao(async (tx) => {
      if (!(await parametroRepo.porChave(tx, chave))) throw erroNaoEncontrado(`Parâmetro '${chave}' não definido.`);
      await parametroRepo.excluir(tx, chave);
      await auditoriaRepo.registrar(tx, ator.id, 'PARAMETRO_EXCLUIDO', { chave });
    });
  },
};
