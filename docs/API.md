# greencode API

Servidor HTTP monolítico: Node.js + TypeScript, **Fastify**, **Prisma ORM**, **PostgreSQL**. Prefixo `/api/v1`. Swagger interativo em `/docs`; contrato exportável com `npm run docs:openapi`.

## 1. Camadas

```
HTTP -> modules/<x>/<x>.controller.ts   rota, JSON Schema, papéis permitidos; sem regra de negócio
        -> <x>.service.ts               regras de negócio, validações, transações, versionamento
           -> <x>.repository.ts         único lugar que usa o Prisma
              -> PostgreSQL             constraints, índices, triggers
```

`dominio/` guarda regras puras (sem banco nem HTTP) que os services chamam: validação de CNPJ, janela de datas do lote, perfis de depreciação, transições de equipamento e derivação do status do lote. Por isso são testadas sem banco (`tests/dominio.test.ts`).

## 2. Modelo de dados

`Organizacao 1—0..1 Contrato`, `Organizacao 1—N Lote`, `Lote 1—N Equipamento`, `Equipamento 1—N Movimentacao`, mais `Usuario`, `Auditoria` e `ParametroGlobal`. Ids são UUID; `Contrato.clausulas` é JSONB; **todo modelo tem `versao`** (nas tabelas imutáveis, Movimentacao e Auditoria, ela fica constante em 1).

Restrições no banco (migração `integridade`), a última barreira mesmo para quem contorna a API:

| Regra | Mecanismo |
|---|---|
| CNPJ único, 14 dígitos | `UNIQUE` + `CHECK` |
| Código de barras = id do equipamento, único | `UNIQUE (codigoBarrasInterno)` + `CHECK (codigoBarrasInterno = id::text)` |
| Posição única no lote, >= 1 | `UNIQUE (loteId, posicao)` + `CHECK` |
| Um contrato por organização; NF única por organização | `UNIQUE (organizacaoId)`, `UNIQUE (organizacaoId, nf)` |
| Frequência > 0; `versao >= 1`; chave de parâmetro válida | `CHECK` |
| `desmonte` exige triagem completa | `CHECK` |
| Movimentação com pares de/para coerentes | `CHECK` |
| Movimentação e Auditoria imutáveis | `TRIGGER` bloqueando UPDATE/DELETE diretos (a cascata de FK é permitida) |
| Delete permanente em cadeia | FKs `ON DELETE CASCADE`: organização -> contrato/lotes -> equipamentos -> movimentações |
| Usuário com histórico não é apagado | FKs `ON DELETE RESTRICT` (409; use desativar) |

## 3. Autenticação (JWT stateless)

1. `POST /auth/login` confere a senha com bcrypt (hash isca quando a conta não existe: tempo constante, mensagem genérica) e devolve um JWT HS256 com `sub`, `username` e `papel`.
2. O cliente envia `Authorization: Bearer <token>`.
3. Um hook global valida assinatura e expiração (padrão 30 min) e **relê o usuário no banco**: desativar a conta ou trocar o papel vale na hora.
4. Autorização por rota (`permitir(...)`), que roda antes da validação do corpo: quem não tem permissão sempre recebe 403. O **auditor** é bloqueado em qualquer método que não seja leitura (exceto trocar a própria senha).

| Recurso | admin | cadastro | almoxarifado | auditor |
|---|---|---|---|---|
| `/usuarios`, `/config` | sim | — | — | — |
| `/organizacoes`, `/contratos` | sim | sim | — | leitura |
| `/lotes` | sim | sim (sem equipamentos) | sim | leitura |
| `/equipamentos` | sim | — | sim | leitura |
| `/rastreio/:id` | todos | todos | todos | todos |
| `/auditoria` | leitura | — | — | leitura |

## 4. Transações e concorrência

- **`$transaction`** (via `transacao()` em `db.ts`): lote + equipamentos (tudo ou nada); mudança de status/estado + movimentação + auditoria + status do lote; inativação em cadeia; todo cadastro/alteração com sua linha de auditoria.
- **Versionamento otimista**: `UPDATE ... WHERE id = ? AND versao = ?` incrementando `versao`; zero linhas = **409**. O cliente pode enviar a `versao` que leu; se omitir, vale a lida dentro da própria transação.
- **Lote travado** (`SELECT ... FOR UPDATE`) nas operações que mexem em equipamentos: serializa transições do mesmo lote, para o status derivado nunca ser calculado sobre dados velhos.
- **Posição**: contador `Lote.proximaPosicao` incrementado atomicamente. Não é renumerada após exclusões (referência estável).

