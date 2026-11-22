# Plano de correção — checkout, estoque e histórico de pedidos

## Estado deste trabalho

- Branch criada a partir da revisão aprovada de 21/11/2026.
- Commit-base: `6abaaac027777f967ab77aec9981cd0572878bd6`.
- Este documento é planejamento técnico; não altera banco, rotas, checkout, webhook ou configurações.
- Não aplicar migrations em produção, não ativar vendas e não executar compras/pagamentos reais durante a auditoria.

## Problemas confirmados na revisão-base

1. O checkout e o webhook chamam `cancel_unpaid_order_and_restore_stock`, mas essa função não existe no banco de produção.
2. No checkout, falhas em etapas posteriores à criação do pedido podem acionar a RPC ausente. O tratamento registra o erro, mas não comprova que o pedido foi cancelado nem que o estoque foi devolvido.
3. O webhook devolve erro HTTP 500 se a RPC de cancelamento falhar, mas a rotina de cancelamento continua indisponível até a função ser criada.
4. O checkout identifica o usuário autenticado, mas a chamada atual de criação do pedido não persiste `customer_user_id`. O histórico da conta filtra por esse campo.
5. O pedido guarda `coupon_id`; a tabela `discount_coupons` controla `usage_count`. A reversão do cupom deve ocorrer no mesmo procedimento transacional e somente uma vez.

## Implementação proposta — ainda não aplicada

### A. RPC transacional de cancelamento

Criar uma função PostgreSQL dedicada, executável somente por `service_role`, com:

- `SECURITY DEFINER` e `search_path` fixo/seguro; referências a objetos qualificadas por schema.
- Bloqueio do pedido com `SELECT ... FOR UPDATE`.
- Cancelamento permitido somente para pedido ainda `aguardando`; nunca cancelar pedido pago/aprovado.
- Atualização de estado e restauração de estoque dentro da mesma transação.
- Restaurar cada `order_items.quantity` usando `product_id`; itens sem produto vinculado devem ser tratados explicitamente, sem adivinhar produto pelo nome.
- Decrementar `discount_coupons.usage_count` somente se o pedido realmente transitar de aguardando para cancelado e tiver `coupon_id`.
- Idempotência: chamadas repetidas não podem somar estoque nem reverter cupom novamente.
- Retorno estruturado que diferencie cancelado agora, já cancelado e não elegível.
- Falha em qualquer etapa deve abortar a transação inteira.

Antes de codificar, confirmar valores de status existentes, constraints/FKs e política de estoque para produtos removidos ou desativados.

### B. Checkout

- Persistir `customer_user_id` com o ID retornado por `auth.getUser(token)`, dentro da operação de criação do pedido sempre que possível.
- Não associar pedidos antigos por igualdade de e-mail.
- Em falha posterior à criação, chamar a RPC e validar o resultado explícito.
- Não informar cancelamento concluído se a RPC falhar ou retornar estado não confirmado.
- Preservar a chave de idempotência e o hash da requisição; não criar pedido duplicado em retry.

### C. Webhook Mercado Pago

- Manter a validação de assinatura e a consulta do pedido no Mercado Pago.
- Para status cancelado/falho, chamar a RPC e validar o retorno estruturado.
- Notificações repetidas devem ser seguras.
- Um pagamento processado/aprovado não pode ser revertido por notificação atrasada de cancelamento.
- Não atualizar o pedido como pago se ele já tiver sido cancelado; tratar a divergência para revisão manual.

### D. Histórico da conta

- Confirmar que o pedido recém-criado com sessão autenticada contém o mesmo `auth.uid()` em `customer_user_id`.
- Manter a consulta do histórico restrita ao ID autenticado.
- Não revelar nem recuperar pedidos de convidados por e-mail.

## Testes obrigatórios antes de qualquer liberação

1. Cancelar pedido aguardando: estoque volta exatamente à quantidade comprada.
2. Repetir cancelamento: estoque não aumenta novamente.
3. Cancelar pedido com cupom: uso do cupom é revertido uma única vez.
4. Repetir webhook cancelado/falho: nenhum efeito duplicado.
5. Tentar cancelar pedido pago: operação recusada sem alterar estoque ou cupom.
6. Simular falha durante restauração: transação inteira sofre rollback.
7. Duas tentativas concorrentes de cancelamento: somente uma executa os efeitos.
8. Checkout autenticado: `customer_user_id` é gravado e pedido aparece no histórico correto.
9. Checkout convidado: `customer_user_id` permanece NULL e não é associado por e-mail.
10. Retry de checkout com mesma chave/hash: retorna o pedido existente sem duplicar estoque, pedido ou cupom.
11. Falha depois da criação: resposta só informa cancelamento quando a RPC confirmar.
12. Webhook de aprovação após cancelamento: não reabre nem marca pedido como pago automaticamente; gera tratamento de divergência.

## Critérios de conclusão

- Migration revisada estaticamente e aplicada primeiro apenas em ambiente de teste controlado, se disponível.
- Testes automatizados de unidade/integração e build aprovados.
- Teste de webhook com payloads simulados e credenciais de teste, sem transação financeira real.
- Revisão de segurança das permissões da RPC.
- Preview validado manualmente.
- Liberação de produção, ativação de vendas e qualquer alteração no Supabase de produção exigem autorização separada e explícita.
