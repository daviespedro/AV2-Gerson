# greencode

Plataforma de logística reversa de resíduos eletrônicos: organizações geradoras, contratos de coleta, lotes recebidos, rastreabilidade individual de equipamentos e trilha de auditoria. API HTTP monolítica em **Node.js + TypeScript, Fastify, Prisma ORM e PostgreSQL**, com JWT, bcrypt, transações e versionamento otimista.

## Requisitos

- Node.js 20.19+ (recomendado: 22 LTS). Atenção: no Ubuntu 24.04, `apt install nodejs` instala o Node 18, que é antigo demais; instale o Node 22 LTS pelo NodeSource ou pelo `nvm`. No Windows 10+, use o instalador em nodejs.org ou `winget install OpenJS.NodeJS.LTS`.
- PostgreSQL 14+ **para rodar a API**. Para os **testes não precisa instalar nada**: sem PostgreSQL acessível, eles sobem um embutido e temporário. **Docker não é necessário.**
- Windows 10+, Ubuntu 24.04+ (e derivadas) ou macOS. Sem binário nativo extra, sem shell script.

## Testar (o caminho curto)

```bash
npm install
npm test
```

O `npm install` pode levar alguns minutos na primeira vez: ele baixa o PostgreSQL embutido usado nos testes. O `npm test` termina com `pass 151` e `fail 0`. Os comandos são os mesmos no Windows (PowerShell), Ubuntu e macOS.

Detalhes, opções e solução de problemas: [`docs/TESTES.md`](docs/TESTES.md).

## Executar a API (opcional: não é necessário para os testes)

> **macOS (zsh):** linhas começando com `#` não são comentário no terminal interativo. Rode um comando por vez, sem colar comentários.

```bash
npm install
npm run pg
```
`npm run pg` sobe um PostgreSQL embutido (sem Docker), com usuário, senha e banco `greencode`, e fica ligado: **deixe esse terminal aberto**. Em outro terminal:

```bash
npm run db:setup
npm run dev
```

A API sobe em http://localhost:3000 e o Swagger em http://localhost:3000/docs. O `db:setup` cria o `.env`, aplica as migrações e roda o seed (também disponível por `npx prisma db seed`).

Com um PostgreSQL seu: ajuste o `DATABASE_URL` no `.env` e use `npm run db:setup`. Produção: `npm run build && npm run db:migrate && npm start`. A porta vem de `PORT`; `SIGINT`/`SIGTERM` (e `SIGBREAK` no Windows) fazem encerramento gracioso.

Logins do seed (senha `Greencode#2026`, ou `SEED_SENHA`): `admin`, `cadastro1`, `almox1`, `auditor1`. Sem seed, `POST /api/v1/auth/provisionar` cria o primeiro admin.

### Primeiro uso

No Swagger (`/docs`): execute `POST /auth/login` com `{"username": "admin", "senha": "Greencode#2026"}`, copie o `token`, clique em **Authorize** e cole o token. Pronto: todas as rotas passam a funcionar. Pelo terminal (macOS/Linux):

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/login -H "Content-Type: application/json" -d '{"username":"admin","senha":"Greencode#2026"}'
```

Depois envie o token no cabeçalho `Authorization: Bearer <token>` (por exemplo, `GET /api/v1/organizacoes`).

## Testes

| Comando | O que roda |
|---|---|
| `npm test` | tudo (8 arquivos de teste, 151 testes) |
| `npm run test:unit` | domínio e configuração, sem PostgreSQL |
| `npm run test:api` | API: caminho feliz e erros |
| `npm run test:seguranca` | tokens, injeção de SQL, vazamentos, matriz de papéis |
| `npm run test:concorrencia` | disputas simultâneas, transações, rollback |
| `npm run test:requisitos` | cada exigência dos PDFs da AV2 vira um teste |
| `npm run test:seed` | roda o seed de verdade |
| `npm run test:encerramento` | servidor como processo: `PORT` e graceful shutdown |

Cada teste de API cria um banco temporário (`greencode_test_<aleatório>`), aplica as migrações e o apaga no final; nenhum dado existente é tocado. `npm run docs:openapi` grava o contrato em `docs/openapi.json`.

## Papéis

| Papel | Acesso |
|---|---|
| `admin` | tudo (usuários, parâmetros globais, delete permanente, auditoria) |
| `cadastro` | organizações, contratos e lotes (sem equipamentos) |
| `almoxarifado` | lotes e equipamentos (triagem, status, estado físico) |
| `auditor` | somente leitura em tudo que o papel enxerga, e trocar a própria senha |

## Estrutura

```
prisma/        schema.prisma e migrações SQL versionadas (tabelas, CHECKs, triggers)
src/
  app.ts       monta o Fastify (sem abrir porta); server.ts abre a porta e trata o shutdown
  dominio/     regras puras, sem banco: CNPJ, datas, depreciação, transições, status do lote
  modules/     um diretório por recurso: controller (HTTP) -> service (regra) -> repository (Prisma)
  plugins/     autenticação JWT e tratamento de erros
  shared/      paginação, versionamento otimista, hash de senha
  seed.ts      massa de dados idempotente
scripts/       maestro dos testes, PostgreSQL embutido, preparo do .env
tests/         8 arquivos de teste (domínio, config, API, segurança, concorrência, requisitos, seed, encerramento)
docs/          API.md, SECURITY.md, FAILURE_SCENARIOS.md, REQUISITOS.md, TESTES.md
```

Documentação: [`docs/API.md`](docs/API.md) (endpoints, modelo, decisões, trade-offs e limites do monólito), [`docs/SECURITY.md`](docs/SECURITY.md), [`docs/FAILURE_SCENARIOS.md`](docs/FAILURE_SCENARIOS.md), [`docs/REQUISITOS.md`](docs/REQUISITOS.md) (cada requisito da AV2 e cada resposta do cliente, com onde foi implementado e qual teste cobre), [`docs/TESTES.md`](docs/TESTES.md).
# AV2-Gerson
