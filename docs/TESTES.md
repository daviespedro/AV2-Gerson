# Como rodar os testes

Roteiro completo para quem vai avaliar o projeto, em **Windows 10+**, **Ubuntu 24.04+** (e derivadas) ou **macOS**. **Docker não é necessário.**

## 1. O que você precisa

| Item | Versão | Observação |
|---|---|---|
| Node.js | 20.19+ (recomendado: 22 LTS) | No Ubuntu 24.04, `apt install nodejs` instala o Node **18**, que não serve: instale o Node 22 pelo NodeSource ou pelo `nvm`. No Windows: instalador em nodejs.org ou `winget install OpenJS.NodeJS.LTS`. |
| PostgreSQL | nenhum, ou 14+ | **Não precisa instalar nada.** Se não houver PostgreSQL acessível, o `npm test` sobe um **PostgreSQL embutido e temporário** (veja 2.1). Se você já tem um, ele é usado. |

Não é necessário criar `.env`, criar banco, rodar migração nem rodar seed: os testes fazem isso sozinhos.

## 2. Passo a passo

```bash
npm install
npm test
```

Só isso. Um comando por vez (no macOS/zsh, não cole comentários `#` junto dos comandos).

### 2.1 De onde vem o PostgreSQL?

O `npm test` decide sozinho, nesta ordem:

1. **Um PostgreSQL já acessível** em `localhost:5432` com usuário `greencode` e senha `greencode` (ou o host e as credenciais do seu `DATABASE_URL`, ou o que você definir em `TEST_DATABASE_ADMIN_URL`). Esse é usado.
2. **Nenhum encontrado? Sobe o PostgreSQL embutido** (pacote npm `embedded-postgres`, instalado junto com o `npm install`): um PostgreSQL de verdade, numa porta livre, num diretório temporário, que **desaparece** quando os testes terminam. Sem Docker e sem instalador.
3. **Nem um nem outro?** O teste para na hora e explica o que fazer (veja 2.2). Para rodar só o que não precisa de banco: `npm run test:unit`.

O PostgreSQL embutido não funciona quando o terminal está logado como `root` no Linux (o próprio PostgreSQL recusa). Use um usuário comum ou instale o PostgreSQL pelo 2.2.

### 2.2 Instalando um PostgreSQL de verdade (opcional)

Só se você preferir não usar o embutido, ou se ele não subir. Crie o usuário com permissão de criar bancos (os testes criam e apagam o próprio banco):

```bash
sudo apt install postgresql
sudo -u postgres psql -c "CREATE USER greencode WITH PASSWORD 'greencode' CREATEDB;"
```
(Ubuntu)

```bash
brew install postgresql@16
brew services start postgresql@16
psql postgres -c "CREATE USER greencode WITH PASSWORD 'greencode' CREATEDB;"
```
(macOS com Homebrew)

No **Windows**: instale pelo instalador em postgresql.org (ou `winget install PostgreSQL.PostgreSQL`) e, no "SQL Shell (psql)", rode `CREATE USER greencode WITH PASSWORD 'greencode' CREATEDB;`.

Credenciais diferentes? Informe a conexão de administração (apontando para o banco `postgres`):

```bash
TEST_DATABASE_ADMIN_URL="postgresql://usuario:senha@localhost:5432/postgres" npm test
```
(Linux/macOS)

```powershell
$env:TEST_DATABASE_ADMIN_URL="postgresql://usuario:senha@localhost:5432/postgres"; npm test
```
(Windows PowerShell)

## 3. Comandos

| Comando | O que roda | Precisa de PostgreSQL |
|---|---|---|
| `npm test` | **tudo** (8 arquivos de teste) | sim (usa o embutido se faltar) |
| `npm run test:unit` | regras de domínio + configuração | não |
| `npm run test:api` | API de ponta a ponta: caminho feliz e erros | sim |
| `npm run test:seguranca` | tokens falsificados, injeção de SQL, vazamento de dados, matriz de papéis | sim |
| `npm run test:concorrencia` | disputas simultâneas, transações e rollback | sim |
| `npm run test:requisitos` | cada exigência do PDF da AV2 e cada resposta do professor | sim |
| `npm run test:seed` | executa o seed de verdade (duas vezes) e confere o resultado | sim |
| `npm run test:encerramento` | sobe o servidor como processo, confere a porta e o graceful shutdown | não |

Para rodar um teste específico pelo nome (precisa de um PostgreSQL já acessível):

```bash
npx tsx --test --test-name-pattern="posições 1..3" tests/api.test.ts
```

## 4. O que cada suíte garante

