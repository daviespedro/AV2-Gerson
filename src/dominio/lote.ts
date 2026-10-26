// O lote é como um júri: só chega a um veredito quando todos concordam.
// Um equipamento discordando e o status fica onde está.

import { StatusEquipamento } from './equipamento';

export type StatusLote = 'recebido' | 'em_triagem' | 'triagem_completa' | 'encerrado';
const DESTINOS_FINAIS: readonly StatusEquipamento[] = ['reciclagem', 'descarte_seguro', 'revenda'];

/**
 * Veredito do júri: o status do lote só muda quando TODOS os equipamentos coincidem.
 * todos aguardando_triagem -> recebido; todos em_triagem -> em_triagem; todos triado -> triagem_completa;
 * todos em destino final (mistura permitida) -> encerrado. Qualquer outra combinação: null (sem mudança).
 */
export function derivarStatusLote(statuses: readonly StatusEquipamento[]): StatusLote | null {
  // Se um jurado discorda, não há veredito. Assim funciona em tribunal e em lote.
  if (statuses.length === 0) return null;
  if (statuses.every((s) => s === 'aguardando_triagem')) return 'recebido';
  if (statuses.every((s) => s === 'em_triagem')) return 'em_triagem';
  if (statuses.every((s) => s === 'triado')) return 'triagem_completa';
  if (statuses.every((s) => DESTINOS_FINAIS.includes(s))) return 'encerrado';
  return null;
}
