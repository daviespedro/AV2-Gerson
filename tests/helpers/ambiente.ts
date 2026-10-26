// O palco dos testes de API. Cada suíte pede um banco PostgreSQL de verdade, mas descartável:
// nome aleatório, migrações aplicadas, e no final tudo some. Como num truque bem feito, ninguém percebe que existiu.
// Precisa só de um PostgreSQL acessível com permissão de CREATE DATABASE (veja docs/TESTES.md).
// Credenciais: TEST_DATABASE_ADMIN_URL, ou as de DATABASE_URL, ou greencode:greencode@localhost:5432.
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

try {
  process.loadEnvFile();
} catch {}

export const SENHA = 'Greencode#2026';
export const JWT_SEGREDO = 'segredo-de-teste-com-no-minimo-32-caracteres!!';
export const NOME_BANCO = `greencode_test_${randomBytes(4).toString('hex')}`;
export const ID_FANTASMA = '00000000-0000-4000-8000-000000000000'; // um UUID válido que nunca existiu

function urlAdmin(): string {
  if (process.env.TEST_DATABASE_ADMIN_URL) return process.env.TEST_DATABASE_ADMIN_URL;
  const u = new URL(process.env.DATABASE_URL ?? 'postgresql://greencode:greencode@localhost:5432/greencode');
  u.pathname = '/postgres';
  u.search = '';
  return u.toString();
}
export const URL_ADMIN = urlAdmin();
export const URL_TESTE = (() => {
  const u = new URL(URL_ADMIN);
  u.pathname = `/${NOME_BANCO}`;
  u.searchParams.set('connection_limit', '10'); // várias suítes em paralelo: cada uma com um pool modesto
  return u.toString();
})();
export const semSenha = (url: string) => url.replace(/:\/\/([^:@/]+):[^@]*@/, '://$1:***@');

// O app lê a configuração ao ser importado, então o ambiente é ajustado ANTES (o banco temporário vence qualquer .env).
process.env.DATABASE_URL = URL_TESTE;
process.env.JWT_SECRET = JWT_SEGREDO;
process.env.BCRYPT_ROUNDS = '4';
process.env.LOG_LEVEL = 'silent';

/** CNPJ com cara de verdadeiro: 12 dígitos de base e os dois verificadores calculados. */
export function cnpjValido(base12: string): string {
  const dv = (d: string, p: number[]) => {
    const r = [...d].reduce((s, x, i) => s + Number(x) * p[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${d1}${dv(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`;
}

/** Data relativa a hoje (AAAA-MM-DD, UTC). dia(-1) = ontem. */
export const dia = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export type Metodo = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export interface Resp {
  statusCode: number;
  body: string;
  headers: Record<string, unknown>;
  json: () => any;
}
export interface Tokens {
  admin: string;
  cad: string;
  alm: string;
  aud: string;
}
export interface Ambiente {
  app: FastifyInstance;
  prisma: PrismaClient;
  api: (metodo: Metodo, url: string, token?: string, payload?: unknown) => Promise<Resp>;
  login: (username: string, senha?: string) => Promise<string>;
  /** Provisiona o admin e cria cadastro1, almox1 e auditor1 (senha SENHA). Devolve os quatro tokens. */
  usuariosBase: () => Promise<Tokens>;
  /** Organização + contrato ativo, prontos para receber lote. Devolve o CNPJ. */
  orgComContrato: (token: string, base12: string) => Promise<string>;
  /** Cria um lote (com equipamentos dos tipos informados). Falha alto se não der 201. */
  novoLote: (token: string, cnpj: string, nf: string, tipos?: string[]) => Promise<{ lote: any; equipamentos: any[] }>;
  encerrar: () => Promise<void>;
}

export async function criarAmbiente(): Promise<Ambiente> {
  const { PrismaClient } = await import('@prisma/client');
  const adminDb = new PrismaClient({ datasourceUrl: URL_ADMIN });
  try {
    await adminDb.$executeRawUnsafe(`CREATE DATABASE "${NOME_BANCO}"`);
  } catch (e) {
    await adminDb.$disconnect();
    throw new Error(
      `Não foi possível criar o banco de teste em ${semSenha(URL_ADMIN)}.\n` +
        'Instale/suba um PostgreSQL (veja docs/TESTES.md) ou aponte TEST_DATABASE_ADMIN_URL para um usuário com permissão CREATEDB.\n' +
        `Causa: ${e instanceof Error ? e.message.split('\n').pop() : e}`,
    );
  }
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: URL_TESTE }, stdio: 'pipe' });

  const prisma = (await import('../../src/db')).prisma;
  const { carregarConfig } = await import('../../src/config');
  const app = await (await import('../../src/app')).criarApp(carregarConfig());
  await app.ready();

  const api: Ambiente['api'] = (metodo, url, token, payload) =>
    app.inject({ method: metodo, url: `/api/v1${url}`, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} }) as unknown as Promise<Resp>;
  const login: Ambiente['login'] = async (username, senha = SENHA) => (await api('POST', '/auth/login', undefined, { username, senha })).json().token;

  const esperar = (r: Resp, status: number, o: string) => {
    if (r.statusCode !== status) throw new Error(`${o}: esperava ${status}, veio ${r.statusCode} ${r.body}`);
    return r;
  };

  return {
    app,
    prisma,
    api,
    login,
    async usuariosBase() {
      esperar(await api('POST', '/auth/provisionar', undefined, { username: 'admin', senha: SENHA }), 201, 'provisionar');
      const admin = await login('admin');
      for (const [username, papel] of [['cadastro1', 'cadastro'], ['almox1', 'almoxarifado'], ['auditor1', 'auditor']]) {
        esperar(await api('POST', '/usuarios', admin, { username, senha: SENHA, papel }), 201, `criar ${username}`);
      }
      return { admin, cad: await login('cadastro1'), alm: await login('almox1'), aud: await login('auditor1') };
    },
    async orgComContrato(token, base12) {
      const cnpj = cnpjValido(base12);
      esperar(await api('POST', '/organizacoes', token, { cnpj, razaoSocial: `Org ${base12}` }), 201, 'criar organização');
      esperar(await api('POST', '/contratos', token, { orgCnpj: cnpj, dataInicio: dia(-1), frequenciaColetaDias: 30 }), 201, 'criar contrato');
      return cnpj;
    },
    async novoLote(token, cnpj, nf, tipos = []) {
      const r = esperar(await api('POST', '/lotes', token, { orgCnpj: cnpj, nf, transportadora: 'TransVerde', equipamentos: tipos.map((tipo) => ({ tipo })) }), 201, `criar lote ${nf}`);
      return r.json();
    },
    async encerrar() {
      await app.close(); // fecha as conexões do app com o banco temporário
      await adminDb.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${NOME_BANCO}" WITH (FORCE)`).catch(() => null);
      await adminDb.$disconnect();
    },
  };
}
