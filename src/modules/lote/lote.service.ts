// Lote só nasce em organização ativa com contrato ativo. NF repetida na mesma organização? Esse truque eu conheço.
// Inativar, reativar e apagar: três finais diferentes para a mesma história.

import { StatusLote } from '@prisma/client';
import { codigoPrisma, prisma, transacao } from '../../db';
import { normalizarCnpj } from '../../dominio/cnpj';
import { hojeISO, validarDataEntradaLote } from '../../dominio/datas';
import { erroConflito, erroNaoEncontrado, erroPermissao, erroValidacao } from '../../errors';
import { Ator } from '../../shared/ator';
import { Pagina, skipTake } from '../../shared/http';
import { versaoEfetiva } from '../../shared/versao';
import { auditoriaRepo } from '../auditoria/auditoria.repository';
import { organizacaoRepo } from '../organizacao/organizacao.repository';
import { equipamentoService } from '../equipamento/equipamento.service';
import { loteRepo } from './lote.repository';

const duplicidadeNf = (e: unknown, nf: string): unknown =>
  codigoPrisma(e) === 'P2002' ? erroConflito(`Já existe um lote com a NF ${nf} para esta organização.`) : e;

async function carregar(db: Parameters<typeof loteRepo.porId>[0], id: string) {
  const l = await loteRepo.porId(db, id);
  if (!l) throw erroNaoEncontrado(`Lote ${id} não encontrado.`);
  return l;
}

export const loteService = {
  /**
   * Lote (+ equipamentos opcionais) num único ato: ou o truque inteiro funciona, ou ninguém viu nada. Exige organização ATIVA com contrato ATIVO:
   * a simples falta de contrato não inativa a organização, só impede novos lotes.
   */
  async criar(
    ator: Ator,
    d: { orgCnpj: string; nf: string; transportadora: string; dataEntrada?: string; equipamentos?: { tipo: string }[] },
  ) {
    if ((d.equipamentos?.length ?? 0) > 0 && !['admin', 'almoxarifado'].includes(ator.papel)) {
      throw erroPermissao(`O papel '${ator.papel}' não pode cadastrar equipamentos.`);
    }
    const cnpj = normalizarCnpj(d.orgCnpj);
    const nf = (d.nf ?? '').trim();
    const transportadora = (d.transportadora ?? '').trim();
    if (!nf) throw erroValidacao('A nota fiscal é obrigatória.');
    if (!transportadora) throw erroValidacao('A transportadora é obrigatória.');
    const dataEntrada = validarDataEntradaLote(d.dataEntrada ?? hojeISO());

    return transacao(async (tx) => {
      const org = await organizacaoRepo.porCnpj(tx, cnpj);
      if (!org) throw erroNaoEncontrado(`Organização com CNPJ ${cnpj} não encontrada. Cadastre-a antes.`);
      if (!org.ativo) throw erroConflito('A organização está inativa; reative-a antes de cadastrar lotes.');
      if (!org.contrato?.ativo) throw erroConflito('A organização não possui contrato ativo; lotes só podem ser cadastrados com contrato ativo.');

      const lote = await loteRepo.criar(tx, { organizacaoId: org.id, nf, transportadora, dataEntrada, criadoPorId: ator.id }).catch((e) => {
        throw duplicidadeNf(e, nf);
      });
      const equipamentos = [];
      for (const item of d.equipamentos ?? []) equipamentos.push(await equipamentoService.cadastrarEmTransacao(tx, ator, lote.id, item.tipo));
      await auditoriaRepo.registrar(tx, ator.id, 'LOTE_CRIADO', { loteId: lote.id, cnpj, nf, equipamentos: equipamentos.length });
      return { lote, equipamentos };
    });
  },

  async obter(id: string) {
    // Lote inativo ainda pode ser consultado: histórico não se apaga só porque a pessoa saiu de cena.
    const l = await loteRepo.detalhado(prisma, id);
    if (!l) throw erroNaoEncontrado(`Lote ${id} não encontrado.`);
    return l;
  },

  listar(p: Pagina, f: { status?: StatusLote; cnpj?: string; incluirInativos: boolean }) {
    const { skip, take } = skipTake(p);
    return loteRepo.listar(prisma, skip, take, { ...f, cnpj: f.cnpj ? normalizarCnpj(f.cnpj) : undefined });
  },

  /** O status NÃO se edita: é consequência do que os equipamentos fazem. Aqui só NF, transportadora e data. */
  async atualizar(ator: Ator, id: string, d: { nf?: string; transportadora?: string; dataEntrada?: string; versao?: number }) {
    const nf = d.nf?.trim();
    const transportadora = d.transportadora?.trim();
    if (d.nf !== undefined && !nf) throw erroValidacao('A nota fiscal é obrigatória.');
    if (d.transportadora !== undefined && !transportadora) throw erroValidacao('A transportadora é obrigatória.');
    const dataEntrada = d.dataEntrada !== undefined ? validarDataEntradaLote(d.dataEntrada) : undefined;
    return transacao(async (tx) => {
      const atual = await carregar(tx, id);
      if (!atual.ativo) throw erroConflito('O lote está inativo; reative-o antes de alterá-lo.');
      const l = await loteRepo.atualizar(tx, id, versaoEfetiva(d.versao, atual.versao), { nf, transportadora, dataEntrada }).catch((e) => {
        throw duplicidadeNf(e, nf ?? atual.nf);
      });
      await auditoriaRepo.registrar(tx, ator.id, 'LOTE_ATUALIZADO', { loteId: id });
      return l;
    });
  },

  async inativar(ator: Ator, id: string, versao?: number) {
    return transacao(async (tx) => {
      const atual = await carregar(tx, id);
      if (!atual.ativo) throw erroConflito('O lote já está inativo.');
      const l = await loteRepo.definirAtivo(tx, id, versaoEfetiva(versao, atual.versao), false, new Date());
      await auditoriaRepo.registrar(tx, ator.id, 'LOTE_INATIVADO', { loteId: id, nf: atual.nf });
      return l;
    });
  },

  async reativar(ator: Ator, id: string, versao?: number) {
    // Reativar o lote exige a organização ativa: não se reabre a sala sem o dono do prédio.
    return transacao(async (tx) => {
      const atual = await carregar(tx, id);
      if (atual.ativo) throw erroConflito('O lote já está ativo.');
      if (!atual.organizacao.ativo) throw erroConflito('A organização do lote está inativa; reative-a primeiro.');
      const l = await loteRepo.definirAtivo(tx, id, versaoEfetiva(versao, atual.versao), true, null);
      await auditoriaRepo.registrar(tx, ator.id, 'LOTE_REATIVADO', { loteId: id, nf: atual.nf });
      return l;
    });
  },

  async excluir(ator: Ator, id: string) {
    // Delete permanente: só admin. 'Desfazer' existe no cinema, não no mundo real.
    if (ator.papel !== 'admin') throw erroPermissao('Somente o administrador pode executar o delete definitivo (permanente=true).');
    await transacao(async (tx) => {
      const atual = await carregar(tx, id);
      await loteRepo.excluir(tx, id);
      await auditoriaRepo.registrar(tx, ator.id, 'LOTE_EXCLUIDO', { loteId: id, nf: atual.nf, cnpj: atual.organizacao.cnpj });
    });
  },
};
