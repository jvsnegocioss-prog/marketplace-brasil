# Plano de correção — checkout, estoque e histórico de pedidos

## Estado deste trabalho

- Branch criada a partir da revisão aprovada de 21/11/2026.
- Commit-base: `6abaaac027777f967ab77aec9981cd0572878bd6`.
- Este documento registra o plano e o estado da remediação. O código de checkout/webhook e a migration permanecem em rascunho somente nesta branch isolada.
- A migration não foi aplicada; não alterar o banco de produção, não ativar vendas e não executar compras/pagamentos reais durante a auditoria.

## Problemas confirmados na revisão-base

1. O banco de produção possui `public.cancel_unpaid_order_and_restore_stock(uuid)`, mas a função legada retorna `boolean`; a implementação preparada nesta branch exige um retorno estruturado `jsonb` para distinguir os resultados do cancelamento.
2. Na revisão-base, checkout e webhook chamam a função legada. O retorno booleano não comprova que estoque e cupom foram restaurados de forma idempotente, nem fornece os resultados detalhados exigidos pelo novo fluxo.
3. A migration preparada precisa substituir a assinatura existente com retorno `jsonb`. Como PostgreSQL não permite alterar o tipo de retorno com `CREATE OR REPLACE FUNCTION`, ela inclui `DROP FUNCTION` antes da recriação; essa troca ainda precisa ser ensaiada em banco descartável equivalente.
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


## Confirmações adicionais da inspeção do schema

- `orders.status` é texto sem constraint CHECK de valores. O único pedido existente no momento da consulta estava com status `Pago`; isso não comprova todos os estados históricos possíveis.
- `order_items.product_id` referencia `products.id` com `ON DELETE SET NULL`. Se o produto foi excluído, o vínculo necessário para devolver estoque se perde. A RPC proposta falha de forma transacional nesse cenário, sem marcar o pedido como cancelado nem fingir que o estoque foi restaurado.
- `orders.coupon_id` referencia `discount_coupons.id` com `ON DELETE SET NULL`. Quando o cupom ainda existe, a reversão exige contador positivo; caso contrário, a transação falha e não cancela parcialmente.
- A chave de idempotência possui índice único parcial em `orders.checkout_idempotency_key`.
- As duas RPCs de criação atuais são executáveis somente por `service_role`; a nova RPC segue o mesmo limite.
- O histórico da conta usa o JWT do cliente e filtra por `customer_user_id`; não usa chave privilegiada.

## Código preparado na branch isolada

- Migration de rascunho: `supabase/migrations/20261121010000_checkout_stock_recovery_and_customer_binding.sql`.
- Nova RPC `create_store_order_with_coupon_and_delivery_for_customer`: reutiliza a criação transacional existente, grava `customer_user_id` na mesma transação e mantém a idempotência vinculada ao hash e ao titular.
- Nova RPC `cancel_unpaid_order_and_restore_stock`: bloqueia o pedido, permite cancelar apenas `aguardando`, restaura estoque por produto e reverte o uso do cupom dentro da mesma transação. Repetições com registro no ledger retornam `already_restored`; pedidos cancelados sem registro retornam `cancelled_unverified` sem alterar estoque; pedidos pagos não são alterados.
- Checkout atualizado para usar a RPC com titular autenticado e verificar o resultado do cancelamento antes de afirmar que a reserva foi liberada.
- Webhook atualizado para verificar o resultado da RPC e detectar a corrida entre cancelamento e aprovação tardia, retornando conflito para reconciliação manual em vez de marcar automaticamente o pedido como pago.

## Estado de validação

- As alterações estão somente na branch `fix/checkout-stock-recovery`.
- Migration ainda é rascunho: não foi aplicada nem executada contra o Supabase.
- Nenhum teste de integração, pagamento simulado ou build foi executado nesta etapa.
- A função falha integralmente se houver item sem vínculo de produto, produto ausente ou contador de cupom inconsistente; esse cenário exige reconciliação manual.
- Próxima validação necessária: revisão SQL estática detalhada, execução em banco de teste isolado e testes de concorrência/idempotência antes de qualquer Preview ou produção.
- Não foi criado PR, não foi feito merge, não foi autorizado deploy e as vendas continuam sem ativação por este trabalho.


## Segunda rodada de revisão estática

