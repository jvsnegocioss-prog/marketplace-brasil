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


type AuditEntry = {
  id: string;
  notification_id: string;
  resource_id: string;
  admin_user_id: string;
  action: string;
  decision_note: string;
  evidence_reference: string | null;
  created_at: string;
};

type AuditForm = {
  action: string;
  decisionNote: string;
  evidenceReference: string;
};

const AUDIT_ACTIONS = [
  { value: "reviewed_pending", label: "Analisado — permanece pendente" },
  { value: "evidence_requested", label: "Comprovante ou esclarecimento solicitado" },
  { value: "escalated", label: "Encaminhado para análise financeira" },
  { value: "manual_followup", label: "Acompanhamento manual necessário" },
  { value: "other", label: "Outra providência" },
];

function auditActionLabel(value: string) {
  return AUDIT_ACTIONS.find((item) => item.value === value)?.label || value;
}

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

type ReconciliationRunSummary = {
  checked: number;
  approved: number;
  cancelledAndStockRestored: number;
  stillPending: number;
  manualReview: number;
  errors: number;
};

export default function AdminReconciliationPage() {
  const [events, setEvents] = useState<ReconciliationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lookups, setLookups] = useState<Record<string, LookupResult>>({});
  const [lookingUp, setLookingUp] = useState<string | null>(null);
  const [auditForms, setAuditForms] = useState<Record<string, AuditForm>>({});
  const [audits, setAudits] = useState<Record<string, AuditEntry[]>>({});
  const [auditLoading, setAuditLoading] = useState<string | null>(null);
  const [auditSaving, setAuditSaving] = useState<string | null>(null);
  const [auditMessages, setAuditMessages] = useState<Record<string, string>>({});
  const [submissionKeys, setSubmissionKeys] = useState<Record<string, string>>({});
  const [runningReconciliation, setRunningReconciliation] = useState(false);
  const [runSummary, setRunSummary] = useState<ReconciliationRunSummary | null>(null);
  const [runMessage, setRunMessage] = useState("");

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

  async function runPendingReconciliation() {
    setRunningReconciliation(true);
    setRunSummary(null);
    setRunMessage("");
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (sessionError || !token) throw new Error("Sua sessão expirou. Entre novamente no painel.");
      const response = await fetch("/api/admin/orders/reconcile", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível conferir os pedidos.");
      setRunSummary(result.summary || null);
      setRunMessage(result.message || "Conferência concluída.");
      await loadEvents(true);
    } catch (cause) {
      setRunMessage(cause instanceof Error ? cause.message : "Falha ao conferir pedidos pendentes.");
    } finally {
      setRunningReconciliation(false);
    }
  }

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

  async function loadAuditHistory(notificationId: string) {
    setAuditLoading(notificationId);
    setAuditMessages((current) => ({ ...current, [notificationId]: "" }));
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (sessionError || !token) throw new Error("Sua sessão expirou. Entre novamente.");
      const response = await fetch("/api/admin/conciliacao/auditoria?notificationId=" + encodeURIComponent(notificationId), {
        headers: { Authorization: "Bearer " + token },
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível carregar o histórico.");
      setAudits((current) => ({ ...current, [notificationId]: Array.isArray(result.entries) ? result.entries : [] }));
    } catch (cause) {
      setAuditMessages((current) => ({ ...current, [notificationId]: cause instanceof Error ? cause.message : "Falha ao consultar o histórico." }));
    } finally {
      setAuditLoading(null);
    }
  }

  async function recordAudit(notificationId: string) {
    const form = auditForms[notificationId] || { action: "reviewed_pending", decisionNote: "", evidenceReference: "" };
    if (form.decisionNote.trim().length < 20) {
      setAuditMessages((current) => ({ ...current, [notificationId]: "A justificativa deve conter pelo menos 20 caracteres." }));
      return;
    }

    setAuditSaving(notificationId);
    setAuditMessages((current) => ({ ...current, [notificationId]: "" }));
    const submissionKey = submissionKeys[notificationId] || crypto.randomUUID();
    setSubmissionKeys((current) => ({ ...current, [notificationId]: submissionKey }));

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (sessionError || !token) throw new Error("Sua sessão expirou. Entre novamente.");
      const response = await fetch("/api/admin/conciliacao/auditoria", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({
          notificationId,
          action: form.action,
          decisionNote: form.decisionNote,
          evidenceReference: form.evidenceReference,
          submissionKey,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível registrar a análise.");
      setAuditMessages((current) => ({ ...current, [notificationId]: result.alreadyRecorded ? "Este registro já havia sido confirmado anteriormente." : "Análise registrada no histórico. O evento e o pedido não foram alterados." }));
      setSubmissionKeys((current) => {
        const next = { ...current };
        delete next[notificationId];
        return next;
      });
      setAuditForms((current) => ({
        ...current,
        [notificationId]: { ...form, decisionNote: "", evidenceReference: "" },
      }));
      await loadAuditHistory(notificationId);
    } catch (cause) {
      setAuditMessages((current) => ({ ...current, [notificationId]: cause instanceof Error ? cause.message : "Falha ao registrar análise." }));
    } finally {
      setAuditSaving(null);
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

      <section style={{ border: "1px solid #cbd5e1", borderRadius: 12, padding: 16, margin: "18px 0", background: "#fff" }}>
        <h2 style={{ marginTop: 0 }}>Conferir pedidos com pagamento pendente</h2>
        <p style={{ color: "#475569" }}>
          Consulta no Mercado Pago pedidos aguardando há pelo menos 10 minutos. Pagamentos confirmados podem ser aprovados; cancelamentos ou falhas confirmados podem liberar o estoque. Pagamentos ainda pendentes permanecem reservados.
        </p>
        <button type="button" onClick={() => void runPendingReconciliation()} disabled={runningReconciliation}
          style={{ padding: "11px 16px", border: 0, borderRadius: 8, background: runningReconciliation ? "#94a3b8" : "#173b68", color: "#fff", fontWeight: 700, cursor: runningReconciliation ? "wait" : "pointer" }}>
          {runningReconciliation ? "Consultando Mercado Pago..." : "Conferir pedidos pendentes agora"}
        </button>
        {runMessage && <p role="status" aria-live="polite" style={{ marginBottom: 0, color: runSummary ? "#166534" : "#9f1239" }}>{runMessage}</p>}
        {runSummary && (
          <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 10, marginBottom: 0 }}>
            <div><dt style={{ color: "#64748b", fontSize: 12 }}>Consultados</dt><dd style={{ margin: "4px 0", fontWeight: 800 }}>{runSummary.checked}</dd></div>
            <div><dt style={{ color: "#64748b", fontSize: 12 }}>Pagamentos aprovados</dt><dd style={{ margin: "4px 0", fontWeight: 800 }}>{runSummary.approved}</dd></div>
            <div><dt style={{ color: "#64748b", fontSize: 12 }}>Cancelados / estoque restaurado</dt><dd style={{ margin: "4px 0", fontWeight: 800 }}>{runSummary.cancelledAndStockRestored}</dd></div>
            <div><dt style={{ color: "#64748b", fontSize: 12 }}>Ainda pendentes</dt><dd style={{ margin: "4px 0", fontWeight: 800 }}>{runSummary.stillPending}</dd></div>
            <div><dt style={{ color: "#64748b", fontSize: 12 }}>Revisão manual</dt><dd style={{ margin: "4px 0", fontWeight: 800 }}>{runSummary.manualReview}</dd></div>
            <div><dt style={{ color: "#64748b", fontSize: 12 }}>Erros de consulta</dt><dd style={{ margin: "4px 0", fontWeight: 800 }}>{runSummary.errors}</dd></div>
          </dl>
        )}
      </section>

      <section style={{ border: "1px solid #dbe3ef", borderRadius: 12, padding: 16, margin: "18px 0", background: "#f8fafc" }}>
        <strong>Consulta e registro de análise</strong>
        <p style={{ marginBottom: 0, color: "#475569" }}>
          Esta tela permite registrar o histórico administrativo, mas não altera pedidos, pagamentos, estoque, cupons ou o estado dos eventos. A resolução financeira continua manual e separada.
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

            <section style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #e2e8f0" }}>
              <h3 style={{ margin: "0 0 10px" }}>Registrar análise administrativa</h3>
              <p style={{ color: "#64748b", fontSize: 13, marginTop: 0 }}>
                O registro identifica o administrador e fica preservado no histórico. Não resolve o reembolso/chargeback nem altera o pedido.
              </p>
              <label style={{ display: "block", fontWeight: 700, marginBottom: 5 }} htmlFor={"audit-action-" + event.notificationId}>Tipo de análise</label>
              <select
                id={"audit-action-" + event.notificationId}
                value={(auditForms[event.notificationId] || { action: "reviewed_pending", decisionNote: "", evidenceReference: "" }).action}
                onChange={(e) => setAuditForms((current) => ({
                  ...current,
                  [event.notificationId]: { ...(current[event.notificationId] || { action: "reviewed_pending", decisionNote: "", evidenceReference: "" }), action: e.target.value },
                }))}
                style={{ width: "100%", padding: 10, border: "1px solid #cbd5e1", borderRadius: 8, marginBottom: 10 }}
              >
                {AUDIT_ACTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <label style={{ display: "block", fontWeight: 700, marginBottom: 5 }} htmlFor={"audit-note-" + event.notificationId}>Justificativa (obrigatória, mínimo 20 caracteres)</label>
              <textarea
                id={"audit-note-" + event.notificationId}
                value={(auditForms[event.notificationId] || { action: "reviewed_pending", decisionNote: "", evidenceReference: "" }).decisionNote}
                maxLength={2000}
                rows={3}
                onChange={(e) => setAuditForms((current) => ({
                  ...current,
                  [event.notificationId]: { ...(current[event.notificationId] || { action: "reviewed_pending", decisionNote: "", evidenceReference: "" }), decisionNote: e.target.value },
                }))}
                style={{ width: "100%", boxSizing: "border-box", padding: 10, border: "1px solid #cbd5e1", borderRadius: 8, resize: "vertical" }}
                placeholder="Descreva o que foi conferido e qual providência foi tomada..."
              />
              <label style={{ display: "block", fontWeight: 700, margin: "10px 0 5px" }} htmlFor={"audit-evidence-" + event.notificationId}>Referência interna privada do comprovante (opcional)</label>
              <input
                id={"audit-evidence-" + event.notificationId}
                value={(auditForms[event.notificationId] || { action: "reviewed_pending", decisionNote: "", evidenceReference: "" }).evidenceReference}
                maxLength={500}
                onChange={(e) => setAuditForms((current) => ({
                  ...current,
                  [event.notificationId]: { ...(current[event.notificationId] || { action: "reviewed_pending", decisionNote: "", evidenceReference: "" }), evidenceReference: e.target.value },
                }))}
                style={{ width: "100%", boxSizing: "border-box", padding: 10, border: "1px solid #cbd5e1", borderRadius: 8 }}
                placeholder="Ex.: reconciliation-evidence/arquivo-interno.pdf"
              />
              <p style={{ color: "#64748b", fontSize: 12, margin: "5px 0 10px" }}>Não cole links públicos, senhas, tokens ou dados de cartão. O campo aceita apenas referência interna, não faz upload de arquivo.</p>
              <button type="button" onClick={() => void recordAudit(event.notificationId)} disabled={auditSaving === event.notificationId}
                style={{ padding: "10px 14px", border: 0, borderRadius: 8, background: "#173b68", color: "white", fontWeight: 700, cursor: "pointer" }}>
                {auditSaving === event.notificationId ? "Registrando..." : "Registrar análise no histórico"}
              </button>
              {auditMessages[event.notificationId] && <p role="status" aria-live="polite" style={{ color: auditMessages[event.notificationId].toLowerCase().includes("não") || auditMessages[event.notificationId].toLowerCase().includes("falha") ? "#9f1239" : "#166534", fontSize: 13 }}>{auditMessages[event.notificationId]}</p>}
              <div style={{ marginTop: 12 }}>
                <button type="button" onClick={() => void loadAuditHistory(event.notificationId)} disabled={auditLoading === event.notificationId}
                  style={{ padding: "8px 12px", border: "1px solid #64748b", borderRadius: 8, background: "white", color: "#334155", fontWeight: 700, cursor: "pointer" }}>
                  {auditLoading === event.notificationId ? "Carregando histórico..." : "Consultar histórico de análises"}
                </button>
              </div>
              {audits[event.notificationId] && (
                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                  {audits[event.notificationId].length === 0 ? <p style={{ color: "#64748b" }}>Nenhuma análise registrada para este evento.</p> : audits[event.notificationId].map((entry) => (
                    <article key={entry.id} style={{ border: "1px solid #dbe3ef", borderRadius: 8, padding: 12, background: "#f8fafc" }}>
                      <strong>{auditActionLabel(entry.action)}</strong>
                      <p style={{ margin: "6px 0" }}>{entry.decision_note}</p>
                      <p style={{ color: "#64748b", fontSize: 12, margin: 0 }}>Administrador: {entry.admin_user_id} · {formatDate(entry.created_at)}</p>
                      {entry.evidence_reference && <p style={{ color: "#475569", fontSize: 12, marginBottom: 0 }}>Referência interna: {entry.evidence_reference}</p>}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </article>
        ))}
      </div>

      <p style={{ color: "#64748b", fontSize: 13, marginTop: 22 }}>
        Exibindo até 100 registros mais recentes. Nenhuma ação de “resolver” está disponível nesta etapa para evitar baixa financeira sem trilha de auditoria.
      </p>
    </main>
  );
}
