// Regras de negócio puras: sem banco, sem rede, sem truque. Se aqui falhar, não há plateia para culpar.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ehViolacaoDeReferencia } from '../src/errors';
import { normalizarCnpj } from '../src/dominio/cnpj';
import { validarDataEntradaLote } from '../src/dominio/datas';
import { calcularDepreciacao, exigirJustificativa, normalizarTipo, validarEstadoFisico, validarMovimento } from '../src/dominio/equipamento';
import { derivarStatusLote } from '../src/dominio/lote';
import { validarSenhaForte, validarUsername } from '../src/dominio/senha';

describe('CNPJ', () => {
  // Dois dígitos verificadores: a assinatura de quem sabe fazer conta.
  it('aceita com e sem máscara e normaliza', () => {
    assert.equal(normalizarCnpj('11.222.333/0001-81'), '11222333000181');
    assert.equal(normalizarCnpj('11222333000181'), '11222333000181');
  });
  it('rejeita tamanho, sequência repetida e dígito verificador errado', () => {
    assert.throws(() => normalizarCnpj('123'), /14 dígitos/);
    assert.throws(() => normalizarCnpj('11111111111111'), /repetida/);
    assert.throws(() => normalizarCnpj('11222333000182'), /verificadores/);
  });
});

describe('data de entrada do lote', () => {
  const agora = new Date('2026-10-24T12:00:00Z');
  it('aceita hoje e 90 dias atrás', () => {
    assert.doesNotThrow(() => validarDataEntradaLote('2026-10-24', agora));
    assert.doesNotThrow(() => validarDataEntradaLote('2026-07-26', agora));
  });
  it('rejeita futuro, mais de 90 dias, formato e data impossível', () => {
    assert.throws(() => validarDataEntradaLote('2026-10-25', agora), /futura/);
    assert.throws(() => validarDataEntradaLote('2026-07-24', agora), /90 dias/);
    assert.throws(() => validarDataEntradaLote('24/10/2026', agora), /AAAA-MM-DD/);
    assert.throws(() => validarDataEntradaLote('2026-02-31', agora), /AAAA-MM-DD/);
  });
});

describe('depreciação por tipo (polimorfismo por perfil)', () => {
  it('terminal e monitor são lineares com vidas úteis diferentes', () => {
    assert.equal(calcularDepreciacao('terminal', 18).coeficiente, 0.5);
    assert.equal(calcularDepreciacao('monitor', 30).coeficiente, 0.5);
  });
  it('cpu acelera no primeiro ano', () => {
    assert.equal(calcularDepreciacao('cpu', 12).coeficiente, 0.5);
    assert.equal(calcularDepreciacao('cpu', 48).coeficiente, 1);
  });
  it('servidor nunca passa de 85%', () => {
    assert.equal(calcularDepreciacao('servidor', 1000).coeficiente, 0.85);
  });
  it('tipo desconhecido usa o perfil genérico (24 meses), inclusive nomes de protótipo', () => {
    assert.equal(calcularDepreciacao('impressora', 12).coeficiente, 0.5);
    assert.equal(calcularDepreciacao('constructor', 24).coeficiente, 1);
  });
  it('mesma entrada, tipos diferentes, resultados diferentes', () => {
    const r = ['terminal', 'cpu', 'monitor', 'servidor'].map((t) => calcularDepreciacao(t, 30).coeficiente);
    assert.equal(new Set(r).size, 4);
  });
  it('rejeita meses negativos', () => assert.throws(() => calcularDepreciacao('cpu', -1), /meses/));
  it('tipo vazio é inválido e é normalizado em minúsculas', () => {
    assert.throws(() => normalizarTipo('   '), /obrigatório/);
    assert.equal(normalizarTipo('  CPU '), 'cpu');
  });
});

describe('transições do equipamento', () => {
  it("'desmonte' exige triagem completa", () => {
    assert.throws(() => validarMovimento('desmonte', false), /triagem/);
    assert.doesNotThrow(() => validarMovimento('desmonte', true));
    assert.doesNotThrow(() => validarMovimento('reciclagem', false));
  });
  it('queda de 2+ categorias exige justificativa; queda de 1 não', () => {
    assert.throws(() => exigirJustificativa('novo', 'bom'), /justificativa/);
    assert.throws(() => exigirJustificativa('novo', 'regular', '   '), /justificativa/);
    assert.doesNotThrow(() => exigirJustificativa('novo', 'regular', 'desgaste'));
    assert.doesNotThrow(() => exigirJustificativa('novo', 'seminovo'));
    assert.doesNotThrow(() => exigirJustificativa('ruim', 'novo')); // melhora não exige
  });
  it('estado físico inválido', () => assert.throws(() => validarEstadoFisico('quebrado'), /inválido/));
});

describe('status do lote derivado dos equipamentos', () => {
  it('só muda quando TODOS coincidem', () => {
    assert.equal(derivarStatusLote(['aguardando_triagem', 'aguardando_triagem']), 'recebido');
    assert.equal(derivarStatusLote(['em_triagem', 'em_triagem']), 'em_triagem');
    assert.equal(derivarStatusLote(['triado', 'triado']), 'triagem_completa');
    assert.equal(derivarStatusLote(['triado', 'aguardando_triagem']), null);
  });
  it('destinos finais (mesmo misturados) encerram o lote; desmonte não', () => {
    assert.equal(derivarStatusLote(['reciclagem', 'revenda', 'descarte_seguro']), 'encerrado');
    assert.equal(derivarStatusLote(['reciclagem', 'desmonte']), null);
  });
  it('lote vazio não tem status derivado', () => assert.equal(derivarStatusLote([]), null));
});

describe('credenciais', () => {
  it('senha forte: 8+ caracteres, maiúscula e número', () => {
    assert.throws(() => validarSenhaForte('curta1A'));
    assert.throws(() => validarSenhaForte('semmaiuscula1'));
    assert.throws(() => validarSenhaForte('SemNumeroAqui'));
    assert.doesNotThrow(() => validarSenhaForte('Greencode#2026'));
  });
  it('username: 3+ caracteres, sem espaços', () => {
    assert.throws(() => validarUsername('ab'));
    assert.throws(() => validarUsername('a b c'));
    assert.equal(validarUsername('  admin '), 'admin');
  });
});

describe('violação de chave estrangeira (qualquer versão do PostgreSQL)', () => {
  it('reconhece o P2003 do Prisma (PostgreSQL até a 16)', () => assert.equal(ehViolacaoDeReferencia({ code: 'P2003', message: 'x' }), true));
  it('reconhece a mensagem de RESTRICT do PostgreSQL 18 (SQLSTATE 23001), que o Prisma não classifica', () => {
    assert.equal(ehViolacaoDeReferencia(new Error('PostgresError { code: "23001", message: "update or delete on table \\"Usuario\\" violates RESTRICT setting of foreign key constraint" }')), true);
    assert.equal(ehViolacaoDeReferencia(new Error('violates foreign key constraint "Lote_criadoPorId_fkey"')), true);
  });
  it('não confunde com outros erros', () => {
    assert.equal(ehViolacaoDeReferencia(new Error('algo deu errado')), false);
    assert.equal(ehViolacaoDeReferencia({ code: 'P2002', message: 'Unique constraint failed' }), false);
    assert.equal(ehViolacaoDeReferencia(null), false);
    assert.equal(ehViolacaoDeReferencia(undefined), false);
  });
});
