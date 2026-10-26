// Concorrência otimista: se a versão que você viu não é a que está lá, alguém chegou antes de você.

import { erroConflito } from '../errors';

/** O updateMany com { id, versao } não achou nada: alguém chegou antes e mexeu no registro. Conflito, 409. */
export function exigirVersao(linhas: number, entidade: string) {
  // Zero linhas atualizadas significa que alguém passou na sua frente. Educadamente: 409.
  if (linhas === 0) throw erroConflito(`${entidade} foi alterado por outra operação. Recarregue e tente de novo.`);
}

/** A versão que o cliente viu; se ele não disser, vale a que eu li dentro da própria transação. */
export const versaoEfetiva = (informada: number | undefined, atual: number) => informada ?? atual;
