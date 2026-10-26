// Gente é imprevisível; por isso as regras: ninguém se desativa, ninguém muda o próprio papel, ninguém se apaga.

import { Papel } from '@prisma/client';
import { Db, prisma, transacao } from '../../db';
import { validarSenhaForte, validarUsername } from '../../dominio/senha';
import { ehViolacaoDeReferencia, erroConflito, erroNaoEncontrado, erroPermissao, erroValidacao } from '../../errors';
import { gerarHash } from '../../shared/hash';
import { Ator } from '../../shared/ator';
import { Pagina, skipTake } from '../../shared/http';
import { versaoEfetiva } from '../../shared/versao';
import { auditoriaRepo } from '../auditoria/auditoria.repository';
import { paraPublico, usuarioRepo } from './usuario.repository';

async function carregar(tx: Db, id: string) {
  // Usuário inexistente? 404 e seguimos.
  const u = await usuarioRepo.porId(tx, id);
  if (!u) throw erroNaoEncontrado('Usuário não encontrado.');
  return u;
}

async function definirAtivo(ator: Ator, id: string, ativo: boolean, versao?: number) {
  // Desativar não é apagar: é pedir para esperar do lado de fora.
  return transacao(async (tx) => {
    const alvo = await carregar(tx, id);
    if (!ativo && alvo.id === ator.id) throw erroValidacao('Você não pode desativar a própria conta.');
    const u = await usuarioRepo.atualizar(tx, id, versaoEfetiva(versao, alvo.versao), { ativo });
    await auditoriaRepo.registrar(tx, ator.id, ativo ? 'USUARIO_REATIVADO' : 'USUARIO_DESATIVADO', { username: alvo.username });
    return paraPublico(u);
  });
}

export const usuarioService = {
  async criar(ator: Ator, username: string, senha: string, papel: Papel) {
    // Quem cria usuário é sempre o admin. A senha entra forte ou não entra.
    const nome = validarUsername(username);
    validarSenhaForte(senha);
    const senhaHash = await gerarHash(senha);
    return transacao(async (tx) => {
      if (await usuarioRepo.porUsername(tx, nome)) throw erroConflito(`Usuário '${nome}' já existe.`);
      const u = await usuarioRepo.criar(tx, { username: nome, senhaHash, papel });
      await auditoriaRepo.registrar(tx, ator.id, 'USUARIO_CRIADO', { username: nome, papel });
      return paraPublico(u);
    });
  },

  listar: (p: Pagina) => {
    const { skip, take } = skipTake(p);
    return usuarioRepo.listar(prisma, skip, take);
  },

  async renomear(ator: Ator, id: string, novo: string, versao?: number) {
    // Mudar de nome não muda a pessoa, só o crachá. Mas o crachá novo tem que ser único.
    const nome = validarUsername(novo);
    return transacao(async (tx) => {
      const alvo = await carregar(tx, id);
      if (alvo.username === nome) throw erroValidacao('O novo nome de usuário é igual ao atual.');
      if (await usuarioRepo.porUsername(tx, nome)) throw erroConflito(`Usuário '${nome}' já existe.`);
      const u = await usuarioRepo.atualizar(tx, id, versaoEfetiva(versao, alvo.versao), { username: nome });
      await auditoriaRepo.registrar(tx, ator.id, 'USUARIO_RENOMEADO', { de: alvo.username, para: nome });
      return paraPublico(u);
    });
  },

  /** Admin troca o papel de OUTRO usuário (o próprio, nunca: ninguém se tranca para fora da própria casa). */
  async alterarPapel(ator: Ator, id: string, papel: Papel, versao?: number) {
    // Promoção ou rebaixamento: o admin não mexe no próprio cargo. Já vi esse golpe.
    return transacao(async (tx) => {
      const alvo = await carregar(tx, id);
      if (alvo.id === ator.id) throw erroValidacao('Você não pode alterar o próprio papel.');
      if (alvo.papel === papel) throw erroValidacao(`O usuário já possui o papel '${papel}'.`);
      const u = await usuarioRepo.atualizar(tx, id, versaoEfetiva(versao, alvo.versao), { papel });
      await auditoriaRepo.registrar(tx, ator.id, 'USUARIO_PAPEL_ALTERADO', { username: alvo.username, de: alvo.papel, para: papel });
      return paraPublico(u);
    });
  },

  async redefinirSenha(ator: Ator, id: string, novaSenha: string, versao?: number) {
    // Hash novo entra, hash velho sai. O admin não precisa saber a senha antiga; precisa de autoridade.
    validarSenhaForte(novaSenha);
    const senhaHash = await gerarHash(novaSenha);
    await transacao(async (tx) => {
      const alvo = await carregar(tx, id);
      await usuarioRepo.atualizar(tx, id, versaoEfetiva(versao, alvo.versao), { senhaHash });
      await auditoriaRepo.registrar(tx, ator.id, 'USUARIO_SENHA_REDEFINIDA', { username: alvo.username });
    });
  },

  definirAtivo,

  /** Soft delete = desativar. Permanente: só para quem não deixou rastro (o banco recusa com FK RESTRICT -> 409). Quem tem histórico fica na história. */
  async remover(ator: Ator, id: string, permanente: boolean, versao?: number) {
    // Soft delete desativa; o permanente é só para quem não deixou rastro. Quem fez história, fica na história.
    if (!permanente) {
      await definirAtivo(ator, id, false, versao);
      return;
    }
    if (ator.papel !== 'admin') throw erroPermissao('Somente o administrador pode executar o delete definitivo.');
    await transacao(async (tx) => {
      const alvo = await carregar(tx, id);
      if (alvo.id === ator.id) throw erroValidacao('Você não pode excluir a própria conta.');
      try {
        await usuarioRepo.excluir(tx, id);
      } catch (e) {
        if (ehViolacaoDeReferencia(e)) throw erroConflito('O usuário possui histórico (lotes ou movimentações); desative-o em vez de excluí-lo.');
        throw e;
      }
      await auditoriaRepo.registrar(tx, ator.id, 'USUARIO_EXCLUIDO', { username: alvo.username });
    });
  },
};
