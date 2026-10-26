// Senhas: bcrypt, sempre. E o mesmo tempo de resposta para quem existe e para quem não existe.

import { compare, hash } from 'bcryptjs'; // bcrypt em JS puro: roda igual em Windows 10+ e Ubuntu 24.04+, sem compilar nada (menos truque, mais portabilidade)

const rodadas = () => Number(process.env.BCRYPT_ROUNDS ?? 12);
let isca: string | undefined;

export const gerarHash = (senha: string) => hash(senha, rodadas());

/** Sempre roda o bcrypt, mesmo se a conta não existe (hash isca): o tempo de resposta não conta a ninguém quem existe. */
export async function conferirSenha(senha: string, hashSalvo: string | null): Promise<boolean> {
  // Gasto sempre o mesmo tempo, exista a conta ou não. Quem cronometra para adivinhar quem existe volta de mãos vazias.
  isca ??= await hash('senha-isca-greencode', rodadas());
  const ok = await compare(senha ?? '', hashSalvo ?? isca);
  return ok && hashSalvo !== null;
}
