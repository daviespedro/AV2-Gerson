// As regras das organizações: CNPJ válido, nada de duplicata, inativação em cadeia e reativação só de quem saiu junto.
// Tudo que escreve acontece numa transação e deixa uma anotação na auditoria.

import { Db, prisma, transacao } from '../../db';
import { normalizarCnpj } from '../../dominio/cnpj';
import { erroConflito, erroNaoEncontrado, erroPermissao, erroValidacao } from '../../errors';
import { Ator } from '../../shared/ator';
import { Pagina, skipTake } from '../../shared/http';
import { versaoEfetiva } from '../../shared/versao';
import { auditoriaRepo } from '../auditoria/auditoria.repository';
import { organizacaoRepo } from './organizacao.repository';

async function porCnpj(db: Db, cnpjEntrada: string) {
  const cnpj = normalizarCnpj(cnpjEntrada);
  const org = await organizacaoRepo.porCnpj(db, cnpj);
  if (!org) throw erroNaoEncontrado(`Organização com CNPJ ${cnpj} não encontrada.`);
  return org;
}

export const organizacaoService = {
  async criar(ator: Ator, cnpjEntrada: string, razaoSocial: string, contato?: string) {
    // CNPJ repetido? Eu já vi essa pessoa antes, com outra roupa.
    const cnpj = normalizarCnpj(cnpjEntrada);
    const razao = (razaoSocial ?? '').trim();
    if (!razao) throw erroValidacao('Razão social é obrigatória.');
    return transacao(async (tx) => {
      const existente = await organizacaoRepo.porCnpj(tx, cnpj);
      if (existente) {
        throw erroConflito(
          existente.ativo ? `Já existe organização com o CNPJ ${cnpj}.` : `Já existe organização inativa com o CNPJ ${cnpj}; reative-a em vez de cadastrar de novo.`,
        );
      }
      const org = await organizacaoRepo.criar(tx, { cnpj, razaoSocial: razao, contato: contato?.trim() || null });
      await auditoriaRepo.registrar(tx, ator.id, 'ORG_CRIADA', { cnpj });
      return org;
    });
  },

  obter: (cnpj: string) => porCnpj(prisma, cnpj),

  listar: (p: Pagina, incluirInativos: boolean) => {
    const { skip, take } = skipTake(p);
    return organizacaoRepo.listar(prisma, skip, take, incluirInativos);
  },

  async atualizar(ator: Ator, cnpjEntrada: string, d: { razaoSocial?: string; contato?: string | null; versao?: number }) {
    if (d.razaoSocial !== undefined && !d.razaoSocial.trim()) throw erroValidacao('Razão social é obrigatória.');
    return transacao(async (tx) => {
      const atual = await porCnpj(tx, cnpjEntrada);
      if (!atual.ativo) throw erroConflito('A organização está inativa; reative-a antes de alterá-la.');
      const org = await organizacaoRepo.atualizar(tx, atual.id, versaoEfetiva(d.versao, atual.versao), {
        razaoSocial: d.razaoSocial?.trim(),
        contato: d.contato,
      });
      await auditoriaRepo.registrar(tx, ator.id, 'ORG_ATUALIZADA', { cnpj: atual.cnpj });
      return org;
    });
  },

  /** Soft delete em cadeia: a organização sai de cena e leva os lotes junto. O contrato fica como está e NÃO impede a saída. */
  async inativar(ator: Ator, cnpjEntrada: string, versao?: number) {
    // Saem juntos de cena: lotes e equipamentos. Nenhuma organização vai embora sem a equipe.
    return transacao(async (tx) => {
      const atual = await porCnpj(tx, cnpjEntrada);
      if (!atual.ativo) throw erroConflito('A organização já está inativa.');
      const quando = new Date();
      await organizacaoRepo.definirAtivo(tx, atual.id, versaoEfetiva(versao, atual.versao), false, quando);
      const lotesInativados = await organizacaoRepo.inativarLotes(tx, atual.id, quando);
      await auditoriaRepo.registrar(tx, ator.id, 'ORG_INATIVADA', { cnpj: atual.cnpj, lotesInativados });
      return { ...(await organizacaoRepo.porId(tx, atual.id)), lotesInativados };
    });
  },

  /** Reativa a organização e SÓ os lotes que saíram com ela: quem foi dispensado antes continua dispensado. */
  async reativar(ator: Ator, cnpjEntrada: string, versao?: number) {
    // Só volta quem saiu junto: os lotes que já tinham ido embora antes continuam ausentes.
    return transacao(async (tx) => {
      const atual = await porCnpj(tx, cnpjEntrada);
      if (atual.ativo) throw erroConflito('A organização já está ativa.');
      await organizacaoRepo.definirAtivo(tx, atual.id, versaoEfetiva(versao, atual.versao), true, null);
      const lotesReativados = atual.inativadoEm ? await organizacaoRepo.reativarLotes(tx, atual.id, atual.inativadoEm) : 0;
      await auditoriaRepo.registrar(tx, ator.id, 'ORG_REATIVADA', { cnpj: atual.cnpj, lotesReativados });
      return { ...(await organizacaoRepo.porId(tx, atual.id)), lotesReativados };
    });
  },

  async excluir(ator: Ator, cnpjEntrada: string) {
    // Delete permanente da organização: contrato, lotes e equipamentos vão atrás. É drástico, por isso é só do admin.
    if (ator.papel !== 'admin') throw erroPermissao('Somente o administrador pode executar o delete definitivo (permanente=true).');
    await transacao(async (tx) => {
      const atual = await porCnpj(tx, cnpjEntrada);
      await organizacaoRepo.excluir(tx, atual.id);
      await auditoriaRepo.registrar(tx, ator.id, 'ORG_EXCLUIDA', { cnpj: atual.cnpj, razaoSocial: atual.razaoSocial });
    });
  },
};