## 5. Endpoints (`/api/v1`)

| Método e rota | Descrição |
|---|---|
| `GET /health` | saúde (público) |
| `POST /auth/provisionar` | cria o 1º admin (só com o banco sem usuários) |
| `POST /auth/login` · `GET /auth/me` · `POST /auth/senha` | login, usuário atual, troca da própria senha |
| `POST/GET /usuarios` · `PATCH /usuarios/:id/{username,papel,senha,ativo}` · `DELETE /usuarios/:id[?permanente=true]` | gestão de usuários (admin) |
| `POST/GET /organizacoes` · `GET/PATCH /organizacoes/:cnpj` · `DELETE /organizacoes/:cnpj[?permanente=true]` · `POST /organizacoes/:cnpj/reativar` | organizações |
| `POST/GET /contratos` · `GET/PATCH/DELETE /contratos/:id` · `POST /contratos/:id/{encerrar,reativar}` | contratos (só delete permanente) |
| `POST/GET /lotes` · `GET/PATCH /lotes/:id` · `DELETE /lotes/:id[?permanente=true]` · `POST /lotes/:id/reativar` | lotes (criação aceita `equipamentos[]`; status derivado) |
| `POST/GET /equipamentos` · `GET/PATCH/DELETE /equipamentos/:id` | equipamentos (só delete permanente) |
| `POST /equipamentos/:id/triagem` · `PATCH /equipamentos/:id/{status,estado}` | transições de negócio |
| `GET /equipamentos/:id/depreciacao?meses=N` | depreciação com a curva do tipo |
| `GET /rastreio/:id` | equipamento + histórico de movimentações |
| `GET/PUT/DELETE /config[/:chave]` | parâmetros globais (admin) |
| `GET /auditoria?acao=` | trilha de auditoria |

Listagens aceitam `pagina` e `tamanhoPagina` (máx. 100) e respondem `{ itens, total, pagina, tamanhoPagina, totalPaginas }`; organizações, contratos e lotes aceitam `incluirInativos=true`. Erros: `{ erro, mensagem }` com 400 validação, 401 não autenticado, 403 sem permissão, 404 não encontrado, 409 conflito (duplicidade, versão, regra), 500.

## 6. Regras confirmadas pelo cliente

| Resposta do cliente | Implementação |
|---|---|
| Soft delete (inativar) **e** delete padrão | `DELETE /x/:id` inativa; `?permanente=true` apaga de vez. Organização, lote e usuário têm os dois; **o permanente é só do admin** (irreversível) |
| Comportamento em cadeia | Inativar organização inativa todos os seus lotes (mesmo carimbo `inativadoEm`); equipamentos somem junto com o lote. Reativar a organização reativa **só** os lotes inativados com ela. Permanente apaga contrato, lotes, equipamentos e movimentações (FK `CASCADE`) |
| Equipamento e contrato: só delete | `DELETE /equipamentos/:id` e `/contratos/:id` são definitivos. O contrato ainda pode ser *encerrado* (fica inativo) |
| Sem contrato a organização **não** fica inativa, mas não recebe lotes | Criar lote exige organização ativa **e** contrato ativo (409) |
| Inativar organização com contrato ativo: sem restrição | Permitido |
| Status do lote só muda quando **todos** os equipamentos têm o mesmo status | `dominio/lote.ts`. Todos `aguardando_triagem` -> `recebido`; todos `em_triagem` -> `em_triagem`; todos `triado` -> `triagem_completa`; todos em `reciclagem`/`descarte_seguro`/`revenda` -> `encerrado` (mistura de destinos conta: **interpretação nossa**). Não é editável pela API |
| Código de barras é o id do equipamento | O servidor gera o UUID e grava em `id` e `codigoBarrasInterno` (CHECK garante a igualdade) |
| Posição no lote automática, como índice de array | 1, 2, 3... por lote |
| Admin acessa todas as rotas | Todas as rotas incluem `admin` |
| Operador não vê a lista de usuários | `/usuarios` só admin |
| Scripts de teste ajudam, não são obrigatórios | `npm test` |

## 7. Decisões, trade-offs e alternativas rejeitadas

