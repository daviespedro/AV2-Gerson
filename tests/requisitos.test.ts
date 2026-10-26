// A prova dos nove: cada exigência do PDF da AV2 e cada resposta do professor (PDF de dúvidas) vira um teste.
// Se o professor perguntar "onde está isso?", a resposta é o nome do teste. Eu gosto de respostas verificáveis.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ambiente, cnpjValido, criarAmbiente, dia, ID_FANTASMA, Tokens } from './helpers/ambiente';

const RAIZ = resolve(__dirname, '..');
let amb: Ambiente;
let tok: Tokens;
const api: Ambiente['api'] = (...a) => amb.api(...a);

describe('requisitos', () => {
  // Cada exigência do professor vira um teste. Se ele perguntar 'onde está isso?', eu aponto o nome do teste e tomo meu chá.
  before(async () => {
    amb = await criarAmbiente();
    tok = await amb.usuariosBase();
  });
  after(() => amb.encerrar());

  describe('requisitos da AV2 (PDF da atividade)', () => {
    it('arquitetura em camadas: todo módulo tem controller, service e repository', () => {
      const modulos = readdirSync(resolve(RAIZ, 'src/modules'));
      const comNegocio = modulos.filter((m) => !['auth', 'auditoria'].includes(m)); // auth: sem tabela própria; auditoria: só leitura
      for (const m of comNegocio) {
        for (const camada of ['controller', 'service', 'repository']) assert.ok(existsSync(resolve(RAIZ, `src/modules/${m}/${m}.${camada}.ts`)), `${m}.${camada}.ts`);
      }
    });

    it('só os repositories falam com o Prisma (controllers e services não importam o client direto)', () => {
      for (const m of readdirSync(resolve(RAIZ, 'src/modules'))) {
        for (const camada of ['controller', 'service']) {
          const f = resolve(RAIZ, `src/modules/${m}/${m}.${camada}.ts`);
          if (existsSync(f)) assert.ok(!/new PrismaClient|prisma\.(usuario|organizacao|contrato|lote|equipamento|movimentacao)\./.test(readFileSync(f, 'utf8')), f);
        }
      }
    });

    it('o seed roda também por comando do Prisma (npx prisma db seed) e por script npm', () => {
      const pacote = JSON.parse(readFileSync(resolve(RAIZ, 'package.json'), 'utf8'));
      assert.match(pacote.prisma.seed, /seed/);
      assert.match(pacote.scripts['db:seed'], /seed/);
    });

    it('a documentação pedida existe: decisões e trade-offs, limites do monólito, segurança, falhas e testes', () => {
      const api = readFileSync(resolve(RAIZ, 'docs/API.md'), 'utf8');
      assert.match(api, /Decisões, trade-offs e alternativas rejeitadas/);
      assert.match(api, /Limites do monólito/);
      for (const f of ['SECURITY.md', 'FAILURE_SCENARIOS.md', 'TESTES.md', 'REQUISITOS.md']) assert.ok(existsSync(resolve(RAIZ, 'docs', f)), f);
    });

    it('migrações versionadas existem (arquivos SQL de migração)', () => {
      const pasta = resolve(RAIZ, 'prisma/migrations');
      const migracoes = readdirSync(pasta).filter((d) => existsSync(resolve(pasta, d, 'migration.sql')));
      assert.ok(migracoes.length >= 2);
    });

    it('modelos Organizacao, Contrato, Lote, Equipamento e Movimentacao existem como tabelas', async () => {
      const t = await amb.prisma.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
      const nomes = t.map((x) => x.table_name);
      for (const n of ['Organizacao', 'Contrato', 'Lote', 'Equipamento', 'Movimentacao']) assert.ok(nomes.includes(n), n);
    });

    it('campo "versao" em CADA modelo (versionamento otimista)', async () => {
      const t = await amb.prisma.$queryRaw<{ table_name: string }[]>`SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'versao'`;
      const com = t.map((x) => x.table_name).sort();
      assert.deepEqual(com, ['Auditoria', 'Contrato', 'Equipamento', 'Lote', 'Movimentacao', 'Organizacao', 'ParametroGlobal', 'Usuario']);
    });

    it('ids são UUID e as cláusulas do contrato são JSON (JSONB), como o PDF sugere', async () => {
      const c = await amb.prisma.$queryRaw<{ column_name: string; data_type: string }[]>`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Contrato' AND column_name IN ('id', 'clausulas')`;
      const tipo = Object.fromEntries(c.map((x) => [x.column_name, x.data_type]));
      assert.equal(tipo.id, 'uuid');
      assert.equal(tipo.clausulas, 'jsonb');
    });

    it('unicidade no banco: CNPJ e codigoBarrasInterno (inserção direta duplicada é recusada)', async () => {
      const cnpj = await amb.orgComContrato(tok.admin, '220000000001');
      await assert.rejects(amb.prisma.organizacao.create({ data: { cnpj, razaoSocial: 'Clone' } }), /Unique constraint|duplicate/i);
      const { equipamentos } = await amb.novoLote(tok.alm, cnpj, 'NF-UNI', ['cpu', 'cpu']);
      await assert.rejects(
        amb.prisma.$executeRawUnsafe(`UPDATE "Equipamento" SET "codigoBarrasInterno" = '${equipamentos[0].id}' WHERE id = '${equipamentos[1].id}'::uuid`),
        /unique|duplicate|check/i,
      );
    });

    it('JWT carrega o identificador do usuário e o papel', async () => {
      const payload = JSON.parse(Buffer.from(tok.cad.split('.')[1], 'base64url').toString());
      assert.match(payload.sub, /^[0-9a-f-]{36}$/);
      assert.equal(payload.papel, 'cadastro');
    });

    it('senhas guardadas com bcrypt', async () => {
      const u = await amb.prisma.usuario.findUniqueOrThrow({ where: { username: 'admin' } });
      assert.match(u.senhaHash, /^\$2[aby]\$/);
    });

    it('transação: criar lote com vários equipamentos é tudo ou nada', async () => {
      const cnpj = await amb.orgComContrato(tok.admin, '220000000002');
      const antes = await amb.prisma.lote.count();
      const ruim = await api('POST', '/lotes', tok.alm, { orgCnpj: cnpj, nf: 'NF-RUIM', transportadora: 'T', equipamentos: [{ tipo: 'cpu' }, { tipo: '   ' }] });
      assert.equal(ruim.statusCode, 400);
      assert.equal(await amb.prisma.lote.count(), antes);
      const bom = await amb.novoLote(tok.alm, cnpj, 'NF-BOM', ['cpu', 'monitor', 'terminal']);
      assert.equal(bom.equipamentos.length, 3);
    });

    it('transação: atualizar o status do equipamento registra a movimentação (na mesma operação)', async () => {
      const cnpj = await amb.orgComContrato(tok.admin, '220000000003');
      const { equipamentos } = await amb.novoLote(tok.alm, cnpj, 'NF-MOV', ['cpu']);
      await api('PATCH', `/equipamentos/${equipamentos[0].id}/status`, tok.alm, { status: 'em_triagem' });
      const movs = await amb.prisma.movimentacao.findMany({ where: { equipamentoId: equipamentos[0].id } });
      assert.equal(movs.length, 1);
      assert.deepEqual([movs[0].statusDe, movs[0].statusPara], ['aguardando_triagem', 'em_triagem']);
    });

    it('API documentada com Swagger (OpenAPI com segurança JWT)', async () => {
      const r = await amb.app.inject({ method: 'GET', url: '/docs/json' });
      assert.equal(r.statusCode, 200);
      const doc = r.json();
      assert.ok(Object.keys(doc.paths).length >= 25);
      assert.ok(doc.components.securitySchemes.bearerAuth);
    });

    it('CHECKs e triggers: estados inconsistentes não persistem (nem por SQL direto)', async () => {
      const cnpj = await amb.orgComContrato(tok.admin, '220000000004');
      const { equipamentos } = await amb.novoLote(tok.alm, cnpj, 'NF-CHK', ['cpu']);
      const id = equipamentos[0].id;
      await assert.rejects(amb.prisma.$executeRawUnsafe(`UPDATE "Equipamento" SET "status" = 'desmonte' WHERE id = '${id}'::uuid`), /check/i);
      await assert.rejects(amb.prisma.$executeRawUnsafe(`UPDATE "Contrato" SET "frequenciaColetaDias" = 0`), /check/i);
      await assert.rejects(amb.prisma.$executeRawUnsafe(`UPDATE "Movimentacao" SET "justificativa" = 'x'`), /imutavel/);
    });
  });

  describe('respostas do professor (PDF de dúvidas)', () => {
    let cnpj: string;
    before(async () => {
      cnpj = await amb.orgComContrato(tok.admin, '230000000001');
    });

    it('swagger entregue; scripts de teste (caminho feliz e erros) existem: ok, você está lendo um', () => assert.ok(true));

    it('soft delete (inativar) E delete padrão para organização, usuário e lote', async () => {
      // organização
      const a = cnpjValido('230000000002');
      await api('POST', '/organizacoes', tok.cad, { cnpj: a, razaoSocial: 'Soft' });
      assert.equal((await api('DELETE', `/organizacoes/${a}`, tok.cad)).statusCode, 200);
      assert.equal((await amb.prisma.organizacao.findUniqueOrThrow({ where: { cnpj: a } })).ativo, false); // a linha continua lá
      assert.equal((await api('DELETE', `/organizacoes/${a}?permanente=true`, tok.admin)).statusCode, 204);
      assert.equal(await amb.prisma.organizacao.count({ where: { cnpj: a } }), 0); // agora sumiu de verdade
      // usuário
      const u = (await api('POST', '/usuarios', tok.admin, { username: 'soft1', senha: 'Greencode#2026', papel: 'auditor' })).json();
      assert.equal((await api('DELETE', `/usuarios/${u.id}`, tok.admin)).statusCode, 204);
      assert.equal((await amb.prisma.usuario.findUniqueOrThrow({ where: { id: u.id } })).ativo, false);
      assert.equal((await api('DELETE', `/usuarios/${u.id}?permanente=true`, tok.admin)).statusCode, 204);
      assert.equal(await amb.prisma.usuario.count({ where: { id: u.id } }), 0);
      // lote
      const { lote } = await amb.novoLote(tok.cad, cnpj, 'NF-SOFT');
      assert.equal((await api('DELETE', `/lotes/${lote.id}`, tok.cad)).statusCode, 200);
      assert.equal((await amb.prisma.lote.findUniqueOrThrow({ where: { id: lote.id } })).ativo, false);
      assert.equal((await api('DELETE', `/lotes/${lote.id}?permanente=true`, tok.admin)).statusCode, 204);
      assert.equal(await amb.prisma.lote.count({ where: { id: lote.id } }), 0);
    });

    it('comportamento em cadeia: inativar a organização inativa todos os seus lotes e equipamentos', async () => {
      const c = await amb.orgComContrato(tok.admin, '230000000003');
      const { lote, equipamentos } = await amb.novoLote(tok.alm, c, 'NF-CADEIA', ['cpu', 'monitor']);
      await api('DELETE', `/organizacoes/${c}`, tok.cad);
      assert.equal((await amb.prisma.lote.findUniqueOrThrow({ where: { id: lote.id } })).ativo, false);
      for (const e of equipamentos) assert.equal((await api('GET', `/equipamentos/${e.id}`, tok.alm)).statusCode, 404); // somem junto
    });

    it('comportamento em cadeia (delete padrão): apagar a organização apaga lotes, equipamentos e contrato', async () => {
      const c = await amb.orgComContrato(tok.admin, '230000000004');
      const { lote, equipamentos } = await amb.novoLote(tok.alm, c, 'NF-APAGA', ['cpu']);
      await api('PATCH', `/equipamentos/${equipamentos[0].id}/status`, tok.alm, { status: 'em_triagem' });
      assert.equal((await api('DELETE', `/organizacoes/${c}?permanente=true`, tok.admin)).statusCode, 204);
      assert.equal(await amb.prisma.lote.count({ where: { id: lote.id } }), 0);
      assert.equal(await amb.prisma.equipamento.count({ where: { id: equipamentos[0].id } }), 0);
      assert.equal(await amb.prisma.movimentacao.count({ where: { equipamentoId: equipamentos[0].id } }), 0);
    });

    it('equipamentos e contratos (filhos): só delete, sem soft delete', async () => {
      const c = await amb.orgComContrato(tok.admin, '230000000005');
      const { equipamentos } = await amb.novoLote(tok.alm, c, 'NF-FILHOS', ['cpu']);
      assert.equal((await api('DELETE', `/equipamentos/${equipamentos[0].id}`, tok.alm)).statusCode, 204);
      assert.equal(await amb.prisma.equipamento.count({ where: { id: equipamentos[0].id } }), 0);
      const contrato = (await api('GET', `/organizacoes/${c}`, tok.cad)).json().contrato;
      assert.equal((await api('DELETE', `/contratos/${contrato.id}`, tok.cad)).statusCode, 204); // direto, sem pedir confirmação
      assert.equal(await amb.prisma.contrato.count({ where: { id: contrato.id } }), 0);
      const colunas = await amb.prisma.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'Equipamento' AND column_name IN ('ativo', 'inativadoEm')`;
      assert.equal(colunas.length, 0); // o equipamento não tem nenhuma coluna de soft delete
    });

    it('sem contrato: a organização NÃO é inativa, mas não recebe lote', async () => {
      const c = cnpjValido('230000000006');
      await api('POST', '/organizacoes', tok.cad, { cnpj: c, razaoSocial: 'Sem contrato' });
      assert.equal((await api('GET', `/organizacoes/${c}`, tok.cad)).json().ativo, true);
      assert.equal((await api('POST', '/lotes', tok.cad, { orgCnpj: c, nf: 'NF-X', transportadora: 'T' })).statusCode, 409);
    });

    it('lotes só em organizações com contrato ativo (encerrado também bloqueia)', async () => {
      const c = await amb.orgComContrato(tok.admin, '230000000007');
      const contrato = (await api('GET', `/organizacoes/${c}`, tok.cad)).json().contrato;
      await api('POST', `/contratos/${contrato.id}/encerrar`, tok.cad);
      assert.equal((await api('POST', '/lotes', tok.cad, { orgCnpj: c, nf: 'NF-Y', transportadora: 'T' })).statusCode, 409);
    });

    it('inativar a organização mesmo com contrato ativo é permitido (sem restrição)', async () => {
      const c = await amb.orgComContrato(tok.admin, '230000000008');
      assert.equal((await api('DELETE', `/organizacoes/${c}`, tok.cad)).statusCode, 200);
    });

    it('status do lote: só vai para EM_TRIAGEM quando TODOS os equipamentos tiverem o mesmo status', async () => {
      const c = await amb.orgComContrato(tok.admin, '230000000009');
      const { lote, equipamentos } = await amb.novoLote(tok.alm, c, 'NF-TRI', ['cpu', 'cpu', 'cpu']);
      const status = async () => (await api('GET', `/lotes/${lote.id}`, tok.alm)).json().status;
      await api('PATCH', `/equipamentos/${equipamentos[0].id}/status`, tok.alm, { status: 'em_triagem' });
      assert.equal(await status(), 'recebido'); // "se pelo menos um foi para triagem..." -> NÃO muda (resposta do professor: não)
      await api('PATCH', `/equipamentos/${equipamentos[1].id}/status`, tok.alm, { status: 'em_triagem' });
      assert.equal(await status(), 'recebido');
      await api('PATCH', `/equipamentos/${equipamentos[2].id}/status`, tok.alm, { status: 'em_triagem' });
      assert.equal(await status(), 'em_triagem'); // todos iguais: agora sim
    });

    it('código de barras é o id do equipamento (único, gerado pelo sistema)', async () => {
      const c = await amb.orgComContrato(tok.admin, '230000000010');
      const { equipamentos } = await amb.novoLote(tok.alm, c, 'NF-BAR', ['cpu', 'cpu']);
      for (const e of equipamentos) assert.equal(e.codigoBarrasInterno, e.id);
      assert.notEqual(equipamentos[0].codigoBarrasInterno, equipamentos[1].codigoBarrasInterno);
      const tenta = await api('POST', '/equipamentos', tok.alm, { loteId: equipamentos[0].loteId, tipo: 'cpu', codigoBarrasInterno: 'MEU-CODIGO' });
      assert.equal(tenta.statusCode, 400); // o usuário não escolhe o código de barras
    });

    it('posição no lote é automática, sequencial (como o índice de um array) e não pode ser informada', async () => {
      const c = await amb.orgComContrato(tok.admin, '230000000011');
      const { lote, equipamentos } = await amb.novoLote(tok.alm, c, 'NF-POS', ['a', 'b', 'c']);
      assert.deepEqual(equipamentos.map((e) => e.posicao), [1, 2, 3]);
      const tenta = await api('POST', '/equipamentos', tok.alm, { loteId: lote.id, tipo: 'cpu', posicao: 99 });
      assert.equal(tenta.statusCode, 400);
      assert.equal((await api('POST', '/equipamentos', tok.alm, { loteId: lote.id, tipo: 'd' })).json().posicao, 4);
    });

    it('ADMIN tem acesso a TODAS as rotas (nenhuma devolve 401/403 para o admin)', async () => {
      const doc = (await amb.app.inject({ method: 'GET', url: '/docs/json' })).json();
      const trocas: Record<string, string> = { id: ID_FANTASMA, cnpj: '11222333000181', chave: 'chave_x' };
      let verificadas = 0;
      for (const [caminho, metodos] of Object.entries<any>(doc.paths)) {
        if (caminho.startsWith('/api/v1/auth/') || caminho.endsWith('/health')) continue; // públicas / pessoais
        const url = caminho.replace('/api/v1', '').replace(/\{(\w+)\}/g, (_, n) => trocas[n]);
        for (const metodo of Object.keys(metodos)) {
          const m = metodo.toUpperCase() as 'GET';
          const r = await api(m, url, tok.admin, m === 'GET' ? undefined : {});
          assert.ok(r.statusCode !== 401 && r.statusCode !== 403, `${m} ${url} -> ${r.statusCode}`);
          verificadas++;
        }
      }
      assert.ok(verificadas >= 30, `só ${verificadas} rotas verificadas`);
    });

    it('listagens bloqueadas para os papéis que não gerenciam a entidade (operador não vê a lista de usuários)', async () => {
      for (const t of [tok.cad, tok.alm, tok.aud]) assert.equal((await api('GET', '/usuarios', t)).statusCode, 403);
      assert.equal((await api('GET', '/equipamentos', tok.cad)).statusCode, 403); // cadastro não gerencia equipamentos
      assert.equal((await api('GET', '/organizacoes', tok.alm)).statusCode, 403); // almoxarifado não gerencia organizações
      assert.equal((await api('GET', '/config', tok.cad)).statusCode, 403);
    });

    it('o admin continua responsável por usuários e parâmetros globais, e agora pode tudo', async () => {
      assert.equal((await api('GET', '/usuarios', tok.admin)).statusCode, 200);
      assert.equal((await api('PUT', '/config/aliquota_icms', tok.admin, { valor: '0.18' })).statusCode, 200);
      assert.equal((await api('POST', '/organizacoes', tok.admin, { cnpj: cnpjValido('230000000012'), razaoSocial: 'Admin faz tudo' })).statusCode, 201);
      assert.equal((await api('POST', '/lotes', tok.admin, { orgCnpj: cnpj, nf: 'NF-ADM', transportadora: 'T', dataEntrada: dia(0), equipamentos: [{ tipo: 'cpu' }] })).statusCode, 201);
    });
  });
});
