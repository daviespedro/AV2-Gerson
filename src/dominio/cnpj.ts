// CNPJ é um truque de aritmética: dois dígitos que denunciam quem inventou o número. Eu confiro os dois.
// Sem banco, sem I/O: só matemática e uma boa dose de desconfiança.

import { erroValidacao } from '../errors';

const PESOS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

const digito = (base: string, pesos: number[]) => {
  const resto = [...base].reduce((s, d, i) => s + Number(d) * pesos[i], 0) % 11;
  return resto < 2 ? 0 : 11 - resto;
};

/** Com ou sem máscara, tanto faz: eu enxergo através. Devolve os 14 dígitos ou lança ErroValidacao. */
export function normalizarCnpj(entrada: string): string {
  // Repare na sequência 11111111111111: passa em aritmética ingênua e mesmo assim é falsa. Desconfio de número redondo demais.
  const c = (entrada ?? '').replace(/\D/g, '');
  if (c.length !== 14) throw erroValidacao('CNPJ deve conter 14 dígitos.');
  if (/^(\d)\1{13}$/.test(c)) throw erroValidacao('CNPJ inválido (sequência repetida).');
  const d1 = digito(c.slice(0, 12), PESOS_1);
  const d2 = digito(c.slice(0, 12) + d1, PESOS_2);
  if (c.slice(12) !== `${d1}${d2}`) throw erroValidacao('CNPJ inválido: dígitos verificadores não conferem.');
  return c;
}

export const formatarCnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
