// O coração do negócio: cada mudança trava o lote, grava a movimentação, anota na auditoria e recalcula o lote.
// Se qualquer passo falhar, todos desfazem. Ninguém viu nada.

import { randomUUID } from 'node:crypto';
import { EstadoFisico, StatusEquipamento } from '@prisma/client';
import { Db, prisma, transacao } from '../../db';
import { calcularDepreciacao, exigirJustificativa, normalizarTipo, validarEstadoFisico, validarMovimento } from '../../dominio/equipamento';
import { erroConflito, erroNaoEncontrado, erroValidacao } from '../../errors';
import { Ator } from '../../shared/ator';
import { Pagina, skipTake } from '../../shared/http';
import { versaoEfetiva } from '../../shared/versao';
import { auditoriaRepo } from '../auditoria/auditoria.repository';
import { loteRepo } from '../lote/lote.repository';
import { sincronizarStatusLote } from '../lote/lote.status';
import { equipamentoRepo, movimentacaoRepo } from './equipamento.repository';

type Linha = NonNullable<Awaited<ReturnType<typeof equipamentoRepo.porId>>>;
type Mudanca = { status?: StatusEquipamento; estadoFisico?: EstadoFisico; triagemCompleta?: boolean };

const naoEncontrado = (id: string) => erroNaoEncontrado(`Equipamento ${id} não encontrado.`);

async function carregar(db: Db, id: string) {
  // Equipamento que não aparece é de um lote inativo ou nunca existiu. Para a lei, dá no mesmo.
  const e = await equipamentoRepo.porId(db, id);
  if (!e) throw naoEncontrado(id);
  return e;
}

/**
 * Entra em cena dentro de uma transação já aberta (cadastro avulso e criação de lote usam o mesmo truque).
 * Código de barras = id gerado aqui; posição = próximo número do contador do lote (atômico).
 */
async function cadastrarEmTransacao(tx: Db, ator: Ator, loteId: string, tipoEntrada: string) {
  // Easter egg nº 4: o código de barras é o id. Um número, dois nomes: o truque mais velho do mundo, e ainda funciona.
  const tipo = normalizarTipo(tipoEntrada);
  const lote = await loteRepo.porId(tx, loteId);
  if (!lote) throw erroNaoEncontrado(`Lote ${loteId} não encontrado.`);
  if (!lote.ativo) throw erroConflito('O lote está inativo.');
  if (lote.status === 'encerrado') throw erroValidacao('Não é possível cadastrar equipamentos em lote encerrado.');
  await loteRepo.bloquear(tx, loteId);
  const posicao = await loteRepo.reservarPosicoes(tx, loteId, 1);
  const eq = await equipamentoRepo.criar(tx, { id: randomUUID(), loteId, tipo, posicao });
  await auditoriaRepo.registrar(tx, ator.id, 'EQUIPAMENTO_CADASTRADO', { equipamentoId: eq.id, loteId, tipo, posicao });
  return eq;
}

/**
 * O coração do espetáculo: toda mudança de estado passa por aqui (triagem, status, estado físico). Numa transação: trava o lote, relê o
 * equipamento, aplica a regra, grava com checagem de versão, registra movimentação + auditoria e
 * recalcula o status do lote. Qualquer falha (inclusive conflito de versão) desfaz tudo.
 */
function transicionar(
  ator: Ator,
  id: string,
  versao: number | undefined,
  acao: string,
  aplicar: (e: Linha) => { mudanca: Mudanca; justificativa?: string },
) {
  return transacao(async (tx) => {
    const previa = await carregar(tx, id);
    await loteRepo.bloquear(tx, previa.loteId);
    const antes = await carregar(tx, id); // segunda olhada, agora com o lote trancado: as coisas mudam quando ninguém está olhando
    const { mudanca, justificativa } = aplicar(antes);
    const depois = await equipamentoRepo.atualizar(tx, id, versaoEfetiva(versao, antes.versao), mudanca);

    const mudouStatus = antes.status !== depois.status;
    const mudouEstado = antes.estadoFisico !== depois.estadoFisico;
    if (mudouStatus || mudouEstado) {
      await movimentacaoRepo.registrar(tx, {
        equipamentoId: id,
        usuarioId: ator.id,
        statusDe: mudouStatus ? antes.status : undefined,
        statusPara: mudouStatus ? depois.status : undefined,
        estadoDe: mudouEstado ? antes.estadoFisico : undefined,
        estadoPara: mudouEstado ? depois.estadoFisico : undefined,
        justificativa: justificativa ?? null,
      });
    }
    await auditoriaRepo.registrar(tx, ator.id, acao, { equipamentoId: id, status: depois.status, estadoFisico: depois.estadoFisico });
    await sincronizarStatusLote(tx, ator, antes.loteId);
    return depois;
  });
}

