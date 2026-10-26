// Onde o lote descobre seu status: contando o que os equipamentos fazem. Um arquivo, uma função, um veredito.

import { Db } from '../../db';
import { derivarStatusLote } from '../../dominio/lote';
import { Ator } from '../../shared/ator';
import { auditoriaRepo } from '../auditoria/auditoria.repository';
import { equipamentoRepo } from '../equipamento/equipamento.repository';
import { loteRepo } from './lote.repository';

/**
 * Recontagem dos votos do júri, dentro da transação em curso. Pressupõe o lote já trancado (loteRepo.bloquear),
 * para duas transições simultâneas não calcularem sobre dados desatualizados.
 */
export async function sincronizarStatusLote(tx: Db, ator: Ator, loteId: string) {
  // Contagem final dos votos: um por equipamento. Sem unanimidade, o veredito espera.
  const lote = await loteRepo.porId(tx, loteId);
  if (!lote) return;
  const novo = derivarStatusLote(await equipamentoRepo.statusDoLote(tx, loteId));
  if (!novo || novo === lote.status) return;
  await loteRepo.atualizar(tx, loteId, lote.versao, { status: novo });
  await auditoriaRepo.registrar(tx, ator.id, 'LOTE_STATUS_ATUALIZADO', { loteId, de: lote.status, para: novo, origem: 'derivado-dos-equipamentos' });
}
