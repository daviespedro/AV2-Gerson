// Concorrência: o que acontece quando muita gente aperta o mesmo botão ao mesmo tempo.
// Pessoas são previsíveis: na pressa, todas querem ser a primeira. O banco e as transações decidem quem foi.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Ambiente, criarAmbiente, dia, SENHA, Tokens } from './helpers/ambiente';

let amb: Ambiente;
let tok: Tokens;
const api: Ambiente['api'] = (...a) => amb.api(...a);

describe('concorrência e transações', () => {
  // A fila do café na CBI é um excelente teste de concorrência: todo mundo quer o primeiro, só um consegue.
  before(async () => {
    amb = await criarAmbiente();
  });
  after(() => amb.encerrar());

  it('dois provisionamentos simultâneos: só um vira admin (os outros recebem 409)', async () => {
    const rs = await Promise.all(['ana', 'bia', 'caio', 'duda'].map((u) => api('POST', '/auth/provisionar', undefined, { username: u, senha: SENHA })));
    assert.deepEqual(rs.map((r) => r.statusCode).sort(), [201, 409, 409, 409]);
    assert.equal(await amb.prisma.usuario.count(), 1);
    // o vencedor é desconhecido para a suíte: limpa os usuários e provisiona o admin de sempre
    await amb.prisma.$executeRawUnsafe('TRUNCATE "Auditoria", "Usuario" CASCADE'); // TRUNCATE não dispara os triggers de linha
    tok = await amb.usuariosBase();
  });

  it('dez atualizações simultâneas da mesma organização com a mesma versão: exatamente uma vence', async () => {
    const cnpj = await amb.orgComContrato(tok.admin, '210000000001');
    const antes = (await api('GET', `/organizacoes/${cnpj}`, tok.admin)).json();
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => api('PATCH', `/organizacoes/${cnpj}`, tok.cad, { razaoSocial: `Disputa ${i}`, versao: antes.versao })));
    const status = rs.map((r) => r.statusCode);
    assert.equal(status.filter((s) => s === 200).length, 1, `status: ${status}`);
    assert.equal(status.filter((s) => s === 409).length, 9, `status: ${status}`);
    assert.equal((await api('GET', `/organizacoes/${cnpj}`, tok.admin)).json().versao, antes.versao + 1); // uma só alteração aconteceu
  });

  it('doze cadastros simultâneos no mesmo lote: posições 1..12, sem buraco e sem repetição', async () => {
    const cnpj = await amb.orgComContrato(tok.admin, '210000000002');
    const { lote } = await amb.novoLote(tok.alm, cnpj, 'NF-FILA');
    const rs = await Promise.all(Array.from({ length: 12 }, () => api('POST', '/equipamentos', tok.alm, { loteId: lote.id, tipo: 'cpu' })));
    assert.ok(rs.every((r) => r.statusCode === 201), rs.map((r) => r.statusCode).join());
    const posicoes = rs.map((r) => r.json().posicao).sort((a: number, b: number) => a - b);
    assert.deepEqual(posicoes, Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it('seis triagens simultâneas no mesmo lote: o status do lote termina certo (unanimidade vira triagem_completa)', async () => {
    const cnpj = await amb.orgComContrato(tok.admin, '210000000003');
    const { lote, equipamentos } = await amb.novoLote(tok.alm, cnpj, 'NF-JURI', ['cpu', 'cpu', 'cpu', 'monitor', 'monitor', 'terminal']);
    const rs = await Promise.all(equipamentos.map((e) => api('POST', `/equipamentos/${e.id}/triagem`, tok.alm)));
    assert.ok(rs.every((r) => r.statusCode === 200), rs.map((r) => r.statusCode).join());
    assert.equal((await api('GET', `/lotes/${lote.id}`, tok.alm)).json().status, 'triagem_completa');
  });

  it('cinco lotes simultâneos com a mesma NF na mesma organização: um nasce, quatro levam 409', async () => {
    const cnpj = await amb.orgComContrato(tok.admin, '210000000004');
    const rs = await Promise.all(Array.from({ length: 5 }, () => api('POST', '/lotes', tok.cad, { orgCnpj: cnpj, nf: 'NF-UNICA', transportadora: 'T', dataEntrada: dia(0) })));
    assert.deepEqual(rs.map((r) => r.statusCode).sort(), [201, 409, 409, 409, 409]);
    assert.equal(await amb.prisma.lote.count({ where: { nf: 'NF-UNICA' } }), 1);
  });

  it('a mesma NF em organizações diferentes é permitida', async () => {
    const a = await amb.orgComContrato(tok.admin, '210000000005');
    const b = await amb.orgComContrato(tok.admin, '210000000006');
    await amb.novoLote(tok.cad, a, 'NF-REPETIDA');
    await amb.novoLote(tok.cad, b, 'NF-REPETIDA');
  });

  it('transação desfaz tudo: erro no meio não deixa rastro (nem lote pela metade)', async () => {
    const { transacao } = await import('../src/db');
    const antes = await amb.prisma.organizacao.count();
    await assert.rejects(
      transacao(async (tx) => {
        await tx.organizacao.create({ data: { cnpj: '99999999999999', razaoSocial: 'Fantasma' } });
        throw new Error('algo deu errado no meio do truque');
      }),
      /meio do truque/,
    );
    assert.equal(await amb.prisma.organizacao.count(), antes);
  });

  it('conflito de versão numa transição desfaz também a movimentação e a auditoria daquela tentativa', async () => {
    const cnpj = await amb.orgComContrato(tok.admin, '210000000007');
    const { equipamentos } = await amb.novoLote(tok.alm, cnpj, 'NF-ROLLBACK', ['cpu']);
    const [movs, auds] = [await amb.prisma.movimentacao.count(), await amb.prisma.auditoria.count({ where: { acao: 'EQUIPAMENTO_TRIAGEM_COMPLETA' } })];
    assert.equal((await api('POST', `/equipamentos/${equipamentos[0].id}/triagem`, tok.alm, { versao: 99 })).statusCode, 409);
    assert.equal(await amb.prisma.movimentacao.count(), movs);
    assert.equal(await amb.prisma.auditoria.count({ where: { acao: 'EQUIPAMENTO_TRIAGEM_COMPLETA' } }), auds);
    assert.equal((await amb.prisma.equipamento.findUniqueOrThrow({ where: { id: equipamentos[0].id } })).triagemCompleta, false);
  });

  it('mover e apagar equipamentos ao mesmo tempo: o lote nunca fica com status incoerente', async () => {
    const cnpj = await amb.orgComContrato(tok.admin, '210000000008');
    const { lote, equipamentos } = await amb.novoLote(tok.alm, cnpj, 'NF-CORRIDA', ['cpu', 'cpu', 'cpu', 'cpu']);
    await Promise.all([
      api('POST', `/equipamentos/${equipamentos[0].id}/triagem`, tok.alm),
      api('POST', `/equipamentos/${equipamentos[1].id}/triagem`, tok.alm),
      api('DELETE', `/equipamentos/${equipamentos[2].id}`, tok.alm),
      api('POST', `/equipamentos/${equipamentos[3].id}/triagem`, tok.alm),
    ]);
    const restantes = await amb.prisma.equipamento.findMany({ where: { loteId: lote.id } });
    assert.equal(restantes.length, 3);
    assert.ok(restantes.every((e) => e.status === 'triado'));
    assert.equal((await amb.prisma.lote.findUniqueOrThrow({ where: { id: lote.id } })).status, 'triagem_completa');
  });
});
