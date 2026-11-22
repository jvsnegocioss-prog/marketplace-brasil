# Trilha de auditoria da conciliação financeira — proposta técnica

**Estado:** API e interface de registro preparadas na branch isolada; schema ainda não criado/testado e nenhum recurso aplicado ao banco.  
**Base funcional:** revisão aprovada de 21/11/2026 (`6abaaac`).  
**Branch de trabalho:** `fix/checkout-stock-recovery`.

## Objetivo

Registrar cada análise administrativa de um evento de reembolso ou chargeback do Mercado Pago sem alterar o evento recebido, o pedido, o pagamento, o estoque ou o cupom.

A trilha é um histórico de ações humanas. Ela não é, por si só, prova de liquidação, estorno, chargeback encerrado ou devolução de valores.

## Estrutura proposta

Criar uma tabela independente, por exemplo `mercado_pago_reconciliation_audit`, com:

| Campo | Finalidade |
| --- | --- |
| `id` | UUID imutável do registro |
| `notification_id` | Referência ao evento original em `mercado_pago_webhook_events.notification_id` |
| `resource_id` | ID da ordem no Mercado Pago no momento da análise |
| `order_id` | UUID do pedido relacionado, quando confirmado |
| `admin_user_id` | Usuário autenticado que registrou a análise (`auth.uid()`) |
| `action` | Categoria controlada da análise |
| `decision_note` | Justificativa obrigatória, com tamanho mínimo e máximo |
| `evidence_reference` | Referência privada a comprovante, preferencialmente caminho de objeto privado; não URL pública |
| `created_at` | Data/hora gerada pelo banco, nunca pelo navegador |
| `submission_key` | Chave UUID única para evitar duplicação acidental de envio |

### Categorias iniciais de ação

- `reviewed_pending`: analisado, mas continua pendente.
- `evidence_requested`: comprovante ou esclarecimento solicitado.
- `escalated`: encaminhado para análise externa/financeira.
- `manual_followup`: exige acompanhamento manual.
- `other`: outra providência, explicada na justificativa.

Essas categorias não encerram nem resolvem automaticamente o evento. Não incluir uma ação `resolve`, `settle`, `refund_confirmed` ou equivalente nesta etapa.

## Controles obrigatórios

1. A API deve validar a sessão com `auth.getUser(token)` e confirmar o administrador por `is_marketplace_admin()` no servidor, antes de qualquer escrita.
2. O identificador do administrador vem exclusivamente da sessão validada; nunca aceitar `admin_user_id` enviado pelo navegador.
3. O servidor deve buscar novamente o evento e confirmar que ele existe e está em `reconciliation_required`.
4. O servidor deve validar a categoria, exigir justificativa não vazia e limitar o tamanho dos campos.
5. A chave `submission_key` deve ser única para que reenvios de rede não criem duplicatas.
6. A tabela deve ter RLS habilitado, sem políticas de leitura ou escrita para `anon` e `authenticated`; acesso somente pelo servidor com credencial privilegiada.
7. A tabela deve ser append-only: negar UPDATE e DELETE por privilégios e adicionar proteção no banco contra alteração/exclusão de registros, inclusive acidental.
8. Não criar endpoint nem botão para resolver, descartar ou reprocessar evento nesta etapa.
9. Não armazenar número de cartão, credenciais, tokens, dados bancários ou comprovantes em URL pública. Se houver anexos futuramente, usar bucket privado, autorização separada e guardar apenas a referência interna.
10. Toda falha de gravação deve ser apresentada como falha; nunca mostrar sucesso sem confirmação do registro persistido.

## Separação entre análise e resolução

A tela de conciliação poderá, numa etapa posterior autorizada, exibir a linha do tempo de análises. A gravação de uma análise não altera `processing_status` do evento e não altera o estado do pedido.

Qualquer fluxo futuro de resolução financeira exigirá projeto próprio, confirmação explícita, evidência adequada, regra específica para reembolso versus chargeback, dupla verificação do estado no Mercado Pago e trilha de auditoria própria. Não deve ser inferido a partir de uma simples correspondência de ID, referência, moeda ou valor original.

## Plano de implementação após aprovação

1. Gerar migration por meio do fluxo oficial da CLI Supabase, revisar SQL e grants.
2. Validar migration em banco descartável, nunca em produção nesta fase.
3. Implementar endpoint POST de registro de análise com validação server-side e idempotência.
4. Implementar leitura da linha do tempo na tela administrativa.
5. Testar: usuário não autenticado, cliente comum, administrador, evento inexistente, evento já não pendente, justificativa vazia, chave repetida, tentativa de UPDATE/DELETE e falha de persistência.
6. Revisar logs, permissões, RLS e advisors antes de qualquer proposta de implantação.

## Estado atual e limites

- Nenhuma tabela foi criada no Supabase de produção.
- Nenhuma migration foi aplicada.
- Nenhuma escrita foi feita em pedidos, eventos, pagamentos, estoque ou cupons.
- A tela e os endpoints existentes continuam somente leitura.
- A implementação de aplicação foi salva no GitHub, mas ainda não foi compilada nem testada funcionalmente.\n- O rascunho SQL não é uma migration formal e não foi aplicado em nenhum banco.\n- Antes de criar migration formal, seguir `supabase migration new`, validar em banco descartável, conferir grants/RLS/triggers e executar os advisors.\n- Confirmar que o schema `public`/tabela está exposto ao Data API para uso server-side via PostgREST; a exposição não deve conceder acesso a `anon` ou `authenticated`.
