// O seed é a história de abertura do sistema. Aqui eu o executo de verdade (o mesmo comando do README),
// duas vezes, para provar que a segunda vez ele finge que não viu nada. E depois conto o que ficou no palco.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Ambiente, criarAmbiente, URL_TESTE } from './helpers/ambiente';

const RAIZ = resolve(__dirname, '..');
let amb: Ambiente;
const api: Ambiente['api'] = (...a) => amb.api(...a);
const SENHA_SEED = 'Greencode#2026';
const rodarSeed = () => execSync('npx tsx src/seed.ts', { cwd: RAIZ, env: { ...process.env, DATABASE_URL: URL_TESTE, SEED_SENHA: SENHA_SEED }, encoding: 'utf8' });

describe('seed de dados', () => {
  // O seed conta a história de abertura. Eu conto de novo para conferir se ele não mudou o final.
  let saida1: string;
  before(async () => {
    amb = await criarAmbiente();
    saida1 = rodarSeed();
  });
  after(() => amb.encerrar());

  it('roda e conta o que criou', () => assert.match(saida1, /Seed concluído/));

  it('é idempotente: a segunda execução não duplica nada', async () => {
    const antes = await amb.prisma.usuario.count();
    assert.match(rodarSeed(), /Seed ignorado/);
    assert.equal(await amb.prisma.usuario.count(), antes);
  });

  it('cria um usuário por papel e todos conseguem entrar', async () => {
    for (const u of ['admin', 'cadastro1', 'almox1', 'auditor1']) assert.ok(await amb.login(u, SENHA_SEED), u);
  });

  it('massa representativa: organizações, contratos, lotes e equipamentos em estados variados', async () => {
    const p = amb.prisma;
    assert.equal(await p.organizacao.count(), 4);
    assert.equal(await p.contrato.count(), 4);
    assert.equal(await p.lote.count(), 4);
    assert.equal(await p.equipamento.count(), 9);
    const status = new Set((await p.equipamento.findMany({ select: { status: true } })).map((e) => e.status));
    for (const s of ['aguardando_triagem', 'triado', 'desmonte', 'reciclagem', 'descarte_seguro', 'revenda']) assert.ok(status.has(s as any), s);
    assert.ok((await p.movimentacao.count()) >= 8);
    assert.equal((await p.parametroGlobal.findUniqueOrThrow({ where: { chave: 'aliquota_icms' } })).valor, '0.18');
  });

  it('cenários de validação refletidos: contrato encerrado, lote 1 sem status único, lote 2 unânime, organização inativa em cadeia', async () => {
    const p = amb.prisma;
    assert.equal(await p.contrato.count({ where: { ativo: false } }), 1);
    const lotes = await p.lote.findMany({ include: { organizacao: true } });
    const por = (nf: string) => lotes.find((l) => l.nf === nf)!;
    assert.equal(por('NF-0001').status, 'recebido'); // a impressora ficou aguardando: sem unanimidade
    assert.equal(por('NF-0002').status, 'triagem_completa'); // todos triados: unanimidade
    assert.equal(por('NF-0004').ativo, false); // inativado junto com a organização
    assert.equal(por('NF-0004').organizacao.ativo, false);
  });

  it('a API enxerga o seed: listagens escondem os inativos, e "incluirInativos" mostra', async () => {
    const t = await amb.login('admin', SENHA_SEED);
    assert.equal((await api('GET', '/organizacoes', t)).json().total, 3);
    assert.equal((await api('GET', '/organizacoes?incluirInativos=true', t)).json().total, 4);
    assert.equal((await api('GET', '/lotes', t)).json().total, 3);
    assert.equal((await api('GET', '/lotes?incluirInativos=true', t)).json().total, 4);
  });

  it('o seed deixa trilha de auditoria (inclusive a inativação em cadeia)', async () => {
    assert.ok((await amb.prisma.auditoria.count({ where: { acao: 'ORG_INATIVADA' } })) >= 1);
    assert.ok((await amb.prisma.auditoria.count({ where: { acao: 'LOTE_CRIADO' } })) >= 4);
  });
});
