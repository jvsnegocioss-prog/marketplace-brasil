create or replace function public.enforce_order_delivery_transition()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_step integer;
  v_new_step integer;
begin
  if new.estimated_delivery_at is distinct from old.estimated_delivery_at
     and new.estimated_delivery_at is not null
     and new.estimated_delivery_at < now() then
    raise exception 'A previsão de entrega não pode estar no passado';
  end if;

  if new.delivery_status is distinct from old.delivery_status then
    v_old_step := case old.delivery_status
      when 'aguardando_separacao' then 0
      when 'em_preparacao' then 1
      when 'enviado' then 2
      when 'entregue' then 3
      else null
    end;

    v_new_step := case new.delivery_status
      when 'aguardando_separacao' then 0
      when 'em_preparacao' then 1
      when 'enviado' then 2
      when 'entregue' then 3
      else null
    end;

    if v_old_step is null or v_new_step is null then
      raise exception 'Etapa de entrega inválida';
    end if;

    if v_new_step <> v_old_step + 1 then
      raise exception 'O pedido deve avançar exatamente uma etapa por vez';
    end if;

    if lower(trim(coalesce(new.status, ''))) not in
       ('pago', 'aprovado', 'approved', 'concluido', 'concluído') then
      raise exception 'A entrega só pode avançar após a confirmação do pagamento';
    end if;

    if new.delivery_status = 'enviado' then
      new.shipped_at := coalesce(old.shipped_at, now());
      new.delivered_at := old.delivered_at;
    elsif new.delivery_status = 'entregue' then
      if old.delivery_status <> 'enviado' or old.shipped_at is null then
        raise exception 'O pedido precisa estar enviado antes de ser entregue';
      end if;
      new.shipped_at := old.shipped_at;
      new.delivered_at := coalesce(old.delivered_at, now());
    else
      new.shipped_at := old.shipped_at;
      new.delivered_at := old.delivered_at;
    end if;
  else
    if new.shipped_at is distinct from old.shipped_at
       or new.delivered_at is distinct from old.delivered_at then
      raise exception 'As datas de envio e entrega só podem mudar junto com a etapa correspondente';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_order_delivery_transition on public.orders;
create trigger trg_enforce_order_delivery_transition
before update on public.orders
for each row
execute function public.enforce_order_delivery_transition();

do $$
declare
  v_function regprocedure;
  v_definition text;
  v_needle text := 'v_discount := least(v_discount, v_total);';
  v_replacement text := 'v_discount := least(v_discount, v_total);
    if v_discount <= 0 or v_discount >= v_total then
      raise exception ''Este cupom não gera um valor de compra válido'';
    end if;';
begin
  v_function := 'public.create_store_order_with_coupon_and_delivery(text,text,text,text,jsonb,text,uuid)'::regprocedure;
  v_definition := pg_get_functiondef(v_function);

  if position(v_needle in v_definition) = 0 then
    raise exception 'Não foi possível localizar o cálculo do desconto na função esperada';
  end if;
  if position('Este cupom não gera um valor de compra válido' in v_definition) > 0 then
    raise exception 'A validação de desconto já existe; interrompendo para evitar duplicidade';
  end if;

  v_definition := replace(v_definition, v_needle, v_replacement);
  execute v_definition;
end;
$$;
