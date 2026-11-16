CREATE INDEX IF NOT EXISTS idx_orders_delivery_neighborhood_id
ON public.orders (delivery_neighborhood_id);
