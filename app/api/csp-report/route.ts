import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_REPORT_BYTES = 8192;
const MAX_REPORTS_PER_MINUTE = 30;
const requests = new Map<string, { count: number; resetAt: number }>();

function safeLocation(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  if (value === "inline" || value === "eval" || value === "data") return value;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.origin + parsed.pathname.slice(0, 240);
    }
  } catch {
    return value.split(/[?#]/, 1)[0].slice(0, 240);
  }
  return value.split(/[?#]/, 1)[0].slice(0, 240);
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-real-ip") || "unknown";
  const now = Date.now();
  const current = requests.get(ip);
  if (current && current.resetAt > now && current.count >= MAX_REPORTS_PER_MINUTE) {
    return new NextResponse(null, { status: 429, headers: { "Cache-Control": "no-store" } });
  }
  if (!current || current.resetAt <= now) {
    if (requests.size > 5000) requests.clear();
    requests.set(ip, { count: 1, resetAt: now + 60_000 });
  } else {
    current.count += 1;
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_REPORT_BYTES) {
    return new NextResponse(null, { status: 413, headers: { "Cache-Control": "no-store" } });
  }

  const reader = request.body?.getReader();
  if (!reader) return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REPORT_BYTES) {
        await reader.cancel();
        return new NextResponse(null, { status: 413, headers: { "Cache-Control": "no-store" } });
      }
      chunks.push(value);
    }
  } catch {
    return new NextResponse(null, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    const report = payload?.["csp-report"] || payload?.body || payload;
    if (report && typeof report === "object") {
      console.info("CSP_REPORT", JSON.stringify({
        document: safeLocation(report["document-uri"] || report.documentURL),
        blocked: safeLocation(report["blocked-uri"] || report.blockedURL),
        directive: String(report["effective-directive"] || report["violated-directive"] || report.effectiveDirective || "").slice(0, 100),
        disposition: String(report.disposition || "report"),
        source: safeLocation(report["source-file"] || report.sourceFile),
      }));
    }
  } catch {
    // Invalid or unsupported browser report: discard without exposing request data.
  }

  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
