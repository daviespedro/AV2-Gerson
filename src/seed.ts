// O seed conta uma história: quatro usuários, organizações boas e ruins, lotes em vários estágios.
// Tudo passa pelos mesmos services da API. Se a regra de negócio tiver um furo, é aqui que o truque falha primeiro.

import { carregarConfig } from './config';
import { prisma } from './db';
import { Ator } from './shared/ator';
import { authService } from './modules/auth/auth.service';
import { contratoService } from './modules/contrato/contrato.service';
import { equipamentoService } from './modules/equipamento/equipamento.service';
import { loteService } from './modules/lote/lote.service';
import { organizacaoService } from './modules/organizacao/organizacao.service';
import { usuarioService } from './modules/usuario/usuario.service';
import { parametroService } from './modules/parametro/parametro.service';

/** CNPJ com cara de verdadeiro: 12 dígitos de base e os dois verificadores calculados. */
function cnpjValido(base12: string): string {
  // Fabrico CNPJs com cara de verdadeiros. É falsificação, mas com certificado de qualidade.
  const dv = (d: string, pesos: number[]) => {
    const r = [...d].reduce((s, x, i) => s + Number(x) * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${d1}${d2}`;
}

const dia = (delta: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

/**
 * A história que o banco conta ao acordar. Idempotente: se já há usuários, finjo que não vi nada. Tudo passa pelos MESMOS services da
 * API, então o seed também exercita as regras: CNPJ, datas, triagem antes do desmonte, justificativa na queda
 * de estado, status do lote derivado, soft delete em cadeia.
 * Usuários: admin, cadastro1, almox1, auditor1 (senha: SEED_SENHA, padrão "Greencode#2026").
 */
async function main() {
  // Easter egg nº 6: este seed cria o admin, três colegas e uma história inteira. Sem mentalista nenhum, só aritmética.
  carregarConfig();
  const senha = process.env.SEED_SENHA ?? 'Greencode#2026';
  if ((await prisma.usuario.count()) > 0) {
    console.log('Seed ignorado: o banco já possui usuários.');
    return;
  }

  const a = await authService.provisionar('admin', senha);
  const admin: Ator = { id: a.id, username: a.username, papel: 'admin' };
  await usuarioService.criar(admin, 'cadastro1', senha, 'cadastro');
  await usuarioService.criar(admin, 'almox1', senha, 'almoxarifado');
  await usuarioService.criar(admin, 'auditor1', senha, 'auditor');
  await parametroService.definir(admin, 'aliquota_icms', '0.18');

  const [c1, c2, c3, c4] = [cnpjValido('112223330001'), cnpjValido('114447770001'), cnpjValido('459974180001'), cnpjValido('777666550001')];
  await organizacaoService.criar(admin, c1, 'Tech Solutions Ltda', 'contato@techsolutions.example');
  await organizacaoService.criar(admin, c2, 'Banco Horizonte S.A.', 'ti@horizonte.example');
  await organizacaoService.criar(admin, c3, 'Escola Futuro Digital');
  await organizacaoService.criar(admin, c4, 'Distribuidora Antiga ME');

  await contratoService.criar(admin, { orgCnpj: c1, dataInicio: dia(-200), frequenciaColetaDias: 30, condicoes: 'Coleta mensal com certificado de destinação.', clausulas: { multaAtrasoPercentual: 2 } });
  await contratoService.criar(admin, { orgCnpj: c2, dataInicio: dia(-90), frequenciaColetaDias: 15 });
  const contratoEscola = await contratoService.criar(admin, { orgCnpj: c3, dataInicio: dia(-120), frequenciaColetaDias: 45 });
  await contratoService.definirAtivo(admin, contratoEscola.id, false); // encerrado: a organização continua de pé, mas sem contrato ativo não recebe lote
  await contratoService.criar(admin, { orgCnpj: c4, dataInicio: dia(-80), frequenciaColetaDias: 30 });

  const l1 = await loteService.criar(admin, {
    orgCnpj: c1,
    nf: 'NF-0001',
    transportadora: 'TransVerde',
    dataEntrada: dia(-60),
    equipamentos: [{ tipo: 'Terminal' }, { tipo: 'CPU' }, { tipo: 'Monitor' }, { tipo: 'Servidor' }, { tipo: 'Impressora' }], // impressora: sem perfil próprio, cai no genérico
  });
  const l2 = await loteService.criar(admin, {
    orgCnpj: c2,
    nf: 'NF-0002',
    transportadora: 'LogReversa Express',
    dataEntrada: dia(-10),
    equipamentos: [{ tipo: 'CPU' }, { tipo: 'CPU' }, { tipo: 'Monitor' }],
  });
  await loteService.criar(admin, { orgCnpj: c2, nf: 'NF-0003', transportadora: 'TransVerde', dataEntrada: dia(0) }); // lote vazio, só para ver se alguém se assusta
  await loteService.criar(admin, { orgCnpj: c4, nf: 'NF-0004', transportadora: 'TransVerde', dataEntrada: dia(-20), equipamentos: [{ tipo: 'CPU' }] });

  const [terminal, cpu, monitor, servidor] = l1.equipamentos;
  await equipamentoService.concluirTriagem(admin, terminal.id);
  await equipamentoService.mover(admin, terminal.id, 'desmonte');

  await equipamentoService.concluirTriagem(admin, cpu.id);
  await equipamentoService.alterarEstado(admin, cpu.id, 'regular', 'Desgaste visível na carcaça'); // queda de 3 categorias: só passa porque veio com explicação
  await equipamentoService.mover(admin, cpu.id, 'reciclagem');

  await equipamentoService.concluirTriagem(admin, monitor.id);
  await equipamentoService.alterarEstado(admin, monitor.id, 'sucata', 'Tela trincada, sem reparo possível');
  await equipamentoService.mover(admin, monitor.id, 'descarte_seguro');

  await equipamentoService.concluirTriagem(admin, servidor.id);
  await equipamentoService.mover(admin, servidor.id, 'revenda');
  // a impressora fica aguardando_triagem de propósito: um jurado discordando e o lote 1 continua "recebido"

  for (const e of l2.equipamentos) await equipamentoService.concluirTriagem(admin, e.id); // todos triados, unanimidade: lote 2 vira triagem_completa

  await organizacaoService.inativar(admin, c4); // soft delete em cadeia: org, lote e equipamentos saem de cena de uma vez

  console.log('Seed concluído: 4 usuários, 4 organizações (1 inativa), 4 contratos (1 encerrado), 4 lotes, 9 equipamentos.');
  console.log(`Login de desenvolvimento: admin / ${senha}`);
}

main()
  .catch((e) => {
    console.error('Falha no seed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
