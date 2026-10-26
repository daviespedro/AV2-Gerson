-- A construção do palco: tipos, tabelas, índices e chaves estrangeiras.
-- Escrito à mão, mas fiel ao schema.prisma. Quem estranhar a ordem das cartas, confira o schema.

-- CreateEnum
CREATE TYPE "Papel" AS ENUM ('admin', 'cadastro', 'almoxarifado', 'auditor');
CREATE TYPE "StatusLote" AS ENUM ('recebido', 'em_triagem', 'triagem_completa', 'encerrado');
CREATE TYPE "StatusEquipamento" AS ENUM ('aguardando_triagem', 'em_triagem', 'triado', 'desmonte', 'reciclagem', 'descarte_seguro', 'revenda');
CREATE TYPE "EstadoFisico" AS ENUM ('novo', 'seminovo', 'bom', 'regular', 'ruim', 'sucata');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "papel" "Papel" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Organizacao" (
    "id" UUID NOT NULL,
    "cnpj" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "contato" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "inativadoEm" TIMESTAMPTZ(3),
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organizacao_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Contrato" (
    "id" UUID NOT NULL,
    "organizacaoId" UUID NOT NULL,
    "dataInicio" DATE NOT NULL,
    "frequenciaColetaDias" INTEGER NOT NULL,
    "condicoes" TEXT,
    "clausulas" JSONB,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contrato_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Lote" (
    "id" UUID NOT NULL,
    "organizacaoId" UUID NOT NULL,
    "nf" TEXT NOT NULL,
    "transportadora" TEXT NOT NULL,
    "dataEntrada" DATE NOT NULL,
    "status" "StatusLote" NOT NULL DEFAULT 'recebido',
    "proximaPosicao" INTEGER NOT NULL DEFAULT 1,
    "criadoPorId" UUID NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "inativadoEm" TIMESTAMPTZ(3),
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Equipamento" (
    "id" UUID NOT NULL,
    "loteId" UUID NOT NULL,
    "codigoBarrasInterno" TEXT NOT NULL,
    "posicao" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "estadoFisico" "EstadoFisico" NOT NULL DEFAULT 'novo',
    "status" "StatusEquipamento" NOT NULL DEFAULT 'aguardando_triagem',
    "triagemCompleta" BOOLEAN NOT NULL DEFAULT false,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Equipamento_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Movimentacao" (
    "id" UUID NOT NULL,
    "equipamentoId" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "statusDe" "StatusEquipamento",
    "statusPara" "StatusEquipamento",
    "estadoDe" "EstadoFisico",
    "estadoPara" "EstadoFisico",
    "justificativa" TEXT,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Movimentacao_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Auditoria" (
    "id" BIGSERIAL NOT NULL,
    "usuarioId" UUID,
    "acao" TEXT NOT NULL,
    "detalhes" JSONB,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Auditoria_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ParametroGlobal" (
    "chave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "atualizadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParametroGlobal_pkey" PRIMARY KEY ("chave")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_username_key" ON "Usuario"("username");
CREATE UNIQUE INDEX "Organizacao_cnpj_key" ON "Organizacao"("cnpj");
CREATE UNIQUE INDEX "Contrato_organizacaoId_key" ON "Contrato"("organizacaoId");
CREATE INDEX "Lote_organizacaoId_idx" ON "Lote"("organizacaoId");
CREATE INDEX "Lote_status_idx" ON "Lote"("status");
CREATE UNIQUE INDEX "Lote_organizacaoId_nf_key" ON "Lote"("organizacaoId", "nf");
CREATE UNIQUE INDEX "Equipamento_codigoBarrasInterno_key" ON "Equipamento"("codigoBarrasInterno");
CREATE INDEX "Equipamento_loteId_idx" ON "Equipamento"("loteId");
CREATE INDEX "Equipamento_status_idx" ON "Equipamento"("status");
CREATE UNIQUE INDEX "Equipamento_loteId_posicao_key" ON "Equipamento"("loteId", "posicao");
CREATE INDEX "Movimentacao_equipamentoId_criadoEm_idx" ON "Movimentacao"("equipamentoId", "criadoEm");
CREATE INDEX "Auditoria_criadoEm_idx" ON "Auditoria"("criadoEm");
CREATE INDEX "Auditoria_acao_idx" ON "Auditoria"("acao");

-- AddForeignKey
ALTER TABLE "Contrato" ADD CONSTRAINT "Contrato_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Lote" ADD CONSTRAINT "Lote_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Lote" ADD CONSTRAINT "Lote_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Equipamento" ADD CONSTRAINT "Equipamento_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "Lote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Movimentacao" ADD CONSTRAINT "Movimentacao_equipamentoId_fkey" FOREIGN KEY ("equipamentoId") REFERENCES "Equipamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Movimentacao" ADD CONSTRAINT "Movimentacao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Auditoria" ADD CONSTRAINT "Auditoria_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
