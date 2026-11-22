# Conciliação financeira administrativa — primeira etapa

Branch: `fix/checkout-stock-recovery`

## Escopo entregue

- Criada a página `/admin/conciliacao` para exibir eventos com `processing_status = reconciliation_required`.
- Criada a rota `GET /api/admin/conciliacao`.
- A rota exige token Supabase válido, consulta `is_marketplace_admin()` usando a sessão autenticada e somente depois usa a chave de serviço no servidor para ler a tabela.
- A consulta retorna apenas os campos necessários para triagem: identificadores da notificação e da ordem Mercado Pago, tipo, motivo, estado e data de recebimento.
- A lista é limitada aos 100 registros mais recentes e usa `Cache-Control: no-store`.
- A interface diferencia reembolso e contestação/chargeback e informa explicitamente que a tela é somente leitura.

## Limites intencionais

- Não existe botão para resolver, descartar ou alterar eventos.
- Não são alterados pedidos, pagamentos, estoque, cupons ou registros do webhook.
- Não são consultados dados pessoais, valores, endereço, telefone ou itens do pedido.
- A tela depende da migration que adiciona `reconciliation_required` à constraint da tabela. Essa migration ainda não foi aplicada à produção.
- A página está acessível pela rota `/admin/conciliacao`; a navegação principal do painel ainda precisa receber um atalho visível em uma rodada posterior.

## Verificação e implantação

- Arquivos revisados após gravação no GitHub.
- Comparação com a revisão aprovada `6abaaac027777f967ab77aec9981cd0572878bd6`: branch com 38 commits à frente e zero atrás.
- Os deployments automáticos Vercel correspondentes aos dois commits desta etapa foram cancelados para evitar Preview parcial.
- Não houve build validado, teste funcional, teste de autorização, consulta a dados reais da tabela por esta tela, aplicação de migration, alteração no Supabase de produção, merge ou deploy de produção.


## Segunda etapa — conferência técnica sob demanda

- Adicionado atalho “Conciliação financeira” à navegação do painel administrativo.
- Adicionada a rota `GET /api/admin/conciliacao/detalhe?notificationId=...`, com a mesma verificação de sessão e permissão administrativa.
- A rota lê o evento pendente, consulta a ordem no Mercado Pago usando `MERCADO_PAGO_ACCESS_TOKEN` somente no servidor e compara a referência externa, o identificador vinculado, a moeda BRL e o valor original com o pedido da loja.
- A interface permite abrir a conferência de cada evento e mostra o estado reportado pelo Mercado Pago e o estado/valor do pedido da loja.
- A conferência é somente leitura e sob demanda. Não confirma liquidação, estorno ou resolução financeira; não atualiza pedidos nem eventos.
- Se o token Mercado Pago não estiver configurado no ambiente, a consulta retorna indisponibilidade sem expor credenciais.
- Divergência, ausência de pedido ou referência inválida nunca é corrigida automaticamente.

## Limites que permanecem

- Não há botão para resolver, baixar, descartar ou reprocessar eventos.
- Não existe trilha de auditoria de resolução ainda; isso exige desenho próprio, tabela/registro de auditoria e autorização antes de qualquer alteração.
- Não foram executados build, testes automatizados, teste sandbox Mercado Pago ou testes de permissão.
- Nenhuma migration foi aplicada; nenhum dado de produção foi alterado.
