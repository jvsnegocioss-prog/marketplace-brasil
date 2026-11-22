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

## Quinta rodada — confirmação somente leitura dos tipos e da RPC de criação

- Consulta ao catálogo de produção confirmou que `products.stock` é `integer NOT NULL DEFAULT 0`, `order_items.quantity` é `integer NOT NULL DEFAULT 1`, `discount_coupons.usage_count` é `integer NOT NULL DEFAULT 0`, e `order_items.product_id` permanece anulável por causa do vínculo histórico com produto.
- Os tipos usados pela RPC de cancelamento preparada são compatíveis com essas colunas. A verificação de quantidade nula continua defensiva; a verificação de quantidade menor/igual a zero permanece necessária.
- Foi confirmada a existência da RPC-base de 7 argumentos `create_store_order_with_coupon_and_delivery(text,text,text,text,jsonb,text,uuid)`, com retorno UUID, proprietária `postgres`, SECURITY DEFINER e execução concedida a `service_role`, não a `anon` ou `authenticated`.
- Também existe a versão legada de 9 argumentos com chave/hash de idempotência. A nova RPC de 10 argumentos usa nome próprio e chama diretamente a RPC-base de 7 argumentos; não substitui nem altera a versão legada.
- A consulta foi somente leitura. Nenhuma função, tabela, permissão ou dado de produção foi alterado.
- Ainda não foi possível provar em ambiente descartável que a migration completa executa e reverte corretamente. A validação dinâmica continua bloqueada até existir banco de teste equivalente.

## Sexta rodada — bloqueio de contrato na integração Mercado Pago (documentação oficial)

- Revisada a referência oficial do endpoint Checkout Transparente `POST /v1/orders`: https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api/create-order/post
- A documentação descreve `processing_mode` como `automatic` ou `manual`. O modo automático processa a transação em uma etapa e exige os dados da transação; o modo manual permite criar uma order em etapas e processá-la depois.
- O código desta branch envia `processing_mode: "manual"`, `capture_mode: "automatic_async"` e não envia `transactions`. A documentação informa que `transactions` é opcional em modo manual, mas não documenta `checkout_url` como campo da resposta de criação.
- A rota, porém, considera a criação bem-sucedida somente quando a resposta contém `checkout_url`, e depois devolve esse link ao navegador. Portanto, o contrato usado pela rota não está demonstrado pela referência oficial do endpoint.
- A documentação oficial mostra que Checkout Transparente processa pagamentos por meio de dados de transação (por exemplo, método de pagamento e token) ou por um fluxo manual com etapas posteriores. Ela não sustenta que criar uma order manual sem transação gere uma URL hospedada de checkout.
- **Bloqueio:** não mudar `processing_mode`, payload, endpoint nem interface até decidir e validar qual produto/fluxo Mercado Pago a loja pretende usar: Checkout Pro com preferência/URL de checkout hospedada, ou Checkout Transparente com coleta e envio dos dados do meio de pagamento.
- A referência de migração oficial também informa que `checkout_url` não é um campo equivalente documentado na resposta da Orders API; a resposta traz ID, status, transações e demais campos próprios da order.
- Nenhuma chamada real à API do Mercado Pago foi feita nesta revisão. Nenhuma credencial foi acessada. Nenhuma alteração no Supabase de produção.



## Sétima rodada — correção da análise do contrato: Checkout Pro via Orders API

- **Correção importante da sexta rodada:** a conclusão anterior de que a Orders API não documentava `checkout_url` foi incorreta porque a referência consultada era a do Checkout Transparente. A documentação oficial atual separa explicitamente Checkout Pro via Orders API e Checkout Transparente via Orders API.
- A documentação oficial do Checkout Pro via Orders API confirma que:
  - `POST https://api.mercadopago.com/v1/orders` é o endpoint de criação.
  - `type: "online"` e `processing_mode: "manual"` são os valores exigidos para Checkout Pro.
  - `capture_mode: "automatic_async"` é uma opção documentada.
  - `items`, `total_amount`, `external_reference` e `payer.email` seguem o formato usado na rota atual.
  - A resposta contém `id` e `checkout_url`, e o comprador deve ser redirecionado para essa URL.
- Portanto, o payload e o contrato central de criação já presentes em `app/api/checkout/route.ts` são compatíveis, em princípio, com o Checkout Pro via Orders API. Não é necessário migrar para Preferences API; a documentação oficial recomenda o caminho Orders API para novas integrações.
- Referências oficiais corretas:
  - Criar order Checkout Pro: https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/create-order
  - URLs de retorno: https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/web-integration/configure-back-urls
  - Notificações Checkout Pro: https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/notifications
  - Status da order: https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/payment-management/status/order-status