| Arquivo | Garante |
|---|---|
| `tests/dominio.test.ts` | CNPJ (dígitos verificadores), janela de datas do lote, depreciação por tipo, regras de transição (desmonte exige triagem, queda de estado exige justificativa), status do lote derivado, política de senha |
| `tests/config.test.ts` | Porta por variável de ambiente, `JWT_SECRET` obrigatório e forte, valores padrão, CORS |
| `tests/api.test.ts` | Login, provisionamento, papéis, organização, contrato, lote com equipamentos em uma transação, posição sequencial, status derivado, depreciação, versionamento otimista, soft delete em cadeia, delete permanente, usuários, parâmetros, auditoria, CHECKs e triggers do banco |
| `tests/seguranca.test.ts` | Token com outro segredo, `alg: none`, payload adulterado, expirado, usuário inexistente; injeção de SQL; hash nunca aparece nas respostas; campos extras rejeitados; **matriz completa de papéis**; auditor barrado em **todas** as rotas de escrita |
| `tests/concorrencia.test.ts` | Dois provisionamentos simultâneos, dez atualizações com a mesma versão, doze cadastros no mesmo lote, seis triagens simultâneas, NF duplicada concorrente, rollback de transação |
| `tests/requisitos.test.ts` | Camadas controller/service/repository, migrações, `versao` em todos os modelos, UUID e JSONB, unicidade, comando de seed do Prisma; e as respostas do professor: soft delete + delete padrão, cadeia, filhos só com delete, contrato e lote, status do lote, código de barras = id, posição automática, **admin acessa todas as rotas (enumeradas pelo OpenAPI)**, listagens bloqueadas |
| `tests/seed.test.ts` | O seed roda, é idempotente, cria um usuário por papel e uma massa com estados variados |
| `tests/encerramento.test.ts` | O servidor escuta na `PORT` pedida, `SIGTERM` e `SIGINT` encerram com código 0, configuração inválida impede a subida |

## 5. Como o banco de teste funciona

1. Cada arquivo de teste de API conecta ao banco `postgres` com a conexão de administração (a do PostgreSQL encontrado, ou a do embutido).
2. Cria um banco novo, de nome aleatório (`greencode_test_ab12cd34`).
3. Aplica todas as migrações de `prisma/migrations/` (`prisma migrate deploy`).
4. Sobe o aplicativo em memória (`app.inject`, sem abrir porta) e roda os testes.
5. Ao final, apaga o banco temporário (`DROP DATABASE ... WITH (FORCE)`).

Nenhum banco existente é tocado, e os arquivos de teste rodam em paralelo sem interferir uns nos outros (cada um tem o seu banco).

## 6. Resultado esperado

A saída do Node mostra cada suíte e cada teste com `✔`, termina com o resumo (`tests`, `pass`, `fail`) e sai com código 0. Qualquer `✖` imprime o motivo, e o `npm test` sai com código diferente de 0.

## 7. Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| "Não encontrei um PostgreSQL para os testes de API e não consegui subir o embutido" | Nenhum PostgreSQL acessível e o embutido não subiu (roda como root no Linux, ou a plataforma não é suportada). Instale um PostgreSQL (2.2). |
| `Não foi possível criar o banco de teste em ...` | O usuário não pode criar bancos: `ALTER USER greencode CREATEDB;` |
| `SyntaxError` ao iniciar ou `process.loadEnvFile is not a function` | Node antigo (18). Instale o Node 22 LTS. |
| `Cannot find module '.prisma/client'` | O cliente Prisma não foi gerado: rode `npx prisma generate` (o `npm install` já faz isso). |
| `npx prisma migrate deploy` falha dentro do teste | A mensagem aparece no erro do teste; geralmente é credencial errada ou PostgreSQL abaixo da versão 14. |
| `zsh: unknown file attribute: C` | Comentário com parênteses colado no zsh (macOS). Rode só o comando, sem comentário. |
| `error TS5042: Option 'project' cannot be mixed with source files` | Um `# comentário` colado depois de `npm run build` virou argumento do `tsc`. Rode `npm run build` sozinho. |
| `Environment variable not found: DATABASE_URL` | Falta o `.env` (só afeta rodar a API, não os testes). `npm run setup:env` copia o `.env.example`; o `npm run db:setup` já faz isso sozinho. |
| `sh: tsx: command not found` ou `prisma: command not found` | Falta `npm install` (ou ele foi feito em outra pasta). |
| `encerramento.test.ts` pulado no Windows | Esperado em parte: sinais POSIX (`SIGTERM`/`SIGINT` enviados por outro processo) não se comportam igual no Windows. O `Ctrl+C` continua tratado (`SIGINT`/`SIGBREAK`). |
| Porta em uso | Os testes escolhem portas livres sozinhos; nenhuma porta fixa é usada (só o `npm run pg` usa a 5432, ajustável com `PG_PORTA`). |

## 8. Rodando a API manualmente

Precisa de um PostgreSQL com o banco `greencode`. Sem instalar nada: em um terminal, `npm run pg` (PostgreSQL embutido, persistente em `.pgdata/`, fica ligado até o `Ctrl+C`). Em outro terminal:

```bash
npm run db:setup
npm run dev
```

A API sobe em http://localhost:3000 e o Swagger em http://localhost:3000/docs. O `db:setup` cria o `.env` (a partir do `.env.example`), aplica as migrações e roda o seed. Com um PostgreSQL próprio, crie o banco: `CREATE DATABASE greencode OWNER greencode;`. O seed também roda por `npx prisma db seed`.

Logins do seed (senha `Greencode#2026`): `admin`, `cadastro1`, `almox1`, `auditor1`.
