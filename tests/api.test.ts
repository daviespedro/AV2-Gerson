// O espetáculo principal: a API de ponta a ponta, caminho feliz e caminho da mentira, contra um PostgreSQL de verdade.
// Banco temporário criado e apagado sozinho (ver helpers/ambiente.ts). Eu acredito em quem prova, não em quem promete.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { Ambiente, cnpjValido, criarAmbiente, dia, SENHA } from './helpers/ambiente';

let amb: Ambiente;
let app: FastifyInstance;
let prisma: PrismaClient;
const tok: Record<string, string> = {};
const api: Ambiente['api'] = (...a) => amb.api(...a);
const login: Ambiente['login'] = (...a) => amb.login(...a);

describe('API greencode', () => {
  // Easter egg nº 8: confio em quem prova, não em quem promete. Cada teste aqui é uma prova.
  before(async () => {
    amb = await criarAmbiente();
    app = amb.app;
    prisma = amb.prisma;
  });
  after(() => amb.encerrar());

  describe('autenticação e provisionamento', () => {
    it('health é público', async () => assert.equal((await api('GET', '/health')).statusCode, 200));
    it('sem token -> 401', async () => assert.equal((await api('GET', '/usuarios')).statusCode, 401));
    it('token adulterado -> 401', async () => assert.equal((await api('GET', '/usuarios', 'x.y.z')).statusCode, 401));
    it('provisionar: senha fraca 400, ok 201, segunda vez 409', async () => {
      assert.equal((await api('POST', '/auth/provisionar', undefined, { username: 'admin', senha: 'fraca' })).statusCode, 400);
      assert.equal((await api('POST', '/auth/provisionar', undefined, { username: 'admin', senha: SENHA })).statusCode, 201);
      assert.equal((await api('POST', '/auth/provisionar', undefined, { username: 'outro', senha: SENHA })).statusCode, 409);
    });
    it('login: senha errada e usuário inexistente dão a mesma resposta 401', async () => {
      const a = await api('POST', '/auth/login', undefined, { username: 'admin', senha: 'Errada#1234' });
      const b = await api('POST', '/auth/login', undefined, { username: 'fantasma', senha: 'Errada#1234' });
      assert.equal(a.statusCode, 401);
      assert.deepEqual(a.json(), b.json());
    });
    it('login ok devolve token e /auth/me responde', async () => {
      tok.admin = await login('admin');
      assert.ok(tok.admin);
      assert.equal((await api('GET', '/auth/me', tok.admin)).json().papel, 'admin');
    });
  });

  describe('usuários e papéis (RBAC)', () => {
    it('admin cria um usuário por papel; duplicado 409; senha fraca 400; papel inválido 400', async () => {
      for (const [u, p] of [['cadastro1', 'cadastro'], ['almox1', 'almoxarifado'], ['auditor1', 'auditor']]) {
        assert.equal((await api('POST', '/usuarios', tok.admin, { username: u, senha: SENHA, papel: p })).statusCode, 201);
      }
      assert.equal((await api('POST', '/usuarios', tok.admin, { username: 'almox1', senha: SENHA, papel: 'admin' })).statusCode, 409);
      assert.equal((await api('POST', '/usuarios', tok.admin, { username: 'novo1', senha: 'fraca', papel: 'admin' })).statusCode, 400);
      assert.equal((await api('POST', '/usuarios', tok.admin, { username: 'novo2', senha: SENHA, papel: 'chefe' })).statusCode, 400);
      tok.cad = await login('cadastro1');
      tok.alm = await login('almox1');
      tok.aud = await login('auditor1');
    });
    it('só o admin vê a lista de usuários (senhaHash nunca aparece)', async () => {
      for (const t of [tok.cad, tok.alm, tok.aud]) assert.equal((await api('GET', '/usuarios', t)).statusCode, 403);
      const r = await api('GET', '/usuarios', tok.admin);
      assert.equal(r.statusCode, 200);
      assert.ok(!JSON.stringify(r.json()).includes('senhaHash'));
      assert.equal(r.json().total, 4);
    });
    it('matriz de papéis: organizações, lotes e equipamentos', async () => {
      assert.equal((await api('GET', '/organizacoes', tok.alm)).statusCode, 403);
      assert.equal((await api('GET', '/organizacoes', tok.aud)).statusCode, 200);
      assert.equal((await api('GET', '/lotes', tok.alm)).statusCode, 200);
      assert.equal((await api('GET', '/equipamentos', tok.cad)).statusCode, 403);
    });
    it('auditor é somente leitura, mas pode trocar a própria senha', async () => {
      const body = { cnpj: cnpjValido('990000000001'), razaoSocial: 'X' };
      assert.equal((await api('POST', '/organizacoes', tok.aud, body)).statusCode, 403);
      assert.equal((await api('POST', '/auth/senha', tok.aud, { senhaAtual: SENHA, novaSenha: 'NovaSenha#2026' })).statusCode, 204);
      assert.equal((await api('POST', '/auth/senha', tok.aud, { senhaAtual: 'errada', novaSenha: 'Outra#12345' })).statusCode, 401);
      await api('POST', '/auth/senha', tok.aud, { senhaAtual: 'NovaSenha#2026', novaSenha: SENHA });
    });
  });

  describe('organização, contrato e lote', () => {
    const cnpj = cnpjValido('112223330001');
    const org: { versao?: number } = {};
    let lote: any;

    it('CNPJ inválido 400; criar 201; duplicado 409; consulta com máscara', async () => {
      assert.equal((await api('POST', '/organizacoes', tok.cad, { cnpj: '11222333000182', razaoSocial: 'X' })).statusCode, 400);
      const r = await api('POST', '/organizacoes', tok.cad, { cnpj, razaoSocial: 'Tech Ltda' });
      assert.equal(r.statusCode, 201);
      org.versao = r.json().versao;
      assert.equal((await api('POST', '/organizacoes', tok.cad, { cnpj, razaoSocial: 'Dup' })).statusCode, 409);
      const mascara = encodeURIComponent(cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'));
      assert.equal((await api('GET', `/organizacoes/${mascara}`, tok.cad)).json().cnpj, cnpj);
    });

    it('sem contrato a organização não recebe lote (e continua ativa)', async () => {
      const r = await api('POST', '/lotes', tok.cad, { orgCnpj: cnpj, nf: 'NF-1', transportadora: 'T' });
      assert.equal(r.statusCode, 409);
      assert.equal((await api('GET', `/organizacoes/${cnpj}`, tok.cad)).json().ativo, true);
    });

    it('contrato: frequência 0 e data inválida 400; criar 201; segundo 409', async () => {
      const base = { orgCnpj: cnpj, dataInicio: dia(-10), frequenciaColetaDias: 30 };
      assert.equal((await api('POST', '/contratos', tok.cad, { ...base, frequenciaColetaDias: 0 })).statusCode, 400);
      assert.equal((await api('POST', '/contratos', tok.cad, { ...base, dataInicio: '2026-02-31' })).statusCode, 400);
      assert.equal((await api('POST', '/contratos', tok.cad, base)).statusCode, 201);
      assert.equal((await api('POST', '/contratos', tok.cad, base)).statusCode, 409);
    });

    it('lote: data futura e >90 dias 400; cadastro não cria equipamentos (403)', async () => {
      const base = { orgCnpj: cnpj, nf: 'NF-A', transportadora: 'TransVerde' };
      assert.equal((await api('POST', '/lotes', tok.cad, { ...base, dataEntrada: dia(1) })).statusCode, 400);
      assert.equal((await api('POST', '/lotes', tok.cad, { ...base, dataEntrada: dia(-91) })).statusCode, 400);
      assert.equal((await api('POST', '/lotes', tok.cad, { ...base, equipamentos: [{ tipo: 'cpu' }] })).statusCode, 403);
    });

    it('lote com equipamentos numa transação: posições 1..3 e código de barras = id', async () => {
      const r = await api('POST', '/lotes', tok.alm, {
        orgCnpj: cnpj, nf: 'NF-B', transportadora: 'TransVerde', dataEntrada: dia(-5),
        equipamentos: [{ tipo: 'Terminal' }, { tipo: 'CPU' }, { tipo: 'Servidor' }],
      });
      assert.equal(r.statusCode, 201);
      lote = r.json();
      assert.deepEqual(lote.equipamentos.map((e: any) => e.posicao), [1, 2, 3]);
      for (const e of lote.equipamentos) assert.equal(e.codigoBarrasInterno, e.id);
      assert.equal(lote.lote.status, 'recebido');
    });

    it('tipo vazio no meio: rejeitado e o lote inteiro não é gravado', async () => {
      const r = await api('POST', '/lotes', tok.alm, { orgCnpj: cnpj, nf: 'NF-ROLL', transportadora: 'T', equipamentos: [{ tipo: 'cpu' }, { tipo: '  ' }] });
      assert.equal(r.statusCode, 400);
      assert.equal(await prisma.lote.count({ where: { nf: 'NF-ROLL' } }), 0);
    });

    it('NF duplicada na mesma organização 409', async () => {
      assert.equal((await api('POST', '/lotes', tok.cad, { orgCnpj: cnpj, nf: 'NF-B', transportadora: 'T' })).statusCode, 409);
    });

    it('posição segue sequencial em cadastros avulsos e simultâneos', async () => {
      const id = lote.lote.id;
      const rs = await Promise.all([1, 2, 3].map(() => api('POST', '/equipamentos', tok.alm, { loteId: id, tipo: 'Monitor' })));
      assert.ok(rs.every((r) => r.statusCode === 201));
      const posicoes = rs.map((r) => r.json().posicao).sort();
      assert.deepEqual(posicoes, [4, 5, 6]);
    });

    it('edição do lote: NF; status não é editável (400)', async () => {
      const id = lote.lote.id;
      const r = await api('PATCH', `/lotes/${id}`, tok.cad, { transportadora: 'Nova' });
      assert.equal(r.statusCode, 200);
      assert.equal((await api('PATCH', `/lotes/${id}`, tok.cad, { status: 'encerrado' })).statusCode, 400);
    });

    it('versão otimista: versão velha 409; duas atualizações simultâneas, uma vence', async () => {
      const a = await api('PATCH', `/organizacoes/${cnpj}`, tok.cad, { razaoSocial: 'Tech 2', versao: org.versao });
      assert.equal(a.statusCode, 200);
      assert.equal((await api('PATCH', `/organizacoes/${cnpj}`, tok.cad, { razaoSocial: 'Velha', versao: org.versao })).statusCode, 409);
      const v = a.json().versao;
      const rs = await Promise.all(['A', 'B'].map((n) => api('PATCH', `/organizacoes/${cnpj}`, tok.cad, { razaoSocial: n, versao: v })));
      assert.deepEqual(rs.map((r) => r.statusCode).sort(), [200, 409]);
    });

    describe('equipamentos e status derivado do lote', () => {
      it('desmonte sem triagem 400; triagem -> triado; desmonte ok; movimentações registradas', async () => {
        const [terminal] = lote.equipamentos;
        assert.equal((await api('PATCH', `/equipamentos/${terminal.id}/status`, tok.alm, { status: 'desmonte' })).statusCode, 400);
        const t = await api('POST', `/equipamentos/${terminal.id}/triagem`, tok.alm);
        assert.equal(t.json().status, 'triado');
        assert.equal((await api('PATCH', `/equipamentos/${terminal.id}/status`, tok.alm, { status: 'desmonte' })).statusCode, 200);
        const h = (await api('GET', `/rastreio/${terminal.id}`, tok.aud)).json();
        assert.equal(h.movimentacoes.length, 2);
      });

      it('queda de 2+ categorias exige justificativa', async () => {
        const [, cpu] = lote.equipamentos;
        assert.equal((await api('PATCH', `/equipamentos/${cpu.id}/estado`, tok.alm, { estadoFisico: 'regular' })).statusCode, 400);
        const r = await api('PATCH', `/equipamentos/${cpu.id}/estado`, tok.alm, { estadoFisico: 'regular', justificativa: 'desgaste' });
        assert.equal(r.statusCode, 200);
        assert.equal((await api('PATCH', `/equipamentos/${cpu.id}/estado`, tok.alm, { estadoFisico: 'inexistente' })).statusCode, 400);
      });

      it('lote só muda quando TODOS os equipamentos têm o mesmo status', async () => {
        const novo = (await api('POST', '/lotes', tok.alm, { orgCnpj: cnpj, nf: 'NF-C', transportadora: 'T', equipamentos: [{ tipo: 'cpu' }, { tipo: 'cpu' }] })).json();
        const [e1, e2] = novo.equipamentos;
        await api('POST', `/equipamentos/${e1.id}/triagem`, tok.alm);
        assert.equal((await api('GET', `/lotes/${novo.lote.id}`, tok.alm)).json().status, 'recebido');
        await api('POST', `/equipamentos/${e2.id}/triagem`, tok.alm);
        assert.equal((await api('GET', `/lotes/${novo.lote.id}`, tok.alm)).json().status, 'triagem_completa');
        await api('PATCH', `/equipamentos/${e1.id}/status`, tok.alm, { status: 'reciclagem' });
        await api('PATCH', `/equipamentos/${e2.id}/status`, tok.alm, { status: 'revenda' });
        assert.equal((await api('GET', `/lotes/${novo.lote.id}`, tok.alm)).json().status, 'encerrado');
        assert.equal((await api('POST', '/equipamentos', tok.alm, { loteId: novo.lote.id, tipo: 'cpu' })).statusCode, 400); // lote encerrado
      });

      it('depreciação por tipo; tipo corrigido muda a curva', async () => {
        const [, cpu, servidor] = lote.equipamentos;
        assert.equal((await api('GET', `/equipamentos/${cpu.id}/depreciacao?meses=12`, tok.aud)).json().coeficiente, 0.5);
        assert.equal((await api('GET', `/equipamentos/${servidor.id}/depreciacao?meses=1000`, tok.aud)).json().coeficiente, 0.85);
        assert.equal((await api('GET', `/equipamentos/${cpu.id}/depreciacao`, tok.aud)).statusCode, 400);
        const r = await api('PATCH', `/equipamentos/${cpu.id}`, tok.alm, { tipo: 'Monitor' });
        assert.equal(r.json().tipo, 'monitor');
        assert.equal((await api('GET', `/equipamentos/${cpu.id}/depreciacao?meses=30`, tok.aud)).json().coeficiente, 0.5);
      });

      it('conflito de versão em transição de equipamento -> 409 e nada é gravado', async () => {
        const [, , servidor] = lote.equipamentos;
        const antes = await prisma.movimentacao.count();
        const r = await api('POST', `/equipamentos/${servidor.id}/triagem`, tok.alm, { versao: 99 });
        assert.equal(r.statusCode, 409);
        assert.equal(await prisma.movimentacao.count(), antes);
      });
    });

    it('ações aceitam corpo opcional: sem corpo, {} e { versao } válida; versão inválida 400', async () => {
      const [e] = (await amb.novoLote(tok.alm, cnpj, 'NF-OPC', ['cpu'])).equipamentos;
      assert.equal((await api('POST', `/equipamentos/${e.id}/triagem`, tok.alm)).statusCode, 200); // sem corpo nenhum
      const f = (await amb.novoLote(tok.alm, cnpj, 'NF-OPC2', ['cpu'])).equipamentos[0];
      assert.equal((await api('POST', `/equipamentos/${f.id}/triagem`, tok.alm, {})).statusCode, 200);
      const g = (await amb.novoLote(tok.alm, cnpj, 'NF-OPC3', ['cpu'])).equipamentos[0];
      assert.equal((await api('POST', `/equipamentos/${g.id}/triagem`, tok.alm, { versao: 0 })).statusCode, 400);
      assert.equal((await api('POST', `/equipamentos/${g.id}/triagem`, tok.alm, { versao: g.versao })).statusCode, 200);
    });

    describe('contrato: encerrar, reativar, apagar', () => {
      it('contrato encerrado bloqueia lotes; reativar libera; apagar bloqueia de novo (org segue ativa)', async () => {
        const c = (await api('GET', `/organizacoes/${cnpj}`, tok.cad)).json().contrato;
        const novoLote = (nf: string) => api('POST', '/lotes', tok.cad, { orgCnpj: cnpj, nf, transportadora: 'T' });
        assert.equal((await api('POST', `/contratos/${c.id}/encerrar`, tok.cad)).statusCode, 200);
        assert.equal((await api('POST', `/contratos/${c.id}/encerrar`, tok.cad)).statusCode, 409);
        assert.equal((await novoLote('NF-D')).statusCode, 409);
        assert.equal((await api('POST', `/contratos/${c.id}/reativar`, tok.cad)).statusCode, 200);
        assert.equal((await novoLote('NF-D')).statusCode, 201);
        assert.equal((await api('DELETE', `/contratos/${c.id}`, tok.cad)).statusCode, 204);
        assert.equal((await novoLote('NF-E')).statusCode, 409);
        assert.equal((await api('GET', `/organizacoes/${cnpj}`, tok.cad)).json().ativo, true);
        await api('POST', '/contratos', tok.cad, { orgCnpj: cnpj, dataInicio: dia(-1), frequenciaColetaDias: 7 });
      });
    });

    describe('soft delete em cadeia, reativação e delete permanente', () => {
      it('inativar a organização inativa lotes; equipamentos somem; reativar traz de volta só os lotes inativados junto', async () => {
        const eqId = lote.equipamentos[0].id;
        const r = await api('DELETE', `/organizacoes/${cnpj}`, tok.cad);
        assert.equal(r.statusCode, 200);
        assert.ok(r.json().lotesInativados >= 3);
        assert.equal((await api('GET', `/lotes/${lote.lote.id}`, tok.cad)).json().ativo, false);
        assert.equal((await api('GET', `/equipamentos/${eqId}`, tok.alm)).statusCode, 404);
        const lista = (await api('GET', '/lotes', tok.cad)).json();
        assert.ok(!lista.itens.some((l: any) => l.id === lote.lote.id));
        assert.equal((await api('POST', '/lotes', tok.cad, { orgCnpj: cnpj, nf: 'NF-Z', transportadora: 'T' })).statusCode, 409);
        assert.equal((await api('DELETE', `/organizacoes/${cnpj}`, tok.cad)).statusCode, 409);

        const re = await api('POST', `/organizacoes/${cnpj}/reativar`, tok.cad);
        assert.equal(re.statusCode, 200);
        assert.ok(re.json().lotesReativados >= 3);
        assert.equal((await api('GET', `/equipamentos/${eqId}`, tok.alm)).statusCode, 200);
        assert.equal((await api('POST', `/organizacoes/${cnpj}/reativar`, tok.cad)).statusCode, 409);
      });

      it('lote inativado sozinho não volta com a organização; reativar o lote direto funciona', async () => {
        assert.equal((await api('DELETE', `/lotes/${lote.lote.id}`, tok.cad)).statusCode, 200);
        await api('DELETE', `/organizacoes/${cnpj}`, tok.cad);
        await api('POST', `/organizacoes/${cnpj}/reativar`, tok.cad);
        assert.equal((await api('GET', `/lotes/${lote.lote.id}`, tok.cad)).json().ativo, false);
        assert.equal((await api('POST', `/lotes/${lote.lote.id}/reativar`, tok.cad)).statusCode, 200);
      });

      it('delete permanente: só admin; apaga em cascata (lotes, equipamentos, movimentações, contrato)', async () => {
        assert.equal((await api('DELETE', `/organizacoes/${cnpj}?permanente=true`, tok.cad)).statusCode, 403);
        assert.equal((await api('DELETE', `/organizacoes/${cnpj}?permanente=true`, tok.admin)).statusCode, 204);
        assert.equal((await api('GET', `/organizacoes/${cnpj}`, tok.admin)).statusCode, 404);
        assert.equal(await prisma.lote.count(), 0);
        assert.equal(await prisma.equipamento.count(), 0);
        assert.equal(await prisma.movimentacao.count(), 0);
        assert.equal(await prisma.contrato.count(), 0);
      });
    });
  });

  describe('usuários: desativar, excluir e sessão', () => {
    it('conta desativada perde o acesso na hora (mesmo com token válido) e não loga mais', async () => {
      const u = (await api('POST', '/usuarios', tok.admin, { username: 'temp1', senha: SENHA, papel: 'cadastro' })).json();
      const t = await login('temp1');
      assert.equal((await api('GET', '/organizacoes', t)).statusCode, 200);
      assert.equal((await api('DELETE', `/usuarios/${u.id}`, tok.admin)).statusCode, 204);
      assert.equal((await api('GET', '/organizacoes', t)).statusCode, 401);
      assert.equal((await api('POST', '/auth/login', undefined, { username: 'temp1', senha: SENHA })).statusCode, 401);
    });
    it('papel alterado vale imediatamente; ninguém altera o próprio papel nem se desativa', async () => {
      const lista = (await api('GET', '/usuarios', tok.admin)).json().itens;
      const cad = lista.find((x: any) => x.username === 'cadastro1');
      const eu = lista.find((x: any) => x.username === 'admin');
      assert.equal((await api('PATCH', `/usuarios/${eu.id}/papel`, tok.admin, { papel: 'auditor' })).statusCode, 400);
      assert.equal((await api('PATCH', `/usuarios/${eu.id}/ativo`, tok.admin, { ativo: false })).statusCode, 400);
      assert.equal((await api('PATCH', `/usuarios/${cad.id}/papel`, tok.admin, { papel: 'auditor' })).statusCode, 200);
      assert.equal((await api('POST', '/organizacoes', tok.cad, { cnpj: cnpjValido('880000000001'), razaoSocial: 'Y' })).statusCode, 403);
      await api('PATCH', `/usuarios/${cad.id}/papel`, tok.admin, { papel: 'cadastro' });
    });
    it('usuário com histórico não pode ser excluído de vez (409); sem histórico pode', async () => {
      const lista = (await api('GET', '/usuarios', tok.admin)).json().itens;
      const alm = lista.find((x: any) => x.username === 'almox1');
      const c = cnpjValido('550000000001'); // dá ao almox1 um histórico que sobrevive (lote atual)
      await api('POST', '/organizacoes', tok.admin, { cnpj: c, razaoSocial: 'Hist' });
      await api('POST', '/contratos', tok.admin, { orgCnpj: c, dataInicio: dia(-1), frequenciaColetaDias: 7 });
      assert.equal((await api('POST', '/lotes', tok.alm, { orgCnpj: c, nf: 'NF-H', transportadora: 'T' })).statusCode, 201);
      assert.equal((await api('DELETE', `/usuarios/${alm.id}?permanente=true`, tok.admin)).statusCode, 409);
      const novo = (await api('POST', '/usuarios', tok.admin, { username: 'limpo1', senha: SENHA, papel: 'auditor' })).json();
      assert.equal((await api('DELETE', `/usuarios/${novo.id}?permanente=true`, tok.admin)).statusCode, 204);
    });
    it('renomear, redefinir senha e conflito de nome', async () => {
      const u = (await api('POST', '/usuarios', tok.admin, { username: 'ren1', senha: SENHA, papel: 'auditor' })).json();
      assert.equal((await api('PATCH', `/usuarios/${u.id}/username`, tok.admin, { username: 'admin' })).statusCode, 409);
      assert.equal((await api('PATCH', `/usuarios/${u.id}/username`, tok.admin, { username: 'ren2' })).statusCode, 200);
      assert.equal((await api('PATCH', `/usuarios/${u.id}/senha`, tok.admin, { novaSenha: 'Outra#12345' })).statusCode, 204);
      assert.ok(await login('ren2', 'Outra#12345'));
    });
  });

  describe('config global e auditoria', () => {
    it('só admin gerencia parâmetros; criar, versionar, conflito e apagar', async () => {
      assert.equal((await api('PUT', '/config/aliquota_icms', tok.cad, { valor: '0.18' })).statusCode, 403);
      const c = await api('PUT', '/config/aliquota_icms', tok.admin, { valor: '0.18' });
      assert.equal(c.json().versao, 1);
      assert.equal((await api('PUT', '/config/aliquota_icms', tok.admin, { valor: '0.20', versao: 1 })).json().versao, 2);
      assert.equal((await api('PUT', '/config/aliquota_icms', tok.admin, { valor: '0.25', versao: 1 })).statusCode, 409);
      assert.equal((await api('PUT', '/config/chave invalida!', tok.admin, { valor: 'x' })).statusCode, 400);
      assert.equal((await api('GET', '/config/aliquota_icms', tok.admin)).json().valor, '0.20');
      assert.equal((await api('DELETE', '/config/aliquota_icms', tok.admin)).statusCode, 204);
      assert.equal((await api('GET', '/config/aliquota_icms', tok.admin)).statusCode, 404);
    });
    it('auditoria: admin e auditor leem (paginado, filtrável); almoxarifado não', async () => {
      assert.equal((await api('GET', '/auditoria', tok.alm)).statusCode, 403);
      const r = (await api('GET', '/auditoria?acao=LOTE_CRIADO&tamanhoPagina=2', tok.aud)).json();
      assert.ok(r.total >= 3 && r.itens.length <= 2 && r.totalPaginas >= 2);
      assert.ok(r.itens.every((a: any) => a.acao === 'LOTE_CRIADO'));
      assert.equal((await api('GET', '/auditoria?tamanhoPagina=101', tok.admin)).statusCode, 400);
    });
  });

  describe('restrições e triggers do banco (última barreira)', () => {
    let eqId: string;
    before(async () => {
      const cnpj = cnpjValido('770000000001');
      await api('POST', '/organizacoes', tok.admin, { cnpj, razaoSocial: 'BD' });
      await api('POST', '/contratos', tok.admin, { orgCnpj: cnpj, dataInicio: dia(-1), frequenciaColetaDias: 7 });
      const l = (await api('POST', '/lotes', tok.admin, { orgCnpj: cnpj, nf: 'NF-BD', transportadora: 'T', equipamentos: [{ tipo: 'cpu' }] })).json();
      eqId = l.equipamentos[0].id;
      await api('POST', `/equipamentos/${eqId}/triagem`, tok.admin);
    });
    it('movimentação e auditoria são imutáveis', async () => {
      await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "Movimentacao" SET "justificativa" = 'x'`), /imutavel/);
      await assert.rejects(prisma.$executeRawUnsafe(`DELETE FROM "Movimentacao"`), /imutavel/);
      await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "Auditoria" SET "acao" = 'x'`), /imutavel/);
    });
    it('CHECKs: código de barras = id, desmonte exige triagem, CNPJ e posição', async () => {
      await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "Equipamento" SET "codigoBarrasInterno" = 'outro' WHERE id = '${eqId}'::uuid`), /check/i);
      await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "Equipamento" SET "status" = 'desmonte', "triagemCompleta" = false WHERE id = '${eqId}'::uuid`), /check/i);
      await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "Equipamento" SET "posicao" = 0 WHERE id = '${eqId}'::uuid`), /check/i);
      await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "Organizacao" SET "cnpj" = '123'`), /check/i);
    });
  });

  describe('erros gerais', () => {
    it('rota inexistente 404, id mal formado 400, JSON inválido 400', async () => {
      assert.equal((await api('GET', '/nao-existe', tok.admin)).statusCode, 404);
      assert.equal((await api('GET', '/lotes/abc', tok.admin)).statusCode, 400);
      const r = await app.inject({ method: 'POST', url: '/api/v1/organizacoes', payload: '{quebrado', headers: { authorization: `Bearer ${tok.admin}`, 'content-type': 'application/json' } });
      assert.equal(r.statusCode, 400);
    });
    it('campo extra no corpo 400 (additionalProperties: false)', async () => {
      assert.equal((await api('POST', '/organizacoes', tok.admin, { cnpj: cnpjValido('660000000001'), razaoSocial: 'Z', hack: 1 })).statusCode, 400);
    });
    it('o Swagger está no ar e é público', async () => assert.equal((await app.inject({ method: 'GET', url: '/docs/json' })).statusCode, 200));
  });
});
