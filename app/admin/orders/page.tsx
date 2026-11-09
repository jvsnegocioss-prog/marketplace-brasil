
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
  delivery_status: string;
  tracking_code: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  order_items: {
    product_name: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
  }[];
};

type Filter = "todos" | "pagos" | "aguardando" | "cancelados";

function normalizedStatus(status: string) {
  return (status || "").trim().toLowerCase();
}

function isPaid(status: string) {
  return ["pago", "aprovado", "approved", "concluido", "concluído"].includes(
    normalizedStatus(status)
  );
}

function isWaiting(status: string) {
  return ["aguardando", "pendente", "pending"].includes(
    normalizedStatus(status)
  );
}

function isCancelled(status: string) {
  return ["cancelado", "cancelada", "cancelled", "canceled"].includes(
    normalizedStatus(status)
  );
}

function deliveryLabel(status: string) {
  const labels: Record<string, string> = {
    aguardando_separacao: "Aguardando separação",
    em_preparacao: "Em preparação",
    enviado: "Enviado",
    entregue: "Entregue",
  };

  return labels[status] || "Aguardando separação";
}

function whatsappLink(order: Order) {
  const digits = (order.customer_phone || "").replace(/\D/g, "");
  const phone = digits.startsWith("55") ? digits : `55${digits}`;

  const message = `Olá, ${order.customer_name}! Seu pedido na Marketplace Brasil foi enviado. ${
    order.tracking_code
      ? `Código de rastreio: ${order.tracking_code}. `
      : ""
  }Acompanhe seu pedido: https://marketplace-brasil.vercel.app/acompanhar`;

  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");

  const [trackingDrafts, setTrackingDrafts] = useState<
    Record<string, string>
  >({});

  const [savingDelivery, setSavingDelivery] = useState<string | null>(null);

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
        delivery_status,
        tracking_code,
        shipped_at,
        delivered_at,
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
      const loadedOrders = (data || []) as Order[];

      setOrders(loadedOrders);

      const drafts: Record<string, string> = {};

      loadedOrders.forEach((order) => {
        drafts[order.id] = order.tracking_code || "";
      });

      setTrackingDrafts(drafts);
    }

    setLoading(false);
  }

  async function updateDeliveryStatus(order: Order, newStatus: string) {
    if (!isPaid(order.status)) {
      alert(
        "O controle de entrega só está disponível após a confirmação do pagamento."
      );
      return;
    }

    if (
      newStatus === "entregue" &&
      order.delivery_status !== "enviado" &&
      order.delivery_status !== "entregue"
    ) {
      alert(
        "Registre o pedido como enviado antes de marcar como entregue."
      );
      return;
    }

    const updates: Record<string, string> = {
      delivery_status: newStatus,
    };

    if (newStatus === "enviado" && !order.shipped_at) {
      updates.shipped_at = new Date().toISOString();
    }

    if (newStatus === "entregue" && !order.delivered_at) {
      updates.delivered_at = new Date().toISOString();
    }

    setSavingDelivery(order.id);

    const { error } = await supabase
      .from("orders")
      .update(updates)
      .eq("id", order.id);

    setSavingDelivery(null);

    if (error) {
      alert("Erro ao atualizar entrega: " + error.message);
      return;
    }

    alert("Status da entrega atualizado!");

    await loadOrders();
  }

  async function saveTrackingCode(order: Order) {
    if (!isPaid(order.status)) {
      alert(
        "O código de rastreio só pode ser salvo após a confirmação do pagamento."
      );
      return;
    }

    const trackingCode = (trackingDrafts[order.id] || "").trim();

    setSavingDelivery(order.id);

    const { error } = await supabase
      .from("orders")
      .update({ tracking_code: trackingCode || null })
      .eq("id", order.id);

    setSavingDelivery(null);

    if (error) {
      alert("Erro ao salvar rastreio: " + error.message);
      return;
    }

    alert("Código de rastreio salvo com sucesso!");

    await loadOrders();
  }

  useEffect(() => {
    loadOrders();
  }, []);

  function formatMoney(value: number) {
    return Number(value || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }

  function formatDate(value: string | null) {
    if (!value) return "Ainda não registrado";
    return new Date(value).toLocaleString("pt-BR");
  }

  function statusLabel(status: string) {
    const normalized = normalizedStatus(status);

    const labels: Record<string, string> = {
      aguardando: "Aguardando pagamento",
      pendente: "Aguardando pagamento",
      pending: "Aguardando pagamento",
      pago: "Pago",
      aprovado: "Aprovado",
      approved: "Aprovado",
      concluido: "Concluído",
      "concluído": "Concluído",
      cancelado: "Cancelado",
      cancelada: "Cancelado",
      canceled: "Cancelado",
      cancelled: "Cancelado",
    };

    return labels[normalized] || status;
  }

  const paidOrders = orders.filter((order) => isPaid(order.status));
  const waitingOrders = orders.filter((order) => isWaiting(order.status));
  const cancelledOrders = orders.filter((order) => isCancelled(order.status));

  const totalPaid = paidOrders.reduce(
    (sum, order) => sum + Number(order.total || 0),
    0
  );

  const filteredOrders = orders.filter((order) => {
    if (filter === "pagos") return isPaid(order.status);
    if (filter === "aguardando") return isWaiting(order.status);
    if (filter === "cancelados") return isCancelled(order.status);
    return true;
  });

  const filterButton = (value: Filter, label: string) => (
    <button
      key={value}
      onClick={() => setFilter(value)}
      className={`rounded-lg px-4 py-2 text-sm font-semibold ${
        filter === value
          ? "bg-blue-600 text-white"
          : "border border-gray-300 bg-white text-gray-700"
      }`}
    >
      {label}
    </button>
  );

  return (
    <main className="min-h-screen bg-gray-100 p-4 md:p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Histórico financeiro
            </h1>

            <p className="mt-1 text-gray-600">
              Acompanhe vendas, pagamentos e entregas da loja.
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

        <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">Total vendido</p>
            <p className="mt-2 text-2xl font-bold text-green-700">
              {formatMoney(totalPaid)}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Somente pedidos pagos
            </p>
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">Pedidos pagos</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">
              {paidOrders.length}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Pagamentos confirmados
            </p>
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">Total de pedidos</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">
              {orders.length}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Todos os pedidos registrados
            </p>
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">Aguardando pagamento</p>
            <p className="mt-2 text-2xl font-bold text-orange-600">
              {waitingOrders.length}
            </p>
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">Pedidos cancelados</p>
            <p className="mt-2 text-2xl font-bold text-red-600">
              {cancelledOrders.length}
            </p>
          </div>
        </section>

        <section className="mb-5 rounded-xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-bold text-gray-800">
            Filtrar histórico
          </h2>

          <div className="flex flex-wrap gap-2">
            {filterButton("todos", "Todos")}
            {filterButton("pagos", "Pagos")}
            {filterButton("aguardando", "Aguardando")}
            {filterButton("cancelados", "Cancelados")}
          </div>
        </section>

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

        {!loading && !message && filteredOrders.length === 0 && (
          <div className="rounded-xl bg-white p-8 text-center shadow-sm">
            <h2 className="text-xl font-semibold text-gray-800">
              Nenhum pedido encontrado
            </h2>

            <p className="mt-2 text-gray-500">
              Não existem pedidos nesta categoria.
            </p>
          </div>
        )}

        <div className="space-y-4">
          {!loading &&
            filteredOrders.map((order) => (
              <section
                key={order.id}
                className="rounded-xl bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">
                      {order.customer_name}
                    </h2>

                    <p className="mt-1 text-sm text-gray-500">
                      Data: {new Date(order.created_at).toLocaleString("pt-BR")}
                    </p>

                    <p className="mt-1 break-all text-xs text-gray-400">
                      Pedido: {order.id}
                    </p>
                  </div>

                  <strong className="text-xl text-green-700">
                    {formatMoney(order.total)}
                  </strong>
                </div>

                <div className="mt-4 space-y-1 text-sm text-gray-700">
                  <p>Email: {order.customer_email || "Não informado"}</p>
                  <p>Telefone: {order.customer_phone || "Não informado"}</p>
                  <p>Endereço: {order.delivery_address || "Não informado"}</p>
                </div>

                <div className="mt-4 border-t pt-4">
                  <h3 className="mb-2 font-semibold text-gray-800">
                    Produtos comprados
                  </h3>

                  {order.order_items?.map((item, index) => (
                    <div
                      key={index}
                      className="flex flex-wrap justify-between gap-2 py-2 text-sm"
                    >
                      <span>
                        {item.product_name} — {item.quantity} unidade(s)
                      </span>

                      <span>{formatMoney(item.subtotal)}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 border-t pt-4">
                  <h3 className="mb-2 font-semibold text-gray-800">
                    Situação do pagamento
                  </h3>

                  <p className="text-sm font-semibold text-gray-700">
                    {statusLabel(order.status)}
                  </p>

                  <p className="mt-1 text-xs text-gray-500">
                    A confirmação do pagamento é feita automaticamente pelo Mercado Pago.
                  </p>
                </div>

                <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
                  <h3 className="mb-3 font-bold text-gray-900">
                    Controle de entrega
                  </h3>

                  {!isPaid(order.status) ? (
                    <p className="text-sm text-gray-600">
                      O controle de entrega será liberado após a confirmação do pagamento.
                    </p>
                  ) : (
                    <>
                      <label className="mb-2 block text-sm font-semibold text-gray-700">
                        Status da entrega
                      </label>

                      <select
                        value={order.delivery_status || "aguardando_separacao"}
                        disabled={savingDelivery === order.id}
                        onChange={(e) =>
                          updateDeliveryStatus(order, e.target.value)
                        }
                        className="w-full rounded-lg border border-gray-300 bg-white p-3 text-gray-800"
                      >
                        <option value="aguardando_separacao">
                          Aguardando separação
                        </option>

                        <option value="em_preparacao">
                          Em preparação
                        </option>

                        <option value="enviado">Enviado</option>
                        <option value="entregue">Entregue</option>
                      </select>

                      <p className="mt-2 text-sm font-semibold text-blue-800">
                        Situação atual:{" "}
                        {deliveryLabel(
                          order.delivery_status || "aguardando_separacao"
                        )}
                      </p>

                      <div className="mt-4">
                        <label className="mb-2 block text-sm font-semibold text-gray-700">
                          Código de rastreio
                        </label>

                        <input
                          type="text"
                          value={trackingDrafts[order.id] ?? ""}
                          onChange={(e) =>
                            setTrackingDrafts((current) => ({
                              ...current,
                              [order.id]: e.target.value,
                            }))
                          }
                          placeholder="Digite o código de rastreio"
                          className="w-full rounded-lg border border-gray-300 bg-white p-3 text-gray-800"
                        />

                        <button
                          type="button"
                          disabled={savingDelivery === order.id}
                          onClick={() => saveTrackingCode(order)}
                          className="mt-2 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
                        >
                          {savingDelivery === order.id
                            ? "Salvando..."
                            : "Salvar código de rastreio"}
                        </button>

                        {order.delivery_status === "enviado" &&
                          order.customer_phone && (
                            <a
                              href={whatsappLink(order)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-3 inline-flex rounded-lg bg-green-600 px-4 py-3 font-semibold text-white"
                            >
                              Avisar cliente pelo WhatsApp
                            </a>
                          )}
                      </div>

                      <div className="mt-4 space-y-1 border-t border-blue-200 pt-3 text-xs text-gray-600">
                        <p>
                          Enviado em: {formatDate(order.shipped_at)}
                        </p>

                        <p>
                          Entregue em: {formatDate(order.delivered_at)}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </section>
            ))}
        </div>
      </div>
    </main>
  );
}