| Decisão | Por quê | Alternativa rejeitada / custo |
|---|---|---|
| Monólito em camadas | Deploy e depuração simples nesta fase; transações ACID entre entidades; regra de negócio independente de HTTP | Microsserviços: rede e consistência eventual sem ganho agora. Custo: escala em bloco |
| Fastify | JSON Schema nativo (400 antes do controller), Swagger a partir dos mesmos schemas, hooks, desempenho | Express: exige libs extras para validação |
| Prisma + PostgreSQL | Tipos gerados, migrações versionadas, `$transaction`; ACID, JSONB, UUID, CHECK e triggers | SQL puro: mais código e menos tipos. Custo: constraints avançadas ficam em SQL de migração |
| JWT stateless + releitura do usuário | Escala sem sessão em memória e ainda revoga na hora | JWT puro não revoga até expirar. Custo: 1 consulta por requisição |
| `bcryptjs` | bcrypt em JS puro: instala igual em Windows 10+ e Ubuntu 24.04+, sem compilar | Módulo nativo `bcrypt`: mais rápido, mas depende de binário por plataforma. Custo: hash um pouco mais lento |
| Versionamento otimista | Evita atualização perdida sem bloquear linhas; conflito é raro | Lock pessimista em tudo serializa. Usamos lock só no lote, onde a regra agrega vários registros |
| Auditoria no banco, na mesma transação | Atomicidade real: ou a operação e o registro persistem, ou nenhum | Arquivo de log: não participa da transação |
| Constraints e triggers além do código | Protege de bugs e de acesso direto ao banco | Só validar no código. Custo: regra duplicada (o service dá a mensagem amigável; o banco é a barreira final) |
| Depreciação por perfil por tipo (estratégia) | Cada tipo tem sua curva; tipo novo = uma linha; tipo desconhecido cai no perfil genérico | Hierarquia de classes: mais código sem ganho nesta API |
| Contador de posição no lote | Atômico, sem corrida | `MAX(posicao)+1`: corrida entre requisições |

**Cálculo financeiro:** a depreciação (`GET /equipamentos/:id/depreciacao?meses=N`) usa uma curva própria de cada tipo (`dominio/equipamento.ts`) e vive na camada de regras, como a atividade pede. A alíquota de ICMS fica como parâmetro global (`/config/aliquota_icms`), pronta para cálculos tributários futuros sem mudar código.

Datas de lote são validadas contra a data UTC do servidor (sem futuro, no máximo 90 dias atrás); clientes muito à frente do UTC podem ter "hoje" rejeitado nas primeiras horas do dia.

Limitações conhecidas: sem rate limiting ou bloqueio por tentativas de login; sem refresh token (expira em 30 min e exige novo login); segredo JWT simétrico (HS256): em produção use segredo forte por ambiente e HTTPS num proxy reverso.

## 8. Limites do monólito

A atividade pede uma reflexão sobre onde esta arquitetura deixa de ser a melhor escolha. A decisão de hoje (um processo, um banco) é consciente para este estágio; estes são os pontos em que ela começa a doer e o que fazer:

| Limite | Por que acontece aqui | Primeiro passo |
|---|---|---|
| Escala em bloco | Todo o sistema sobe e desce junto, mesmo que só a listagem esteja pesada | A API é *stateless* (JWT, nenhuma sessão em memória): dá para rodar várias cópias atrás de um balanceador sem mudar código |
| O banco é o acoplamento | Organização, lote e equipamento se enxergam por chaves estrangeiras, cascatas e transações compartilhadas | Manter o acesso a dados só nos repositories: se um módulo sair, o contrato dele já está isolado |
| Transações atravessam módulos | Criar lote + equipamentos, mover status + movimentação + status do lote e a inativação em cadeia são atômicos | Num futuro distribuído isso viraria saga/eventos, com consistência eventual: é o custo real de dividir |
| Lock por lote | O `FOR UPDATE` serializa mudanças do mesmo lote; lotes enormes e muito disputados viram gargalo | Lotes menores, ou recalcular o status do lote de forma assíncrona |
| Falha e implantação conjuntas | Um bug em qualquer módulo derruba todos; todo deploy leva tudo | Testes automatizados (`npm test`) e migrações versionadas reduzem o risco |
| Várias equipes no mesmo código | Conflitos e releases coordenados | Fronteiras já existem (`modules/`), então a divisão por equipe pode acompanhá-las |

Candidatos naturais a sair primeiro, se o volume exigir: **auditoria** (só escrita, imutável, pode ser assíncrona), **cálculos e relatórios** (consomem CPU) e **integrações/notificações**. Enquanto o volume for o de um empreendimento em estágio inicial, os custos de rede, observabilidade distribuída e consistência eventual superam o ganho: por isso monólito.
