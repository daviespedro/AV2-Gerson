// Todo erro tem um rosto e um status HTTP. Gente mente; código de status, não.
// Lance um destes e o plugin de erros sabe exatamente o que responder.

export class ErroApp extends Error {
  constructor(readonly status: number, readonly tipo: string, mensagem: string) {
    super(mensagem);
  }
}

export const erroValidacao = (m: string) => new ErroApp(400, 'ErroValidacao', m);
export const erroNaoAutenticado = (m = 'Autenticação necessária.') => new ErroApp(401, 'NaoAutenticado', m);
export const erroPermissao = (m: string) => new ErroApp(403, 'ErroPermissao', m);
export const erroNaoEncontrado = (m: string) => new ErroApp(404, 'NaoEncontrado', m);
export const erroConflito = (m: string) => new ErroApp(409, 'Conflito', m);

/**
 * Delete ou update barrado por uma chave estrangeira. Cada versão do PostgreSQL conta essa história do seu jeito:
 * até a 16 o Prisma devolve P2003 (SQLSTATE 23503); a 18 acusa "violates RESTRICT setting" com SQLSTATE 23001,
 * que o Prisma nem reconhece (vira erro desconhecido). Eu reconheço os dois, para o 409 não virar 500 conforme o banco.
 */
export function ehViolacaoDeReferencia(e: unknown): boolean {
  // O PostgreSQL 16 e o 18 contam a mesma história com palavras diferentes. Eu entendo as duas: é cold reading de mensagem de erro.
  const erro = e as { code?: string; message?: string } | null;
  return erro?.code === 'P2003' || /\b2300[1]\b|\b23503\b|RESTRICT setting|violates foreign key constraint/i.test(erro?.message ?? '');
}
