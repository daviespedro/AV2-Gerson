# Rastreabilidade: requisito -> implementação -> teste

Cada linha abaixo tem um teste correspondente em `tests/requisitos.test.ts` (com o mesmo enunciado), além das suítes `api`, `seguranca`, `concorrencia`, `seed` e `encerramento`. Como rodar: `docs/TESTES.md`.

## Atividade AV2
| Requisito | Onde | Teste |
|---|---|---|
| Monólito Node.js + TypeScript + Fastify + Prisma + PostgreSQL | `package.json`, `src/app.ts`, `prisma/schema.prisma` | `api.test.ts` |
| Controller-Service-Repository | `src/modules/<x>/` | — |
| Porta por variável de ambiente; graceful shutdown | `src/config.ts`, `src/server.ts` | `config.test.ts`, `encerramento.test.ts` |
| Modelo Organizacao/Contrato/Lote/Equipamento/Movimentacao | `prisma/schema.prisma` | `api.test.ts` |
| Migrações versionadas | `prisma/migrations/` | `api.test.ts` (aplica as migrações) |
| Unicidade de CNPJ e código de barras; constraints no banco | migração `integridade` | "restrições e triggers do banco" |
| Autenticação JWT + bcrypt | `plugins/auth.ts`, `modules/auth`, `shared/hash.ts` | "autenticação e provisionamento" |
| Transações (`$transaction`) | `db.ts`, services | "lote com equipamentos numa transação", "tipo vazio no meio" |
| Versionamento otimista | `shared/versao.ts`, repositories | "versão otimista" |
| Seed de dados (script ou comando do Prisma) | `src/seed.ts`, `package.json` (`prisma.seed`: `npx prisma db seed`) | `seed.test.ts`, `requisitos.test.ts` |
| API documentada (Swagger) | `/docs`, `npm run docs:openapi` | "o Swagger está no ar" |
| Regras de transição de status e cálculos (depreciação) | `dominio/equipamento.ts` | `dominio.test.ts` |
| Windows 10+ e Ubuntu 24.04+ | README (sem binário nativo, sem shell; aviso sobre o Node 18 do apt) | — |
| Campo `versao` em cada modelo | `schema.prisma` (todos os 8 modelos) | "versão otimista" |
| Justificar decisões, trade-offs e alternativas | `docs/API.md` seção 7 | `requisitos.test.ts` (documentação) |
| Refletir sobre os limites do monólito | `docs/API.md` seção 8 | `requisitos.test.ts` (documentação) |
| Campo desconhecido no corpo é recusado (400), não descartado | `src/app.ts` (`removeAdditional: false`) | `api.test.ts`, `seguranca.test.ts` |

## Respostas do cliente (dúvidas da AV2)
| Resposta | Onde | Teste |
|---|---|---|
| Soft delete e delete padrão | `?permanente=true` nos DELETE | "delete permanente", "soft delete em cadeia" |
| Inativar em cadeia (organização -> lotes -> equipamentos) | `organizacao.service.ts` | "inativar a organização inativa lotes" |
| Equipamento e contrato: só delete | rotas `DELETE` sem soft | "contrato: encerrar, reativar, apagar", "operador não apaga" |
| Sem contrato: não inativa, mas não recebe lote | `lote.service.ts` | "sem contrato a organização não recebe lote" |
| Status do lote só muda com todos iguais | `dominio/lote.ts`, `lote.status.ts` | `dominio.test.ts`, "lote só muda quando TODOS" |
| Código de barras = id | `equipamento.repository.ts` + CHECK | "posições 1..3 e código de barras = id" |
| Posição automática sequencial | `loteRepo.reservarPosicoes` | "posição segue sequencial ... simultâneos" |
| Admin acessa todas as rotas | `permitir` em cada rota | "matriz de papéis" |
| Operador não vê usuários | `/usuarios` só admin | "só o admin vê a lista de usuários" |
| Scripts de teste (caminho feliz e erros) | `tests/`, guia em `docs/TESTES.md` | `npm test` |
