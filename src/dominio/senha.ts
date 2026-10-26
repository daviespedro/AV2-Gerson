// Senha fraca é convite. Oito caracteres, uma maiúscula, um número: não é o cofre do Banco Central,
// mas já espanta o curioso.

import { erroValidacao } from '../errors';

export function validarSenhaForte(senha: string) {
  // 'senha123' não é segredo: é convite com cartão de visita.
  if (!senha || senha.length < 8 || !/[A-Z]/.test(senha) || !/\d/.test(senha)) {
    throw erroValidacao('Senha fraca: mínimo de 8 caracteres, 1 letra maiúscula e 1 número.');
  }
}

export function validarUsername(username: string): string {
  // Espaço no meio do nome de usuário é o tipo de detalhe que faz o culpado se entregar.
  const nome = (username ?? '').trim();
  if (nome.length < 3 || /\s/.test(nome)) {
    throw erroValidacao('O nome de usuário deve ter no mínimo 3 caracteres e não pode conter espaços.');
  }
  return nome;
}
