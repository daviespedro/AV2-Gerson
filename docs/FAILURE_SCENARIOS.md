# Cenários de falha e resposta do sistema

Todos os erros têm o formato `{ erro, mensagem }`. Os cenários marcados com (T) têm teste em `tests/`.

## Validação (400)
| Cenário | Resposta |
|---|---|
| CNPJ com tamanho errado, sequência repetida ou dígito verificador inválido (T) | 400 ErroValidacao |
| Data de entrada futura, anterior a 90 dias, em formato errado ou impossível, como 2026-02-31 (T) | 400 |
| Frequência de coleta 0 ou data de início inválida (T) | 400 |
| Tipo de equipamento vazio (T) | 400; nada é gravado (o lote inteiro é rejeitado) |
| `desmonte` sem triagem completa (T) | 400 |
| Queda de 2+ categorias de estado físico sem justificativa (T); estado inexistente (T) | 400 |
| Senha fraca ou username curto/com espaço (T) | 400 |
| Campo desconhecido no corpo, tipo errado, id que não é UUID, `tamanhoPagina` > 100, JSON quebrado (T) | 400 |
| Alterar o próprio papel, desativar ou excluir a própria conta (T) | 400 |

## Autenticação e autorização (401/403)
| Cenário | Resposta |
|---|---|
| Sem token, token adulterado ou expirado (T) | 401 |
| Senha errada ou usuário inexistente (T) | 401, mesma mensagem e mesmo tempo |
| Conta desativada, mesmo com token ainda válido (T) | 401 imediato |
| Papel sem permissão na rota (T) | 403 (antes de qualquer validação) |
| Auditor tentando escrever (T) | 403 |
| Delete permanente por quem não é admin (T) | 403 |

## Conflitos (409)
| Cenário | Resposta |
|---|---|
| CNPJ, username, NF (por organização) ou contrato duplicados (T) | 409 |
| Versão desatualizada; duas atualizações simultâneas, uma vence (T) | 409 e nada é gravado |
| Lote em organização sem contrato, com contrato encerrado/apagado ou inativa (T) | 409 |
| Reativar o que já está ativo; inativar o que já está inativo (T) | 409 |
| Excluir usuário com histórico (T) | 409 (use desativar) |
| Segundo provisionamento (T) | 409 |

## Não encontrado (404)
Rota inexistente (T); recurso inexistente; equipamento de lote inativo (T).

## Integridade e persistência
| Cenário | Resposta |
|---|---|
| Falha no meio de uma operação com várias escritas | Rollback total: lote sem equipamentos parciais, status sem movimentação (T) |
| UPDATE/DELETE direto em Movimentacao ou Auditoria (T) | Rejeitado pelo trigger |
| SQL manual violando CHECK (código de barras, posição, `desmonte`, CNPJ) (T) | Rejeitado pelo banco |
| Cadastros simultâneos no mesmo lote (T) | Posições distintas e sequenciais |
| Duas transições simultâneas de equipamentos do mesmo lote | Serializadas pelo lock do lote; o status derivado fica correto |
| Erro interno inesperado | 500 genérico; detalhe só no log |
| SIGINT/SIGTERM/SIGBREAK | Para de aceitar conexões, conclui as requisições em curso, fecha o pool; se passar de `SHUTDOWN_TIMEOUT_MS`, força a saída |
