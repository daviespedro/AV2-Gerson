-- A última barreira: estados inconsistentes não passam, mesmo para quem contorna a API (SQL manual, scripts, bugs).
-- Confio na API, mas confiar só nela seria um erro de principiante.

-- Easter egg nº 9 (o difícil): um CHECK é o único membro da equipe que não pode ser subornado, enganado nem convencido pelo gerente. :)

-- CNPJ sempre normalizado: 14 dígitos, sem máscara, sem criatividade
ALTER TABLE "Organizacao" ADD CONSTRAINT "Organizacao_cnpj_chk" CHECK ("cnpj" ~ '^[0-9]{14}$');

-- Contrato: frequência positiva (coleta a cada zero dias seria um truque impressionante, mas impossível)
ALTER TABLE "Contrato" ADD CONSTRAINT "Contrato_frequencia_chk" CHECK ("frequenciaColetaDias" > 0);

-- Versão otimista sempre >= 1: ninguém começa do zero
ALTER TABLE "Usuario"         ADD CONSTRAINT "Usuario_versao_chk"         CHECK ("versao" >= 1);
ALTER TABLE "Organizacao"     ADD CONSTRAINT "Organizacao_versao_chk"     CHECK ("versao" >= 1);
ALTER TABLE "Contrato"        ADD CONSTRAINT "Contrato_versao_chk"        CHECK ("versao" >= 1);
ALTER TABLE "Lote"            ADD CONSTRAINT "Lote_versao_chk"            CHECK ("versao" >= 1);
ALTER TABLE "Equipamento"     ADD CONSTRAINT "Equipamento_versao_chk"     CHECK ("versao" >= 1);
ALTER TABLE "Movimentacao"    ADD CONSTRAINT "Movimentacao_versao_chk"    CHECK ("versao" >= 1);
ALTER TABLE "Auditoria"       ADD CONSTRAINT "Auditoria_versao_chk"       CHECK ("versao" >= 1);
ALTER TABLE "ParametroGlobal" ADD CONSTRAINT "ParametroGlobal_versao_chk" CHECK ("versao" >= 1);
ALTER TABLE "ParametroGlobal" ADD CONSTRAINT "ParametroGlobal_chave_chk"  CHECK ("chave" ~ '^[A-Za-z0-9_.-]{1,64}$');

-- Lote: contador de posição nunca abaixo de 1
ALTER TABLE "Lote" ADD CONSTRAINT "Lote_proximaPosicao_chk" CHECK ("proximaPosicao" >= 1);

-- Equipamento: posição >= 1; código de barras = id; 'desmonte' exige triagem completa
ALTER TABLE "Equipamento" ADD CONSTRAINT "Equipamento_posicao_chk" CHECK ("posicao" >= 1);
ALTER TABLE "Equipamento" ADD CONSTRAINT "Equipamento_codigo_igual_id_chk" CHECK ("codigoBarrasInterno" = "id"::text);
ALTER TABLE "Equipamento" ADD CONSTRAINT "Equipamento_desmonte_exige_triagem_chk" CHECK ("status" <> 'desmonte' OR "triagemCompleta" = true);

-- Movimentação: pares de/para coerentes e ao menos uma mudança (ir de A para A não é movimento, é enrolação)
ALTER TABLE "Movimentacao" ADD CONSTRAINT "Movimentacao_par_chk" CHECK (
  ("statusDe" IS NULL) = ("statusPara" IS NULL)
  AND ("estadoDe" IS NULL) = ("estadoPara" IS NULL)
  AND ("statusDe" IS NOT NULL OR "estadoDe" IS NOT NULL)
);

-- Movimentação e Auditoria são imutáveis: o passado não se reescreve. Ações de FK (cascata / SET NULL) rodam dentro de outro
-- trigger (pg_trigger_depth() > 1) e continuam permitidas.
CREATE OR REPLACE FUNCTION greencode_bloquear_alteracao() RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A tabela % e imutavel (somente INSERT permitido).', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Movimentacao_imutavel_trg" BEFORE UPDATE OR DELETE ON "Movimentacao"
  FOR EACH ROW EXECUTE FUNCTION greencode_bloquear_alteracao();
CREATE TRIGGER "Auditoria_imutavel_trg" BEFORE UPDATE OR DELETE ON "Auditoria"
  FOR EACH ROW EXECUTE FUNCTION greencode_bloquear_alteracao();