- A documentação de URLs de retorno recomenda configurar `config.online.success_url`, `failure_url`, `pending_url` e, quando desejado, `auto_return`. O código atual ainda não envia esse objeto; é uma melhoria de integração a avaliar após identificar a URL pública correta e as rotas de retorno existentes.
- A documentação de notificações Checkout Pro mostra evento `type: "order"`, dados em `data.id`, status e valores, e orienta consultar `GET /v1/orders/{order_id}` antes de atualizar o sistema. O webhook atual já consulta a order pela API, valida assinatura, referência externa, vínculo, valores e transações; esses controles devem ser preservados e confrontados com o formato oficial em testes.
- A sexta rodada permanece no histórico para rastreabilidade, mas seu bloqueio sobre ausência de `checkout_url` fica expressamente revogado por esta correção documental.
- Próxima etapa: revisar o frontend que consome `checkoutUrl`, definir e validar URLs de retorno no domínio correto, revisar o webhook contra o payload oficial Checkout Pro Orders e preparar testes com credenciais de teste. Nenhuma credencial foi acessada e nenhuma chamada de pagamento foi feita.
- Esta atualização é documental. Não altera rotas, banco, variáveis de ambiente, produção ou estado de vendas.



## Oitava rodada — retorno do Checkout Pro e auditoria do webhook

- A documentação oficial atual do Checkout Pro via Orders confirma que as URLs de retorno são configuradas em `config.online.success_url`, `failure_url`, `pending_url` e `auto_return`. Os parâmetros que retornam na URL são informativos: não podem, sozinhos, marcar pedido como pago; o estado precisa ser confirmado pela API/notificação.
- Domínio canônico atualmente associado ao projeto Vercel, confirmado por consulta somente leitura: `https://novashoppstore.vercel.app`. O domínio alternativo `marketplace-brasil.vercel.app` redireciona para ele.
- Na branch `fix/checkout-stock-recovery`, não foram encontrados arquivos de retorno em `app/checkout/retorno/page.tsx`, `app/checkout/sucesso/page.tsx`, `app/checkout/falha/page.tsx`, `app/checkout/pendente/page.tsx` ou `app/checkout/return/page.tsx`. Portanto, ainda é necessário criar uma página de retorno que explique aprovado/recusado/pendente sem confiar nos parâmetros como confirmação financeira.
- A rota de checkout já devolve `checkoutUrl` e o frontend redireciona para ela. O frontend apaga a chave de idempotência local imediatamente antes do redirecionamento. Isso merece ajuste: se a navegação externa falhar ou o comprador voltar para repetir a mesma tentativa, uma nova chave local pode gerar outro pedido. Preservar a chave até uma condição de conclusão segura ou associá-la ao orderId precisa ser desenhado sem quebrar o reuso de tentativa.
- A rota de checkout ainda não inclui `config.online` com URLs de retorno. A implementação deve usar o domínio do deployment correto (Preview para testes e domínio canônico em produção), sem fixar URL de Preview no ambiente de produção. O domínio canônico acima está identificado; o mecanismo de resolução de URL por ambiente ainda precisa ser definido e revisado.
- Auditoria estática do webhook atual:
  - exige `data.id`, `x-signature` e `x-request-id`, valida HMAC com comparação em tempo constante e consulta a order diretamente em `GET /v1/orders/{id}`;
  - confere `external_reference` UUID, ID Mercado Pago, vínculo do pedido, moeda BRL, total da order, total pago e transações processadas antes de marcar como Pago;
  - reconhece o status de sucesso `processed` e os estados terminais `canceled`/`failed` para tentar cancelamento idempotente.
- A documentação atual do Checkout Pro recomenda evento Order e confirma que o corpo inclui `data.id`, que deve ser consultado em `GET /v1/orders/{id}`; o webhook deve responder HTTP 200/201 quando a notificação foi recebida corretamente. A rota já consulta o recurso oficial, mas seu tratamento de status e resposta precisa ser testado com payloads reais de sandbox.
- A tabela oficial de status também inclui `created`, `processing`, `action_required`, `refunded` e `charged_back`. O código atual não trata explicitamente reembolso/chargeback; não deve restaurar estoque automaticamente nesses estados, mas deve sinalizar/reconciliar o pedido e manter a trilha financeira para tratamento administrativo.
- Atenção: na documentação Checkout Pro Orders o status consolidado de cancelamento é `canceled` (um L), e sucesso é `processed`. O código usa essas grafias.
- Esta rodada foi somente leitura e documental. Nenhuma rota funcional foi modificada, nenhuma migration foi aplicada, nenhuma credencial foi acessada e nenhum teste de pagamento foi executado.
- Próxima etapa segura: desenhar a página única de retorno com estado não confiável vindo da URL, ajustar resolução de URL por ambiente, corrigir retenção da chave idempotente e adicionar cobertura para todos os estados oficiais do webhook antes de qualquer ensaio de sandbox.