- O trigger `enforce_order_delivery_transition()` só valida mudanças de `delivery_status` e datas de entrega. A alteração isolada de `orders.status` para `Cancelado` não é bloqueada por esse trigger.
- A busca no repositório não encontrou outra rotina ativa que altere o status para cancelado; a interface administrativa apenas reconhece/rotula estados cancelados. Ainda assim, registros cancelados legados ou alterações manuais precisam ser tratados como não verificados.
- Para impedir dupla devolução, a migration agora inclui a tabela interna `order_stock_restorations`, com `order_id` como chave primária, RLS habilitado e sem acesso direto de `anon` ou `authenticated`. A RPC grava o registro na mesma transação que devolve estoque/cupom e muda o pedido para `Cancelado`.
- Repetições com registro no ledger retornam `already_restored`. Pedidos já cancelados sem registro de restauração retornam `cancelled_unverified` e não alteram estoque, evitando assumir que uma devolução anterior não ocorreu.
- A migration e as rotas foram ajustadas para reconhecer somente `cancelled` e `already_restored` como confirmações de devolução.
- O hash da solicitação do checkout foi mantido no formato anterior (sem incluir `customer_user_id`) para não quebrar a idempotência de tentativas antigas de visitantes. A nova RPC ainda confere separadamente o titular armazenado no pedido. Pedidos antigos autenticados sem titular não são associados retroativamente por e-mail.

## Pendências de validação que permanecem

- Confirmar em ambiente isolado que o usuário proprietário da migration/função tem os privilégios necessários para a tabela do ledger e para chamar a RPC original de criação.
- Testar cancelamento concorrente e repetido; rollback se faltar produto/cupom; pedido cancelado legado sem ledger; e aprovação do Mercado Pago concorrente com cancelamento.
- Testar compatibilidade de tentativas antigas de visitantes e rejeição segura de tentativas antigas de contas sem titular.
- Nenhum desses testes foi executado ainda. A migration continua sem aplicação no banco de produção.


## Terceira rodada — persistência do identificador Mercado Pago

- O checkout agora consulta o vínculo atual antes de gravar o ID retornado pelo Mercado Pago.
- A gravação ocorre somente quando `mercado_pago_order_id` ainda está NULL, evitando sobrescrever um identificador diferente em uma corrida.
- Depois da gravação, o checkout verifica o valor persistido. Se a resposta da gravação falhar, faz uma nova leitura para distinguir falha de resposta de gravação efetivamente concluída.
- O checkout só retorna `success: true` e `checkoutUrl` quando o banco confirma que o pedido está vinculado ao mesmo ID Mercado Pago.
- Se o vínculo não puder ser confirmado, a rota preserva o pedido (não chama cancelamento depois de iniciar a chamada externa), não entrega a URL de pagamento e responde com indicação de reconciliação. Divergência de IDs retorna conflito.
- A interface atual mantém a mesma chave de idempotência no armazenamento local enquanto a resposta do checkout não for bem-sucedida; portanto, uma nova tentativa com o mesmo conteúdo reutiliza a chave. A chave do Mercado Pago também é determinística por pedido.
- Esta é uma correção estática de código. Não houve chamada real ao Mercado Pago, teste de banco, build, Preview ou teste de concorrência.


## Quarta rodada — compatibilidade do tipo de retorno da RPC de cancelamento

- Consulta somente leitura ao catálogo PostgreSQL de produção confirmou que já existe `public.cancel_unpaid_order_and_restore_stock(uuid)` com retorno `boolean`.
- A versão preparada na branch declara a mesma assinatura com retorno `jsonb`, para fornecer resultados explícitos (`cancelled`, `already_restored`, `cancelled_unverified`, entre outros) consumidos pela rota.
- PostgreSQL não permite trocar o tipo de retorno com `CREATE OR REPLACE FUNCTION`. Sem tratamento, a migration falharia ao ser aplicada.
- A migration isolada foi corrigida para executar `DROP FUNCTION IF EXISTS public.cancel_unpaid_order_and_restore_stock(uuid)` imediatamente antes de recriar a função com retorno `jsonb`. A remoção e recriação precisam ocorrer na mesma transação de migration; revisar dependências e grants no ensaio isolado.
- Também foi incluída validação defensiva para não restaurar quantidades nulas ou menores/iguais a zero.
- O banco de produção não foi alterado. A correção foi feita somente no arquivo SQL da branch.
- Ainda é obrigatório testar a migration inteira em um clone/ambiente descartável com schema equivalente, inclusive o comportamento de rollback e a permissão de execução final.
