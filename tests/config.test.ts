// A configuração é a primeira coisa que o sistema confere ao acordar. Sem segredo decente, nem sobe.
// Testes puros: passam um objeto de ambiente e observam a reação. Nenhum banco foi maltratado.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { carregarConfig } from '../src/config';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/x', JWT_SECRET: 'x'.repeat(32) };

describe('carregarConfig', () => {
  // Configuração fraca é como cadeado de bicicleta: o ladrão agradece.
  it('sem DATABASE_URL o sistema recusa subir', () => {
    assert.throws(() => carregarConfig({ JWT_SECRET: base.JWT_SECRET }), /DATABASE_URL/);
  });

  it('JWT_SECRET ausente ou curto (menos de 32 caracteres) é recusado', () => {
    assert.throws(() => carregarConfig({ DATABASE_URL: base.DATABASE_URL }), /JWT_SECRET/);
    assert.throws(() => carregarConfig({ ...base, JWT_SECRET: 'curto' }), /JWT_SECRET/);
  });

  it('PORT inválida (texto, negativa, enorme) é recusada', () => {
    for (const PORT of ['abc', '-1', '70000', '3.5']) assert.throws(() => carregarConfig({ ...base, PORT }), /PORT/, `PORT=${PORT}`);
  });

  it('a porta vem da variável de ambiente (requisito da AV2)', () => {
    assert.equal(carregarConfig({ ...base, PORT: '8080' }).porta, 8080);
  });

  it('valores padrão sensatos', () => {
    const c = carregarConfig(base);
    assert.equal(c.porta, 3000);
    assert.equal(c.host, '0.0.0.0');
    assert.equal(c.jwtExpira, '30m');
    assert.equal(c.cors, false); // CORS fechado por padrão
    assert.equal(c.logLevel, 'info');
    assert.equal(c.encerramentoMs, 10000);
  });

  it('CORS: vazio = fechado, "*" = aberto, texto = origem específica', () => {
    assert.equal(carregarConfig({ ...base, CORS_ORIGIN: '*' }).cors, true);
    assert.equal(carregarConfig({ ...base, CORS_ORIGIN: 'http://localhost:5173' }).cors, 'http://localhost:5173');
  });
});