## Nona rodada — implementação inicial do retorno do Checkout Pro

- `app/api/checkout/route.ts` agora envia `config.online.success_url`, `failure_url`, `pending_url` e `auto_return: "approved"` para o Checkout Pro.
- A URL usa `VERCEL_PROJECT_PRODUCTION_URL` (com fallback para o domínio canônico `novashoppstore.vercel.app`) em produção e `VERCEL_URL` no Preview. Não usa o cabeçalho Host fornecido pelo navegador.
- Criada `app/checkout/retorno/page.tsx`. A página é deliberadamente neutra: explica que o comprador retornou do Mercado Pago, mas não interpreta query params como confirmação de pagamento. O link de acompanhamento leva à área de rastreamento existente.
- Em `app/page.tsx`, a chave local `novashopp_checkout_idempotency_v1` deixa de ser removida antes do redirecionamento e também deixa de ser apagada automaticamente em respostas HTTP 409. Isso prioriza não criar outro pedido enquanto a situação da tentativa anterior não estiver confirmada.
- Limitação conhecida: a chave fica retida para o mesmo fingerprint mesmo se o pedido anterior já tiver sido cancelado/encerrado. Antes de permitir nova tentativa com o mesmo conteúdo, será necessário consultar de forma autenticada o estado do pedido e só então limpar/rotacionar a chave com segurança. A página de retorno ainda não consulta nem exibe o estado real do pedido.
- Em `app/api/mercadopago/webhook/route.ts`, os estados `refunded` e `charged_back` agora geram log de reconciliação e resposta de recebimento, sem alterar status nem restaurar estoque automaticamente.
- Limitação importante: esse sinal de reembolso/chargeback está apenas no log da função e na resposta HTTP; ainda não existe registro persistente de reconciliação nem painel administrativo para esses eventos. Implementar trilha persistente antes de liberar vendas.
- O Preview automático da Vercel para o commit documental anterior `8b533b7` foi encontrado em estado `READY`; isso não é evidência de teste sandbox nem validação funcional destas mudanças mais recentes.
- As alterações desta rodada estão apenas na branch de preparação. Não houve teste de pagamento, chamada real ao Mercado Pago, aplicação de migration, alteração do Supabase de produção, merge, deploy de produção ou ativação de vendas.
- Próximas validações: revisar o contrato exato do `config.online` no Preview, verificar a compilação dos novos arquivos, implementar consulta autenticada do estado do pedido e persistência de eventos de reconciliação, e então testar os estados de retorno e webhook com credenciais sandbox.


## Décima rodada — trilha persistente para reembolso e contestação

- Consulta somente leitura ao schema de produção confirmou que `public.mercado_pago_webhook_events` já existe, tem RLS habilitado, chave primária `notification_id`, campos `resource_id`, `request_id`, `notification_type`, `processing_status`, `last_error_code` e `last_received_at`, e concede INSERT/SELECT/UPDATE a `service_role` (sem acesso direto para `anon`/`authenticated`).
- A constraint atual de `processing_status` aceita `received`, `processing`, `processed`, `failed` e `ignored`. A migration da branch agora amplia a lista para incluir `reconciliation_required`.
- Para `refunded` e `charged_back`, o webhook passa a fazer upsert de um registro com `notification_id` baseado no `x-request-id`, `resource_id` igual ao ID da order Mercado Pago, `notification_type: "order"` e `last_error_code` específico do status.
- Se a gravação falhar, o webhook responde HTTP 500 para permitir nova tentativa da notificação. Se for gravada, responde recebimento confirmado com `reconciliationRequired: true`. Nenhuma alteração de status do pedido ou estoque é feita automaticamente.
- O uso de `x-request-id` como chave de registro identifica a entrega HTTP; reentregas que chegarem com outro request ID podem gerar linhas separadas para o mesmo recurso. Isso preserva a trilha de entregas, mas não substitui uma chave de evento nativa caso o Mercado Pago disponibilize uma no payload.
- A consulta ao banco foi somente leitura. A constraint não foi alterada em produção, a migration continua não aplicada e não foram inseridos eventos de teste.
- Ainda falta uma tela administrativa para listar e resolver os eventos `reconciliation_required`, além de testes de integração/sandbox para confirmar o upsert e o comportamento de reentrega.
