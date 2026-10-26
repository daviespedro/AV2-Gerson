// Quem é você? Eu desconfio de todo mundo, igualmente.
// Mensagem de erro idêntica para conta inexistente e senha errada: não dou pista a ninguém.

import { prisma, transacao } from '../../db';
import { validarSenhaForte, validarUsername } from '../../dominio/senha';
import { erroConflito, erroNaoAutenticado, erroNaoEncontrado } from '../../errors';
import { conferirSenha, gerarHash } from '../../shared/hash';
import { Ator } from '../../shared/ator';
import { auditoriaRepo } from '../auditoria/auditoria.repository';
import { paraPublico, usuarioRepo } from '../usuario/usuario.repository';

export const authService = {
  /** Coroa o primeiro admin. Só funciona com o banco vazio; o lock de aviso impede dois candidatos de pegarem a coroa ao mesmo tempo. */
  async provisionar(username: string, senha: string) {
    // Easter egg nº 3: o primeiro admin se chama 'admin' porque 'Red John' é nome de uso exclusivo da ficção. :)
    const nome = validarUsername(username);
    validarSenhaForte(senha);
    const senhaHash = await gerarHash(senha);
    return transacao(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7001)`;
      if ((await usuarioRepo.contar(tx)) > 0) throw erroConflito('O sistema já foi provisionado.');
      const u = await usuarioRepo.criar(tx, { username: nome, senhaHash, papel: 'admin' });
      await auditoriaRepo.registrar(tx, u.id, 'PROVISIONAMENTO', { username: nome });
      return paraPublico(u);
    });
  },

  async login(username: string, senha: string) {
    // Credencial errada? A mesma resposta para tudo. Nunca digo qual pista o suspeito errou.
    const u = await usuarioRepo.porUsername(prisma, (username ?? '').trim());
    const ok = await conferirSenha(senha, u?.senhaHash ?? null);
    if (!u || !ok || !u.ativo) {
      await auditoriaRepo.registrar(prisma, u?.id ?? null, 'LOGIN_FALHA', { username: String(username).slice(0, 100) });
      throw erroNaoAutenticado('Credenciais inválidas.'); // mesma mensagem para conta inexistente, inativa ou senha errada: não dou pista a quem só está testando a fechadura
    }
    await auditoriaRepo.registrar(prisma, u.id, 'LOGIN_SUCESSO', {});
    return paraPublico(u);
  },

  async obterAtor(id: string): Promise<Ator> {
    // crachá assinado, mas com um 'sub' que nem UUID é? Isso não é gente: é fantasia. 401 e seguimos.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? '')) throw erroNaoAutenticado('Token inválido.');
    const u = await usuarioRepo.porId(prisma, id);
    if (!u || !u.ativo) throw erroNaoAutenticado('Conta inexistente ou desativada.');
    return { id: u.id, username: u.username, papel: u.papel };
  },

  async me(id: string) {
    // Quem sou eu? O crachá diz uma coisa, o banco confirma, e se divergirem quem ganha é o banco.
    const u = await usuarioRepo.porId(prisma, id);
    if (!u) throw erroNaoEncontrado('Usuário não encontrado.');
    return paraPublico(u);
  },

  async trocarPropriaSenha(ator: Ator, senhaAtual: string, novaSenha: string) {
    // Para trocar a senha é preciso provar que sabe a atual. Esquecer onde pôs a chave não faz ninguém dono da casa.
    validarSenhaForte(novaSenha);
    const novoHash = await gerarHash(novaSenha);
    await transacao(async (tx) => {
      const u = await usuarioRepo.porId(tx, ator.id);
      if (!u || !(await conferirSenha(senhaAtual, u.senhaHash))) throw erroNaoAutenticado('Senha atual incorreta.');
      await usuarioRepo.atualizar(tx, u.id, u.versao, { senhaHash: novoHash });
      await auditoriaRepo.registrar(tx, ator.id, 'SENHA_ALTERADA', {});
    });
  },
};
