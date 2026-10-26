// Datas: 31 de fevereiro não existe, por mais convincente que o cliente seja. Aqui eu desmascaro isso.
// E nada de lote vindo do futuro: viajante do tempo eu só aceito em filme.

import { erroValidacao } from '../errors';

const DIA_MS = 86_400_000;
export const hojeISO = (agora = new Date()) => agora.toISOString().slice(0, 10);

/** AAAA-MM-DD -> Date (UTC, meia-noite). Formato errado ou data impossível (2026-02-31)? Rejeitado, com um sorriso. */
export function lerDataISO(iso: string, rotulo: string): Date {
  // Easter egg nº 2: 31 de fevereiro é um truque de cartas com o baralho errado: dá para ver de longe.
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso ?? '') || isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) {
    throw erroValidacao(`${rotulo} inválida. Use o formato AAAA-MM-DD.`);
  }
  return d;
}

/** Entrada de lote: nada de futuro e, no máximo, 90 dias atrás (data UTC do servidor). Lote velho demais já virou lenda. */
export function validarDataEntradaLote(iso: string, agora = new Date()): Date {
  // Entrada no futuro? Só se o transportador tiver uma máquina do tempo (e então eu quero uma carona).
  const data = lerDataISO(iso, 'Data de entrada');
  const hoje = lerDataISO(hojeISO(agora), 'Data de hoje');
  if (data.getTime() > hoje.getTime()) throw erroValidacao('Data de entrada não pode ser futura.');
  if ((hoje.getTime() - data.getTime()) / DIA_MS > 90) throw erroValidacao('Data de entrada não pode ser anterior a 90 dias.');
  return data;
}
