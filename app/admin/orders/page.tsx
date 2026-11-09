
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Order = {
  id: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  total: number;
  status: string;
  created_at: string;
  order_items: {
    product_name: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
  }[];
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function loadOrders() {
    setLoading(true);
    setMessage("");

    const { data, error } = await supabase
      .from("orders")
      .select(`
        id,
        customer_name,
        customer_email,
        customer_phone,
        delivery_address,
        total,
        status,
        created_at,
        order_items (
          product_name,
          quantity,
          unit_price,
          subtotal
        )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      setMessage("Erro ao carregar pedidos: " + error.message);
      setOrders([]);
    } else {
      setOrders((data || []) as Order[]);
    }

    setLoading(false);
  }

  async function updateStatus(id: string, status: string) {
    const { error } = await supabase
      .from("orders")
      .update({ status })
      .eq("id", id);

    if (error) {
      alert("Erro ao atualizar: " + error.message);
    } else {
      alert("Status atualizado com sucesso!");
      await loadOrders();
    }
  }

  useEffect(() => {
    loadOrders();
  }, []);

  function formatMoney(value: number) {
    return Number(value).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }

  function statusLabel(status: string) {
    const normalized = status.toLowerCase();

    const labels: Record<string, string> = {
      aguardando: "Aguardando",
      pago: "Pago",
      aprovado: "Aprovado",
      enviado: "Enviado",
      concluido: "Concluído",
      cancelado: "Cancelado",
    };

    return labels[normalized] || status;
  }

  return (
    <main className="min-h-screen bg-gray-100 p-4 md:p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Pedidos da loja
            </h1>
            <p className="mt-1 text-gray-600">
              Consulte e acompanhe as compras dos clientes.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={loadOrders}
              className="rounded-lg bg-blue-600 px-4 py-2 text-white"
            >
              Atualizar
            </button>

            <Link
              href="/admin"
              className="rounded-lg border bg-white px-4 py-2 text-gray-800"
            >
              Voltar
            </Link>
          </div>
        </div>

        <div className="mb-5 rounded-xl bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">Total de pedidos</p>
          <p className="text-3xl font-bold text-gray-900">
            {orders.length}
          </p>
        </div>

        {loading && (
          <p className="py-8 text-center text-gray-600">
            Carregando pedidos...
          </p>
        )}

        {!loading && message && (
          <div className="rounded-lg bg-red-100 p-4 text-red-700">
            {message}
          </div>
        )}

        {!loading && !message && orders.length === 0 && (
          <div className="rounded-xl bg-white p-8 text-center shadow-sm">
            <h2 className="text-xl font-semibold text-gray-800">
              Nenhum pedido encontrado
            </h2>
            <p className="mt-2 text-gray-500">
              Os pedidos recebidos aparecerão aqui.
            </p>
          </div>
        )}

        <div className="space-y-4">
          {orders.map((order) => (
            <section
              key={order.id}
              className="rounded-xl bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">
                    {order.customer_name}
                  </h2>

                  <p className="text-sm text-gray-500">
                    {new Date(order.created_at).toLocaleString("pt-BR")}
                  </p>
                </div>

                <strong className="text-xl text-green-700">
                  {formatMoney(order.total)}
                </strong>
              </div>

              <div className="mt-4 space-y-1 text-sm text-gray-700">
                <p>
                  Email: {order.customer_email || "Não informado"}
                </p>
                <p>
                  Telefone: {order.customer_phone || "Não informado"}
                </p>
                <p>
                  Endereço: {order.delivery_address || "Não informado"}
                </p>
              </div>

              <div className="mt-4 border-t pt-4">
                <h3 className="mb-2 font-semibold text-gray-800">
                  Produtos
                </h3>

                {order.order_items?.map((item, index) => (
                  <div
                    key={index}
                    className="flex flex-wrap justify-between gap-2 py-2 text-sm"
                  >
                    <span>
                      {item.product_name} — {item.quantity} unidade(s)
                    </span>

                    <span>
                      {formatMoney(item.subtotal)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
                <label className="font-semibold text-gray-700">
                  Status:
                </label>

                <select
                  value={order.status}
                  onChange={(e) =>
                    updateStatus(order.id, e.target.value)
                  }
                  className="rounded-lg border border-gray-300 bg-white p-2"
                >
                  <option value="aguardando">Aguardando</option>
                  <option value="Pago">Pago</option>
                  <option value="aprovado">Aprovado</option>
                  <option value="enviado">Enviado</option>
                  <option value="concluido">Concluído</option>
                  <option value="Cancelado">Cancelado</option>
                  <option value="cancelado">Cancelado (antigo)</option>
                </select>

                <span className="text-sm font-semibold text-gray-600">
                  {statusLabel(order.status)}
                </span>
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
