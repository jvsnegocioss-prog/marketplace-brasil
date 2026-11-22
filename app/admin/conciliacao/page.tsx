"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type ReconciliationEvent = {
  notificationId: string;
  resourceId: string | null;
  requestId: string | null;
  notificationType: string | null;
  status: string;
  reason: string | null;
  receivedAt: string | null;
};

type LookupResult = {
  error?: string;
  event?: { reason: string | null; resourceId: string };
  mercadoPago?: { id: string; status: string; currency: string | null; totalAmount: string | number | null; paidAmount: string | number | null };
  storeOrder?: { id: string; orderNumber: string | null; status: string; total: string | number } | null;
  correlation?: { matched: boolean; reason?: string; orderFound?: boolean; externalReferenceMatchesOrder?: boolean; mercadoPagoIdMatches?: boolean; currencyMatches?: boolean; amountMatches?: boolean };
  notice?: string;
};

function formatDate(value: string | null) {
  if (!value) return "Data não informada";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data inválida"
    : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function reasonLabel(value: string | null) {
  if (value === "mercado_pago_refunded") return "Reembolso informado pelo Mercado Pago";
  if (value === "mercado_pago_charged_back") return "Contestação / chargeback informado pelo Mercado Pago";
  return value || "Motivo não classificado";
}

export default function AdminReconciliationPage() {
  const [events, setEvents] = useState<ReconciliationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lookups, setLookups] = useState<Record<string, LookupResult>>({});
  const [lookingUp, setLookingUp] = useState<string | null>(null);

  const loadEvents = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (sessionError || !token) {
        setError("Sua sessão expirou. Entre novamente no painel administrativo.");
        setEvents([]);
        return;
      }

      const response = await fetch("/api/admin/conciliacao", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falha ao consultar conciliação.");
      setEvents(Array.isArray(result.events) ? result.events : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar a conciliação.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  async function lookupEvent(notificationId: string) {
    setLookingUp(notificationId);
    setLookups((current) => ({ ...current, [notificationId]: {} }));
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (sessionError || !token) throw new Error("Sua sessão expirou. Entre novamente.");
      const response = await fetch("/api/admin/conciliacao/detalhe?notificationId=" + encodeURIComponent(notificationId), {
        headers: { Authorization: "Bearer " + token },
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falha ao consultar a ordem.");
      setLookups((current) => ({ ...current, [notificationId]: result }));
    } catch (cause) {
      setLookups((current) => ({ ...current, [notificationId]: { error: cause instanceof Error ? cause.message : "Falha na consulta." } }));
    } finally {
      setLookingUp(null);
    }
  }

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: 20, fontFamily: "Arial, sans-serif" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ marginBottom: 6 }}>Conciliação financeira</h1>
          <p style={{ color: "#64748b", marginTop: 0 }}>Eventos do Mercado Pago que precisam de análise administrativa.</p>
        </div>
        <Link href="/admin" style={{ color: "#173b68", fontWeight: 700 }}>Voltar ao painel</Link>
      </header>

      <section style={{ border: "1px solid #dbe3ef", borderRadius: 12, padding: 16, margin: "18px 0", background: "#f8fafc" }}>
        <strong>Somente consulta</strong>
        <p style={{ marginBottom: 0, color: "#475569" }}>
          Esta tela não altera pedidos, pagamentos, estoque, cupons ou o estado dos eventos. A análise e a resolução financeira continuam manuais.
        </p>
      </section>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: "12px 0" }}>Pendências registradas ({events.length})</h2>
        <button type="button" onClick={() => void loadEvents(true)} disabled={loading || refreshing}
          style={{ padding: "10px 16px", border: 0, borderRadius: 8, background: "#173b68", color: "white", fontWeight: 700, cursor: "pointer" }}>
          {refreshing ? "Atualizando..." : "Atualizar lista"}
        </button>
      </div>

      {error && <p role="alert" style={{ padding: 12, borderRadius: 8, background: "#fff1f2", color: "#9f1239" }}>{error}</p>}
      {loading ? <p>Carregando eventos...</p> : null}
      {!loading && !error && events.length === 0 ? (
        <p style={{ padding: 18, border: "1px solid #e2e8f0", borderRadius: 10 }}>Nenhum evento aguardando conciliação foi encontrado.</p>
      ) : null}

      <div style={{ display: "grid", gap: 12 }}>
        {events.map((event) => (
          <article key={event.notificationId} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <strong>{reasonLabel(event.reason)}</strong>
              <span style={{ color: "#92400e", fontWeight: 700 }}>Requer análise</span>
            </div>
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "10px 18px", marginBottom: 0 }}>
              <div><dt style={{ color: "#64748b", fontSize: 12 }}>ID da ordem Mercado Pago</dt><dd style={{ margin: "4px 0", overflowWrap: "anywhere" }}>{event.resourceId || "Não informado"}</dd></div>
              <div><dt style={{ color: "#64748b", fontSize: 12 }}>ID da notificação</dt><dd style={{ margin: "4px 0", overflowWrap: "anywhere" }}>{event.notificationId}</dd></div>
              <div><dt style={{ color: "#64748b", fontSize: 12 }}>Tipo</dt><dd style={{ margin: "4px 0" }}>{event.notificationType || "Não informado"}</dd></div>
              <div><dt style={{ color: "#64748b", fontSize: 12 }}>Recebido em</dt><dd style={{ margin: "4px 0" }}>{formatDate(event.receivedAt)}</dd></div>
            </dl>
            <div style={{ marginTop: 14 }}>
              <button type="button" onClick={() => void lookupEvent(event.notificationId)} disabled={lookingUp === event.notificationId}
                style={{ padding: "9px 13px", border: "1px solid #173b68", borderRadius: 8, background: "#fff", color: "#173b68", fontWeight: 700, cursor: "pointer" }}>
                {lookingUp === event.notificationId ? "Consultando..." : "Consultar ordem e pedido correspondente"}
              </button>
              {lookups[event.notificationId] && (
                <section aria-live="polite" style={{ marginTop: 12, padding: 14, borderRadius: 10, background: "#f8fafc", border: "1px solid #dbe3ef" }}>
                  {lookups[event.notificationId].error ? <p role="alert" style={{ color: "#9f1239", margin: 0 }}>{lookups[event.notificationId].error}</p> : (
                    <>
                      <strong style={{ color: lookups[event.notificationId].correlation?.matched ? "#166534" : "#92400e" }}>
                        {lookups[event.notificationId].correlation?.matched ? "Referência, identificador, moeda e valor original conferem" : "Vínculo não confirmado — análise manual necessária"}
                      </strong>
                      {lookups[event.notificationId].correlation?.reason && <p>{lookups[event.notificationId].correlation?.reason}</p>}
                      {lookups[event.notificationId].mercadoPago && <p style={{ marginBottom: 6 }}>Mercado Pago: estado <strong>{lookups[event.notificationId].mercadoPago?.status}</strong> · moeda {lookups[event.notificationId].mercadoPago?.currency || "não informada"} · total {lookups[event.notificationId].mercadoPago?.totalAmount ?? "não informado"} · pago {lookups[event.notificationId].mercadoPago?.paidAmount ?? "não informado"}</p>}
                      {lookups[event.notificationId].storeOrder && <p style={{ marginTop: 6 }}>Loja: pedido <strong>{lookups[event.notificationId].storeOrder?.orderNumber || lookups[event.notificationId].storeOrder?.id}</strong> · estado <strong>{lookups[event.notificationId].storeOrder?.status}</strong> · total {lookups[event.notificationId].storeOrder?.total}</p>}
                      <p style={{ marginBottom: 0, color: "#64748b", fontSize: 12 }}>{lookups[event.notificationId].notice || "Consulta somente leitura."}</p>
                    </>
                  )}
                </section>
              )}
            </div>
          </article>
        ))}
      </div>

      <p style={{ color: "#64748b", fontSize: 13, marginTop: 22 }}>
        Exibindo até 100 registros mais recentes. Nenhuma ação de “resolver” está disponível nesta etapa para evitar baixa financeira sem trilha de auditoria.
      </p>
    </main>
  );
}
