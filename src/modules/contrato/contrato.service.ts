// O contrato é o passe de entrada da organização. Sem ele (ou encerrado) não entra lote; a organização, porém, segue ativa.
// Datas conferidas, frequência positiva e versão checada em toda atualização.

import { Prisma } from '@prisma/client';
import { Db, prisma, transacao } from '../../db';
import { normalizarCnpj } from '../../dominio/cnpj';
import { lerDataISO } from '../../dominio/datas';
import { erroConflito, erroNaoEncontrado, erroValidacao } from '../../errors';
import { Ator } from '../../shared/ator';
import { Pagina, skipTake } from '../../shared/http';
import { versaoEfetiva } from '../../shared/versao';
import { auditoriaRepo } from '../auditoria/auditoria.repository';
import { organizacaoRepo } from '../organizacao/organizacao.repository';
import { contratoRepo } from './contrato.repository';

const validarFrequencia = (n: number) => {
  if (!Number.isInteger(n) || n <= 0) throw erroValidacao('A frequência de coleta deve ser um número inteiro de dias maior que zero.');
};

async function carregar(db: Db, id: string) {
  // Contrato que não existe: não adianta insistir. 404, e seguimos.
  const c = await contratoRepo.porId(db, id);
  if (!c) throw erroNaoEncontrado(`Contrato ${id} não encontrado.`);
  return c;
}

const exigirOrgAtiva = (c: { organizacao: { ativo: boolean } }, acao: string) => {
  if (!c.organizacao.ativo) throw erroConflito(`A organização está inativa; reative-a antes de ${acao}.`);
};

export const contratoService = {
  async criar(
    ator: Ator,
    d: { orgCnpj: string; dataInicio: string; frequenciaColetaDias: number; condicoes?: string; clausulas?: Prisma.InputJsonValue },
  ) {
    const cnpj = normalizarCnpj(d.orgCnpj);
    const inicio = lerDataISO(d.dataInicio, 'Data de início do contrato');
    validarFrequencia(d.frequenciaColetaDias);
    return transacao(async (tx) => {
      const org = await organizacaoRepo.porCnpj(tx, cnpj);
      if (!org) throw erroNaoEncontrado(`Organização com CNPJ ${cnpj} não encontrada. Cadastre-a antes.`);
      if (!org.ativo) throw erroConflito('A organização está inativa; reative-a antes de criar contrato.');
      if (org.contrato) throw erroConflito('A organização já possui um contrato de coleta.');
      const c = await contratoRepo.criar(tx, {
        organizacaoId: org.id,
        dataInicio: inicio,
        frequenciaColetaDias: d.frequenciaColetaDias,
        condicoes: d.condicoes?.trim() || null,
        clausulas: d.clausulas,
      });
      await auditoriaRepo.registrar(tx, ator.id, 'CONTRATO_CRIADO', { cnpj, contratoId: c.id });
      return c;
    });
  },

  obter: (id: string) => carregar(prisma, id),

  listar: (p: Pagina, incluirInativos: boolean) => {
    const { skip, take } = skipTake(p);
    return contratoRepo.listar(prisma, skip, take, incluirInativos);
  },

  async atualizar(
    ator: Ator,
    id: string,
    d: { frequenciaColetaDias?: number; condicoes?: string | null; clausulas?: Prisma.InputJsonValue; versao?: number },
  ) {
    if (d.frequenciaColetaDias !== undefined) validarFrequencia(d.frequenciaColetaDias);
    return transacao(async (tx) => {
      const atual = await carregar(tx, id);
      exigirOrgAtiva(atual, 'alterar o contrato');
      if (!atual.ativo) throw erroValidacao('Contrato encerrado não pode ser alterado.');
      const c = await contratoRepo.atualizar(tx, id, versaoEfetiva(d.versao, atual.versao), {
        frequenciaColetaDias: d.frequenciaColetaDias,
        condicoes: d.condicoes,
        clausulas: d.clausulas,
      });
      await auditoriaRepo.registrar(tx, ator.id, 'CONTRATO_ATUALIZADO', { contratoId: id });
      return c;
    });
  },

  /** Encerrar é baixar a cortina (ativo=false): o histórico fica. Reativar reabre. A organização não vira inativa por isso. */
  async definirAtivo(ator: Ator, id: string, ativo: boolean, versao?: number) {
    // Encerrar é baixar a cortina; reativar é reabrir o teatro. Em nenhum dos casos a organização perde o emprego.
    return transacao(async (tx) => {
      const atual = await carregar(tx, id);
      exigirOrgAtiva(atual, ativo ? 'reabrir o contrato' : 'encerrar o contrato');
      if (atual.ativo === ativo) throw erroConflito(ativo ? 'O contrato já está ativo.' : 'O contrato já está encerrado.');
      const c = await contratoRepo.atualizar(tx, id, versaoEfetiva(versao, atual.versao), { ativo });
      await auditoriaRepo.registrar(tx, ator.id, ativo ? 'CONTRATO_REATIVADO' : 'CONTRATO_ENCERRADO', { contratoId: id });
      return c;
    });
  },

  /** Contrato só tem delete definitivo: sem soft delete, sem lamentos. A organização segue ativa, mas sem contrato não recebe lote. */
  async excluir(ator: Ator, id: string) {
    // Delete de contrato é definitivo: aqui não existe 'e se eu me arrepender?'. Eu avisei.
    await transacao(async (tx) => {
      const atual = await carregar(tx, id);
      await contratoRepo.excluir(tx, id);
      await auditoriaRepo.registrar(tx, ator.id, 'CONTRATO_EXCLUIDO', { contratoId: id, cnpj: atual.organizacao.cnpj });
    });
  },
};
