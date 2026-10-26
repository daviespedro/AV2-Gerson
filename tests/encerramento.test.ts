// A porta de entrada de verdade: subo o servidor como processo, confiro que ele atende na porta pedida,
// e então peço educadamente que ele saia (SIGTERM). Sai com elegância ou dá problema.
// Não precisa de banco: o /health não toca nele. (No Windows os sinais funcionam diferente: esse teste é pulado.)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

const RAIZ = resolve(__dirname, '..');
const SEGREDO = 'segredo-de-teste-com-no-minimo-32-caracteres!!';

const portaLivre = () =>
  new Promise<number>((ok, falha) => {
    const s = createServer();
    s.once('error', falha);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });

function subir(env: Record<string, string>) {
  const filho = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: RAIZ,
    env: { ...process.env, DATABASE_URL: 'postgresql://x:x@127.0.0.1:5432/x', JWT_SECRET: SEGREDO, HOST: '127.0.0.1', LOG_LEVEL: 'silent', ...env },
  });
  let saida = '';
  filho.stdout.on('data', (d) => (saida += d));
  filho.stderr.on('data', (d) => (saida += d));
  const fim = new Promise<number | null>((ok) => filho.once('exit', (codigo) => ok(codigo)));
  return { filho, fim, saida: () => saida };
}

async function esperarSaude(porta: number, tentativas = 60) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/api/v1/health`);
      if (r.ok) return r;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('o servidor não respondeu a tempo');
}

describe('servidor como processo', () => {
  // Peço licença ao servidor para sair (SIGTERM). Se ele resistir, eu insisto com educação; se não sair, ele é suspeito.
  it('escuta na porta definida em PORT e responde /health', async () => {
    const porta = await portaLivre();
    const s = subir({ PORT: String(porta) });
    try {
      const r = await esperarSaude(porta);
      assert.equal((await r.json()).status, 'ok');
    } finally {
      s.filho.kill('SIGKILL');
      await s.fim;
    }
  });

  it('graceful shutdown: SIGTERM encerra com código 0 e a porta é liberada', { skip: process.platform === 'win32' && 'sinais no Windows não são equivalentes' }, async () => {
    const porta = await portaLivre();
    const s = subir({ PORT: String(porta) });
    await esperarSaude(porta);
    s.filho.kill('SIGTERM');
    const codigo = await Promise.race([s.fim, new Promise<string>((r) => setTimeout(() => r('estourou o tempo'), 10_000))]);
    assert.equal(codigo, 0, s.saida());
    await assert.rejects(fetch(`http://127.0.0.1:${porta}/api/v1/health`)); // ninguém mais atende
  });

  it('graceful shutdown: SIGINT (Ctrl+C) também sai com código 0', { skip: process.platform === 'win32' && 'sinais no Windows não são equivalentes' }, async () => {
    const porta = await portaLivre();
    const s = subir({ PORT: String(porta) });
    await esperarSaude(porta);
    s.filho.kill('SIGINT');
    assert.equal(await s.fim, 0, s.saida());
  });

  it('JWT_SECRET fraco: o servidor recusa subir (código 1) e explica o motivo', async () => {
    const s = subir({ PORT: String(await portaLivre()), JWT_SECRET: 'curto' });
    assert.equal(await s.fim, 1);
    assert.match(s.saida(), /JWT_SECRET/);
  });

  it('PORT inválida: o servidor recusa subir (código 1) e explica o motivo', async () => {
    const s = subir({ PORT: 'abc' });
    assert.equal(await s.fim, 1);
    assert.match(s.saida(), /PORT/);
  });
});
