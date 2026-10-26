# Segurança

## Senhas
- **bcrypt** (`bcryptjs`), salt aleatório embutido no hash, custo configurável (`BCRYPT_ROUNDS`, padrão 12). O hash nunca sai da API (as respostas de usuário não têm `senhaHash`).
- Política: 8+ caracteres, 1 maiúscula e 1 número, aplicada em criação, redefinição e troca.
- Login não revela se a conta existe, está inativa ou a senha errou: mesma resposta 401 e **mesmo tempo** (o bcrypt sempre roda; sem conta, contra um hash isca). Falhas e sucessos entram na auditoria.

## Sessão (JWT)
- HS256, expiração `JWT_EXPIRES_IN` (padrão 30 min). `JWT_SECRET` com menos de 32 caracteres impede a API de subir.
- O usuário é relido no banco a cada requisição: conta desativada ou papel alterado vale imediatamente. É o que substitui a "sessão em memória" e o custo é uma consulta por requisição.
- Sem refresh token: ao expirar, novo login.

## Autorização (RBAC)
- Papéis: `admin`, `cadastro`, `almoxarifado`, `auditor` (matriz em `docs/API.md`). Cada rota declara os papéis que aceita; a checagem roda antes da validação do corpo, então sem permissão é sempre 403.
- O auditor é bloqueado em qualquer método que não seja leitura por um hook global (segunda camada, além da lista de papéis de cada rota). Única exceção: trocar a própria senha.
- Operações irreversíveis (`?permanente=true`) são só do admin. Ninguém altera o próprio papel, se desativa ou se exclui.

## Banco
- Todas as consultas passam pelo Prisma (parametrizadas); os poucos SQL brutos usam parâmetros do template (`${id}::uuid`).
- CHECKs e triggers impedem estados inconsistentes e tornam **Movimentacao** e **Auditoria** imutáveis (UPDATE/DELETE diretos são rejeitados).
- A trilha de auditoria é gravada na mesma transação da operação.

## Entrada e erros
- JSON Schema em todas as rotas (`additionalProperties: false`, tipos, formatos, tamanhos); corpo limitado a 1 MB; até 500 equipamentos por lote.
- Erros padronizados `{ erro, mensagem }`; falhas internas viram 500 genérico (detalhes só no log).
- CORS bloqueado por padrão (`CORS_ORIGIN`).

## Limitações conhecidas
Sem rate limiting nem bloqueio por tentativas de login; sem refresh token; segredo simétrico; HTTPS fica por conta de um proxy reverso; o Swagger (`/docs`) é público (desative-o em produção se necessário).