export const equipamentoService = {
  cadastrarEmTransacao,

  cadastrar: (ator: Ator, loteId: string, tipo: string) => transacao((tx) => cadastrarEmTransacao(tx, ator, loteId, tipo)),

  obter: (id: string) => carregar(prisma, id),

  listar(p: Pagina, f: { loteId?: string; status?: StatusEquipamento }) {
    const { skip, take } = skipTake(p);
    return equipamentoRepo.listar(prisma, skip, take, f);
  },

  /** Corrige o tipo (cadastrado como "cpu", mas é um "servidor"): a primeira impressão engana, e a depreciação passa a seguir o perfil certo. */
  atualizarTipo(ator: Ator, id: string, tipoEntrada: string, versao?: number) {
    // Corrigir o tipo é corrigir a primeira impressão. A segunda costuma ser mais honesta.
    const tipo = normalizarTipo(tipoEntrada);
    return transacao(async (tx) => {
      const atual = await carregar(tx, id);
      const e = await equipamentoRepo.atualizar(tx, id, versaoEfetiva(versao, atual.versao), { tipo });
      await auditoriaRepo.registrar(tx, ator.id, 'EQUIPAMENTO_TIPO_ALTERADO', { equipamentoId: id, de: atual.tipo, para: tipo });
      return e;
    });
  },

  concluirTriagem: (ator: Ator, id: string, versao?: number) =>
    transicionar(ator, id, versao, 'EQUIPAMENTO_TRIAGEM_COMPLETA', () => ({ mudanca: { triagemCompleta: true, status: 'triado' } })),

  mover: (ator: Ator, id: string, status: StatusEquipamento, versao?: number) =>
    transicionar(ator, id, versao, 'EQUIPAMENTO_STATUS_ALTERADO', (e) => {
      validarMovimento(status, e.triagemCompleta);
      return { mudanca: { status } };
    }),

  alterarEstado: (ator: Ator, id: string, estadoEntrada: string, justificativa?: string, versao?: number) => {
    const estado = validarEstadoFisico(estadoEntrada);
    return transicionar(ator, id, versao, 'EQUIPAMENTO_ESTADO_ALTERADO', (e) => {
      exigirJustificativa(e.estadoFisico, estado, justificativa);
      return { mudanca: { estadoFisico: estado }, justificativa: justificativa?.trim() || undefined };
    });
  },

  /** Delete definitivo (o ciclo de vida do equipamento já é o status); o lote, o júri, recalcula o veredito. */
  excluir: (ator: Ator, id: string) =>
    transacao(async (tx) => {
      const eq = await carregar(tx, id);
      await loteRepo.bloquear(tx, eq.loteId);
      await equipamentoRepo.excluir(tx, id);
      await auditoriaRepo.registrar(tx, ator.id, 'EQUIPAMENTO_EXCLUIDO', { equipamentoId: id, loteId: eq.loteId, tipo: eq.tipo });
      await sincronizarStatusLote(tx, ator, eq.loteId);
    }),

  async depreciacao(id: string, meses: number) {
    // Quanto vale um equipamento depois de N meses? Mais do que parece, menos do que ele gostaria.
    const e = await carregar(prisma, id);
    return { equipamentoId: id, tipo: e.tipo, mesesDeUso: meses, ...calcularDepreciacao(e.tipo, meses) };
  },

  async rastreio(id: string) {
    // Por onde o equipamento andou: movimentação por movimentação, como num quadro de investigação com barbante vermelho.
    const equipamento = await carregar(prisma, id);
    return { equipamento, movimentacoes: await movimentacaoRepo.historico(prisma, id) };
  },
};
