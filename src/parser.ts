import type { RagStatus, RiskItem, AgentUIPayload, ParsedResponse, AgentResponse } from './types';

// ── Normalise RAG strings that may include emoji prefixes ───────────────────
// e.g. "🔴 Red" → "Red",  "Amber" → "Amber",  "🟢 Green" → "Green"
function normaliseRag(val: unknown): RagStatus | null {
  if (typeof val !== 'string') return null;
  const v = val.toLowerCase();
  if (v.includes('red')) return 'Red';
  if (v.includes('amber') || v.includes('yellow') || v.includes('orange')) return 'Amber';
  if (v.includes('green')) return 'Green';
  return null;
}

// ── Extract the UI component payload from the annotations array ─────────────
function extractUIPayload(annotations: unknown[]): AgentUIPayload | null {
  for (const ann of annotations) {
    if (typeof ann !== 'object' || ann === null) continue;
    const a = ann as Record<string, unknown>;

    // Look for the ui_component_render event that carries inputPayload
    if (a.eventName === 'ui_component_render') {
      const ed = a.eventData as Record<string, unknown> | undefined;
      if (!ed) continue;
      const ip = ed.inputPayload as Record<string, unknown> | undefined;
      if (ip && Array.isArray(ip.risks)) {
        return buildPayload(ip);
      }
    }

    // Also check tool_execution events that may carry the JSON in data.input
    if (a.eventName === 'tool_execution') {
      const ed = a.eventData as Record<string, unknown> | undefined;
      if (!ed) continue;
      const data = ed.data as Record<string, unknown> | undefined;
      if (!data) continue;

      // Try data.input as a JSON string
      if (typeof data.input === 'string') {
        try {
          const parsed = JSON.parse(data.input) as Record<string, unknown>;
          if (Array.isArray(parsed.risks)) {
            return buildPayload(parsed);
          }
          // It might be wrapped in a jsonArray key
          if (typeof parsed.jsonArray === 'string') {
            const inner = JSON.parse(parsed.jsonArray) as unknown[];
            if (Array.isArray(inner)) {
              return buildFromJsonArray(inner);
            }
          }
        } catch {
          // not JSON — ignore
        }
      }

      // Try data.output as JSON string
      if (typeof data.output === 'string' && data.output.startsWith('[')) {
        try {
          const arr = JSON.parse(data.output) as unknown[];
          if (Array.isArray(arr) && arr.length > 0) {
            const candidate = buildFromJsonArray(arr);
            if (candidate) return candidate;
          }
        } catch {
          // ignore
        }
      }
    }
  }
  return null;
}

function buildPayload(ip: Record<string, unknown>): AgentUIPayload {
  const risks: RiskItem[] = (ip.risks as Record<string, unknown>[]).map((r) => ({
    risk_category: String(r.risk_category ?? r['Risk Category'] ?? ''),
    risk_issue: String(r.risk_issue ?? r['Risk Description'] ?? r.risk_description ?? ''),
    contract_reference: r.contract_reference ? String(r.contract_reference) : undefined,
    impact: r.impact ? String(r.impact) : undefined,
    rag: normaliseRag(r.rag ?? r['RAG Status'] ?? r.rag_status) ?? 'Amber',
    what: r.what ? String(r.what) : undefined,
    why: r.why ? String(r.why) : undefined,
    potential_impact: r.potential_impact ? String(r.potential_impact) : undefined,
    severity: r.severity ? String(r.severity) : undefined,
    suggested_action: r.suggested_action ? String(r.suggested_action) : undefined,
  }));

  const overallRaw = normaliseRag(ip.overall_contract_risk);
  const overall: RagStatus = overallRaw ??
    (risks.some((r) => r.rag === 'Red') ? 'Red' : risks.some((r) => r.rag === 'Amber') ? 'Amber' : 'Green');

  const red = risks.filter((r) => r.rag === 'Red').length;
  const amber = risks.filter((r) => r.rag === 'Amber').length;
  const green = risks.filter((r) => r.rag === 'Green').length;

  return {
    overall_contract_risk: overall,
    high_count: typeof ip.high_count === 'number' ? ip.high_count : red,
    moderate_count: typeof ip.moderate_count === 'number' ? ip.moderate_count : amber,
    low_count: typeof ip.low_count === 'number' ? ip.low_count : green,
    contract_name: ip.contract_name ? String(ip.contract_name) : undefined,
    top_risks: Array.isArray(ip.top_risks) ? (ip.top_risks as string[]) : risks.filter((r) => r.rag === 'Red').slice(0, 3).map((r) => r.risk_issue),
    risks,
  };
}

function buildFromJsonArray(arr: unknown[]): AgentUIPayload | null {
  const risks: RiskItem[] = [];
  for (const item of arr) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    const rag = normaliseRag(r.rag ?? r['RAG Status'] ?? r['RAG status']);
    if (!rag) continue;
    risks.push({
      risk_category: String(r.risk_category ?? r['Risk Category'] ?? ''),
      risk_issue: String(r.risk_issue ?? r['Risk Description'] ?? r.description ?? ''),
      contract_reference: r.contract_reference ? String(r.contract_reference) : undefined,
      rag,
      what: r.what ? String(r.what) : undefined,
      why: r.why ? String(r.why) : undefined,
      suggested_action: r.suggested_action ?? r['Drill-Down Detail'] ? String(r.suggested_action ?? r['Drill-Down Detail']) : undefined,
    });
  }
  if (risks.length === 0) return null;
  const red = risks.filter((r) => r.rag === 'Red').length;
  const amber = risks.filter((r) => r.rag === 'Amber').length;
  const green = risks.filter((r) => r.rag === 'Green').length;
  return {
    overall_contract_risk: red > 0 ? 'Red' : amber > 0 ? 'Amber' : 'Green',
    high_count: red,
    moderate_count: amber,
    low_count: green,
    top_risks: risks.filter((r) => r.rag === 'Red').slice(0, 3).map((r) => r.risk_issue),
    risks,
  };
}

// ── Public entry point ───────────────────────────────────────────────────────
export function parseAgentResponse(rawJson: string): AgentResponse {
  // The api.ts returns JSON.stringify(data) — parse it
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rawJson) as Record<string, unknown>;
  } catch {
    return { type: 'raw', raw: rawJson };
  }

  const content: string =
    (data.choices as Array<{ message: { content: string } }>)?.[0]?.message?.content ?? '';

  const annotations: unknown[] =
    (data.choices as Array<{ message: { annotations?: unknown[] } }>)?.[0]?.message?.annotations ?? [];

  // Try to extract rich structured payload from annotations
  if (annotations.length > 0) {
    const payload = extractUIPayload(annotations);
    if (payload) {
      const parsed: ParsedResponse = { type: 'structured', payload, raw: content };
      return parsed;
    }
  }

  // Fall back to plain text content
  return { type: 'raw', raw: content || rawJson };
}
