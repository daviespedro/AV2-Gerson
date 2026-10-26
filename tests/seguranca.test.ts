// Segurança: minha especialidade favorita. Todo mundo acha que o cofre é seguro, até alguém tentar abri-lo.
// Aqui eu tento: token falsificado, injeção de SQL, vazamento de senha, papel fora do lugar e corpo gigante.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Ambiente, criarAmbiente, ID_FANTASMA, JWT_SEGREDO, SENHA, Tokens } from './helpers/ambiente';

let amb: Ambiente;
let tok: Tokens;
const api: Ambiente['api'] = (...a) => amb.api(...a);

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const forjar = (payload: object, segredo: string) => {
  const cab = b64({ alg: 'HS256', typ: 'JWT' });
  const corpo = b64(payload);
  return `${cab}.${corpo}.${createHmac('sha256', segredo).update(`${cab}.${corpo}`).digest('base64url')}`;
};
const semAssinatura = (payload: object) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`;

describe('segurança', () => {
  // Ninguém abre um cofre pensando 'e se der errado?'. Eu abro pensando 'como alguém mais abriria isso?'.
  before(async () => {
    amb = await criarAmbiente();
    tok = await amb.usuariosBase();
  });
  after(() => amb.encerrar());

  describe('tokens falsificados ou estranhos', () => {
    let adminId: string;
    before(async () => {
      adminId = (await api('GET', '/auth/me', tok.admin)).json().id;
    });

    it('assinado com outro segredo -> 401 (mesmo dizendo que é admin)', async () => {
      const t = forjar({ sub: adminId, username: 'admin', papel: 'admin' }, 'outro-segredo-qualquer-com-mais-de-32-chars');
      assert.equal((await api('GET', '/usuarios', t)).statusCode, 401);
    });

    it('alg "none" (sem assinatura) -> 401', async () => {
      assert.equal((await api('GET', '/usuarios', semAssinatura({ sub: adminId, username: 'admin', papel: 'admin' }))).statusCode, 401);
    });

    it('payload adulterado com a assinatura antiga -> 401', async () => {
      const [cab, , assinatura] = tok.aud.split('.');
      const falso = b64({ sub: adminId, username: 'admin', papel: 'admin' });
      assert.equal((await api('GET', '/usuarios', `${cab}.${falso}.${assinatura}`)).statusCode, 401);
    });

    it('token válido de um usuário que não existe -> 401', async () => {
      const t = forjar({ sub: ID_FANTASMA, username: 'fantasma', papel: 'admin' }, JWT_SEGREDO);
      assert.equal((await api('GET', '/usuarios', t)).statusCode, 401);
    });

    it('token válido com "sub" que nem UUID é -> 401, nunca 500', async () => {
      const t = forjar({ sub: 'abc', username: 'x', papel: 'admin' }, JWT_SEGREDO);
      assert.equal((await api('GET', '/usuarios', t)).statusCode, 401);
    });

    it('token expirado -> 401', async () => {
      const curto = amb.app.jwt.sign({ sub: adminId, username: 'admin', papel: 'admin' }, { expiresIn: '2s' });
      assert.equal((await api('GET', '/usuarios', curto)).statusCode, 200);
      await new Promise((r) => setTimeout(r, 3200));
      assert.equal((await api('GET', '/usuarios', curto)).statusCode, 401);
    });

    it('o papel do token não manda: vale o papel do banco (token de admin de quem foi rebaixado)', async () => {
      const lista = (await api('GET', '/usuarios', tok.admin)).json().itens;
      const cad = lista.find((u: any) => u.username === 'cadastro1');
      const mentiroso = forjar({ sub: cad.id, username: 'cadastro1', papel: 'admin' }, JWT_SEGREDO); // assinatura legítima, papel mentiroso
      assert.equal((await api('GET', '/usuarios', mentiroso)).statusCode, 403);
    });

    it('cabeçalho Authorization malformado -> 401', async () => {
      for (const h of ['', 'Bearer', 'Basic abc', 'Bearer a.b']) {
        const r = await amb.app.inject({ method: 'GET', url: '/api/v1/usuarios', headers: h ? { authorization: h } : {} });
        assert.equal(r.statusCode, 401, `Authorization="${h}"`);
      }
    });
  });

  describe('injeção de SQL e entradas hostis', () => {
    it('as tabelas continuam inteiras depois de uma saraivada de tentativas', async () => {
      const veneno = "'; DROP TABLE \"Usuario\"; --";
      const tentativas = [
        await api('POST', '/auth/login', undefined, { username: "admin' OR '1'='1", senha: veneno }),
        await api('POST', '/auth/login', undefined, { username: "admin'--", senha: 'x' }),
        await api('GET', `/organizacoes/${encodeURIComponent(veneno)}`, tok.admin),
        await api('GET', `/lotes?status=${encodeURIComponent("recebido' OR '1'='1")}`, tok.admin),
        await api('GET', `/auditoria?acao=${encodeURIComponent("' OR 1=1 --")}`, tok.admin),
        await api('GET', `/lotes?cnpj=${encodeURIComponent(veneno)}`, tok.admin),
      ];
      for (const t of tentativas) assert.ok(t.statusCode >= 400 || t.json().total === 0, `status ${t.statusCode}`);
      assert.ok(tentativas.every((t) => t.statusCode < 500), 'nada de 500: erro interno é confissão');
      assert.equal((await api('GET', '/usuarios', tok.admin)).json().total, 4); // a tabela segue de pé
    });

    it('corpo acima de 1 MB -> 413', async () => {
      const r = await api('POST', '/organizacoes', tok.admin, { cnpj: '11222333000181', razaoSocial: 'x'.repeat(2_000_000) });
      assert.equal(r.statusCode, 413);
    });

    it('UUID mal formado em rota -> 400; JSON quebrado -> 400', async () => {
      assert.equal((await api('GET', '/lotes/nao-sou-uuid', tok.admin)).statusCode, 400);
      const r = await amb.app.inject({ method: 'POST', url: '/api/v1/organizacoes', payload: '{quebrado', headers: { authorization: `Bearer ${tok.admin}`, 'content-type': 'application/json' } });
      assert.equal(r.statusCode, 400);
    });
  });

  describe('vazamento de dados', () => {
    it('hash de senha nunca aparece em nenhuma resposta de usuário', async () => {
      const respostas = [
        await api('POST', '/auth/login', undefined, { username: 'admin', senha: SENHA }),
        await api('GET', '/auth/me', tok.admin),
        await api('GET', '/usuarios', tok.admin),
        await api('POST', '/usuarios', tok.admin, { username: 'vazamento1', senha: SENHA, papel: 'auditor' }),
      ];
      for (const r of respostas) assert.ok(!/senhaHash|\$2[aby]\$/.test(r.body), r.body.slice(0, 120));
    });

    it('a senha é guardada como bcrypt (nunca em texto)', async () => {
      const u = await amb.prisma.usuario.findUniqueOrThrow({ where: { username: 'admin' } });
      assert.match(u.senhaHash, /^\$2[aby]\$\d{2}\$/);
      assert.notEqual(u.senhaHash, SENHA);
    });

    it('erro interno não vaza detalhes (rota inexistente devolve só o formato padrão)', async () => {
      const r = await api('GET', '/rota/que/nao/existe', tok.admin);
      assert.deepEqual(Object.keys(r.json()).sort(), ['erro', 'mensagem']);
    });

    it('CORS fechado por padrão: nenhuma origem recebe cabeçalho de liberação', async () => {
      const r = await amb.app.inject({ method: 'GET', url: '/api/v1/health', headers: { origin: 'http://malvado.example' } });
      assert.equal(r.headers['access-control-allow-origin'], undefined);
    });
  });

  describe('mass assignment: campos que ninguém deveria poder mandar', () => {
    it('corpo com campo extra é rejeitado (400) em criação e edição', async () => {
      assert.equal((await api('POST', '/usuarios', tok.admin, { username: 'massa1', senha: SENHA, papel: 'auditor', ativo: false, versao: 99 })).statusCode, 400);
      assert.equal((await api('POST', '/organizacoes', tok.admin, { cnpj: '11222333000181', razaoSocial: 'X', ativo: false })).statusCode, 400);
      assert.equal((await api('PATCH', `/lotes/${ID_FANTASMA}`, tok.admin, { status: 'encerrado' })).statusCode, 400);
      assert.equal((await api('PATCH', `/equipamentos/${ID_FANTASMA}`, tok.admin, { tipo: 'cpu', status: 'revenda' })).statusCode, 400);
    });
  });

  describe('papéis: a matriz inteira', () => {
    const TODOS = ['admin', 'cadastro', 'almoxarifado', 'auditor'] as const;
    type Papel = (typeof TODOS)[number];
    const chave: Record<Papel, keyof Tokens> = { admin: 'admin', cadastro: 'cad', almoxarifado: 'alm', auditor: 'aud' };

    // método, url, quem pode (o admin sempre pode; o auditor só nas leituras)
    const ROTAS: [string, string, readonly Papel[]][] = [
      ['GET', '/usuarios', ['admin']],
      ['POST', '/usuarios', ['admin']],
      ['GET', '/config', ['admin']],
      ['PUT', '/config/aliquota_icms', ['admin']],
      ['GET', '/auditoria', ['admin', 'auditor']],
      ['GET', '/organizacoes', ['admin', 'cadastro', 'auditor']],
      ['POST', '/organizacoes', ['admin', 'cadastro']],
      ['GET', '/contratos', ['admin', 'cadastro', 'auditor']],
      ['POST', '/contratos', ['admin', 'cadastro']],
      ['GET', '/lotes', TODOS],
      ['POST', '/lotes', ['admin', 'cadastro', 'almoxarifado']],
      ['GET', '/equipamentos', ['admin', 'almoxarifado', 'auditor']],
      ['POST', '/equipamentos', ['admin', 'almoxarifado']],
      ['GET', `/rastreio/${ID_FANTASMA}`, TODOS],
    ];

    for (const [metodo, url, permitidos] of ROTAS) {
      it(`${metodo} ${url}: libera ${permitidos.join(', ')} e barra o resto (403)`, async () => {
        for (const papel of TODOS) {
          const r = await api(metodo as 'GET', url, tok[chave[papel]], metodo === 'GET' ? undefined : {});
          if (permitidos.includes(papel)) assert.notEqual(r.statusCode, 403, `${papel} deveria entrar (veio ${r.statusCode})`);
          else assert.equal(r.statusCode, 403, `${papel} deveria ser barrado (veio ${r.statusCode})`);
        }
      });
    }

    it('o auditor é barrado em TODAS as rotas de escrita (e só pode trocar a própria senha)', async () => {
      const id = ID_FANTASMA;
      const cnpj = '11222333000181';
      const escritas: [string, string][] = [
        ['POST', '/usuarios'], ['PATCH', `/usuarios/${id}/username`], ['PATCH', `/usuarios/${id}/papel`], ['PATCH', `/usuarios/${id}/senha`],
        ['PATCH', `/usuarios/${id}/ativo`], ['DELETE', `/usuarios/${id}`], ['POST', '/organizacoes'], ['PATCH', `/organizacoes/${cnpj}`],
        ['DELETE', `/organizacoes/${cnpj}`], ['POST', `/organizacoes/${cnpj}/reativar`], ['POST', '/contratos'], ['PATCH', `/contratos/${id}`],
        ['POST', `/contratos/${id}/encerrar`], ['POST', `/contratos/${id}/reativar`], ['DELETE', `/contratos/${id}`], ['POST', '/lotes'],
        ['PATCH', `/lotes/${id}`], ['DELETE', `/lotes/${id}`], ['POST', `/lotes/${id}/reativar`], ['POST', '/equipamentos'],
        ['PATCH', `/equipamentos/${id}`], ['DELETE', `/equipamentos/${id}`], ['POST', `/equipamentos/${id}/triagem`],
        ['PATCH', `/equipamentos/${id}/status`], ['PATCH', `/equipamentos/${id}/estado`], ['PUT', '/config/x'], ['DELETE', '/config/x'],
      ];
      for (const [m, u] of escritas) assert.equal((await api(m as 'POST', u, tok.aud, {})).statusCode, 403, `${m} ${u}`);
      assert.notEqual((await api('POST', '/auth/senha', tok.aud, {})).statusCode, 403); // exceção legítima (400: faltou corpo)
    });

    it('ninguém altera o próprio papel, se desativa ou se apaga (nem o admin)', async () => {
      const eu = (await api('GET', '/auth/me', tok.admin)).json();
      assert.equal((await api('PATCH', `/usuarios/${eu.id}/papel`, tok.admin, { papel: 'auditor' })).statusCode, 400);
      assert.equal((await api('PATCH', `/usuarios/${eu.id}/ativo`, tok.admin, { ativo: false })).statusCode, 400);
      assert.equal((await api('DELETE', `/usuarios/${eu.id}?permanente=true`, tok.admin)).statusCode, 400);
    });
  });
});
