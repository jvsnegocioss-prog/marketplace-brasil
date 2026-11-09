
"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

type TrackingResult = {
  order_id: string;
  payment_status: string;
  delivery_status: string | null;
  tracking_code: string | null;
  created_at: string;
  shipped_at: string | null;
  delivered_at: string | null;
};

function paymentLabel(status: string) {
  const value = status?.toLowerCase();

  if (["pago", "paid", "approved"].includes(value)) return "Pagamento aprovado";
  if (["cancelado", "cancelled", "rejected"].includes(value)) return "Pagamento cancelado";
  if (["aguardando", "pending", "in_process"].includes(value)) return "Aguardando pagamento";

  return status || "Não informado";
}

function deliveryLabel(status: string | null) {
  const labels: Record<string, string> = {
    aguardando_separacao: "Aguardando separação",
    em_preparacao: "Em preparação",
    enviado: "Pedido enviado",
    entregue: "Entregue",
  };

  return status ? labels[status] || status : "Ainda não atualizado";
}

function formatDate(date: string | null) {
  if (!date) return "Ainda não registrado";

  return new Date(date).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function AcompanharPedidoPage() {
  const [orderId, setOrderId] = useState("");
  const [phone, setPhone] = useState("");
  const [order, setOrder] = useState<TrackingResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setOrder(null);

    if (!orderId.trim() || !phone.trim()) {
      setError("Informe o número do pedido e o telefone utilizado na compra.");
      return;
    }

    setLoading(true);

    try {
      const { data, error: rpcError } = await supabase.rpc(
        "track_customer_order",
        {
          p_order_id: orderId.trim(),
          p_phone: phone.trim(),
        }
      );

      if (rpcError) {
        setError("Não foi possível consultar o pedido. Confira os dados e tente novamente.");
        return;
      }

      const result = Array.isArray(data) ? data[0] : data;

      if (!result) {
        setError("Não encontramos pedido com esses dados. Confira o número e o telefone.");
        return;
      }

      setOrder(result as TrackingResult);
    } catch {
      setError("Ocorreu um erro na consulta. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-10">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold text-gray-900">
            Acompanhar pedido
          </h1>
          <p className="mt-2 text-gray-600">
            Consulte o pagamento e o andamento da sua entrega.
          </p>
        </div>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <form onSubmit={handleSearch} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-700">
                Número do pedido
              </label>
              <input
                type="text"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                placeholder="Cole aqui o número do pedido"
                className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-600"
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-700">
                Telefone utilizado na compra
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(92) 99999-9999"
                className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-600"
                required
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
            >
              {loading ? "Consultando..." : "Consultar pedido"}
            </button>
          </form>
        </section>

        {order && (
          <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="mb-5 text-xl font-bold text-gray-900">
              Informações do pedido
            </h2>

            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-500">Número do pedido</p>
                <p className="break-all font-semibold text-gray-900">
                  {order.order_id}
                </p>
              </div>

              <div>
                <p className="text-sm text-gray-500">Pagamento</p>
                <p className="font-semibold text-gray-900">
                  {paymentLabel(order.payment_status)}
                </p>
              </div>

              <div>
                <p className="text-sm text-gray-500">Situação da entrega</p>
                <p className="font-semibold text-gray-900">
                  {deliveryLabel(order.delivery_status)}
                </p>
              </div>

              <div>
                <p className="text-sm text-gray-500">Código de rastreio</p>
                <p className="break-all font-semibold text-gray-900">
                  {order.tracking_code || "Ainda não disponível"}
                </p>
              </div>

              <hr />

              <div>
                <p className="text-sm text-gray-500">Data do pedido</p>
                <p className="font-medium text-gray-900">
                  {formatDate(order.created_at)}
                </p>
              </div>

              <div>
                <p className="text-sm text-gray-500">Data do envio</p>
                <p className="font-medium text-gray-900">
                  {formatDate(order.shipped_at)}
                </p>
              </div>

              <div>
                <p className="text-sm text-gray-500">Data da entrega</p>
                <p className="font-medium text-gray-900">
                  {formatDate(order.delivered_at)}
                </p>
              </div>
            </div>
          </section>
        )}

        <div className="mt-6 text-center">
          <a href="/" className="text-sm font-semibold text-blue-600 hover:underline">
            Voltar para a loja
          </a>
        </div>
      </div>
    </main>
  );
}
