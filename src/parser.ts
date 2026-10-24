import type { RagStatus, RiskItem, AgentUIPayload, AgentResponse } from './types';

// ── Normalise RAG strings that may include emoji or severity prefixes ─────────
// e.g. "🔴 Red" → "Red", "Amber" → "Amber", "🟢 Green" → "Green", "High" → "Red"
export function normaliseRag(val: unknown): RagStatus | null {
  if (typeof val !== 'string') return null;
  const v = val.toLowerCase().trim();
  if (v.includes('red') || v.includes('high') || v.includes('critical')) return 'Red';
  if (v.includes('amber') || v.includes('yellow') || v.includes('orange') || v.includes('moderate') || v.includes('medium')) return 'Amber';
  if (v.includes('green') || v.includes('low')) return 'Green';
  return null;
}

// ── Flexible field extractor: matches keys case-insensitively ignoring _ - spaces
function getField(obj: Record<string, unknown>, candidateKeys: string[]): string | undefined {
  const normMap = new Map<string, string>();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) {
      const cleanKey = k.toLowerCase().replace(/[\s_\-]/g, '');
      const strVal = String(v).trim();
      if (strVal !== '') {
        normMap.set(cleanKey, strVal);
      }
    }
  }

  for (const candidate of candidateKeys) {
    const cleanCand = candidate.toLowerCase().replace(/[\s_\-]/g, '');
    const val = normMap.get(cleanCand);
    if (val !== undefined && val !== '') {
      return val;
    }
  }
  return undefined;
}

// ── Build a RiskItem from any dictionary with tolerant field naming ───────────
function buildRiskItem(r: Record<string, unknown>): RiskItem {
  const category = getField(r, [
    'risk_category', 'riskCategory', 'Risk Category', 'category', 'Category',
    'risk_cat', 'RiskCat', 'type', 'Type', 'risk_type', 'Risk Type',
  ]) ?? '';

  let issue = getField(r, [
    'risk_issue', 'riskIssue', 'Risk Issue', 'risk_description', 'riskDescription',
    'Risk Description', 'description', 'Description', 'issue', 'Issue', 'risk', 'Risk',
    'finding', 'Finding', 'findings', 'Findings', 'title', 'Title', 'summary', 'Summary',
    'details', 'Details', 'clause_description', 'risk_name', 'Risk Name', 'risk_title',
    'risk_item', 'identified_risk', 'problem', 'Problem', 'text', 'Text', 'item', 'Item',
  ]) ?? '';

  const reference = getField(r, [
    'contract_reference', 'contractReference', 'Contract Reference', 'reference', 'Reference',
    'clause', 'Clause', 'section', 'Section', 'clause_reference', 'Clause Reference',
    'contract_clause', 'Contract Clause', 'citation', 'Citation', 'ref', 'Ref',
  ]);

  const impact = getField(r, [
    'impact', 'Impact', 'potential_impact', 'potentialImpact', 'Potential Impact',
    'severity', 'Severity', 'risk_impact', 'Risk Impact', 'consequence', 'Consequence',
  ]);

  const ragRaw = getField(r, [
    'rag', 'RAG', 'rag_status', 'ragStatus', 'RAG Status', 'status', 'Status',
    'risk_level', 'riskLevel', 'Risk Level', 'level', 'Level', 'rating', 'Rating', 'severity',
  ]);
  const rag = normaliseRag(ragRaw) ?? 'Amber';

  const what = getField(r, [
    'what', 'What', 'what_is_it', 'What Is It', 'issue_detail', 'explanation', 'Explanation',
  ]);

  const why = getField(r, [
    'why', 'Why', 'why_it_matters', 'whyItMatters', 'Why It Matters', 'rationale', 'Rationale',
    'reason', 'Reason', 'significance', 'Significance',
  ]);

  const potential_impact = getField(r, [
    'potential_impact', 'potentialImpact', 'Potential Impact', 'consequence', 'Consequence',
  ]) ?? impact;

  const suggested_action = getField(r, [
    'suggested_action', 'suggestedAction', 'Suggested Action', 'action', 'Action',
    'mitigation', 'Mitigation', 'recommendation', 'Recommendation', 'suggested_mitigation',
    'remedy', 'Remedy', 'drill_down_detail', 'Drill-Down Detail', 'drillDownDetail',
  ]);

  // If issue is still empty, fall back to what, description, or why
  if (!issue && what) issue = what;
  if (!issue && why) issue = why;
  if (!issue && reference) issue = `Issue in ${reference}`;
  if (!issue && category) issue = category;

  return {
    risk_category: category || (issue ? 'General Risk' : 'Contract Risk'),
    risk_issue: issue || 'Unspecified risk',
    contract_reference: reference,
    impact,
    rag,
    what,
    why,
    potential_impact,
    severity: impact,
    suggested_action,
  };
}

// ── Build AgentUIPayload from raw object ─────────────────────────────────────
function buildPayload(ip: Record<string, unknown>): AgentUIPayload {
  const rawRisks = (Array.isArray(ip.risks) ? ip.risks : []) as unknown[];
  const risks: RiskItem[] = rawRisks
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => buildRiskItem(r));

  const overallRaw = normaliseRag(ip.overall_contract_risk ?? ip.overall_risk ?? ip.overallRisk);
  const red = risks.filter((r) => r.rag === 'Red').length;
  const amber = risks.filter((r) => r.rag === 'Amber').length;
  const green = risks.filter((r) => r.rag === 'Green').length;

  const overall: RagStatus = overallRaw ?? (red > 0 ? 'Red' : amber > 0 ? 'Amber' : 'Green');

  // Extract top risks cleanly (ensure non-empty strings)
  let top_risks: string[] = [];
  if (Array.isArray(ip.top_risks)) {
    top_risks = (ip.top_risks as unknown[])
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (typeof item === 'object' && item !== null) {
          const itemObj = item as Record<string, unknown>;
          return getField(itemObj, ['risk_issue', 'risk_description', 'description', 'issue', 'risk', 'title', 'name']) ?? '';
        }
        return '';
      })
      .filter((s) => s.length > 0);
  }

  // Fallback to top Red risks if top_risks was empty or contained blanks
  if (top_risks.length === 0) {
    top_risks = risks
      .filter((r) => r.rag === 'Red')
      .slice(0, 3)
      .map((r) => r.risk_issue)
      .filter((s) => s.length > 0);
  }

  if (top_risks.length === 0 && risks.length > 0) {
    top_risks = risks
      .slice(0, 3)
      .map((r) => r.risk_issue)
      .filter((s) => s.length > 0);
  }

  return {
    overall_contract_risk: overall,
    high_count: typeof ip.high_count === 'number' ? ip.high_count : red,
    moderate_count: typeof ip.moderate_count === 'number' ? ip.moderate_count : amber,
    low_count: typeof ip.low_count === 'number' ? ip.low_count : green,
    contract_name: ip.contract_name ? String(ip.contract_name) : undefined,
    top_risks,
    risks,
  };
}

// ── Extract UI component payload from annotations array ──────────────────────
function extractUIPayload(annotations: unknown[]): AgentUIPayload | null {
  for (const ann of annotations) {
    if (typeof ann !== 'object' || ann === null) continue;
    const a = ann as Record<string, unknown>;

    // 1. Look for ui_component_render event
    if (a.eventName === 'ui_component_render') {
      const ed = a.eventData as Record<string, unknown> | undefined;
      const ip = (ed?.inputPayload ?? a.inputPayload ?? ed) as Record<string, unknown> | undefined;
      if (ip && Array.isArray(ip.risks) && ip.risks.length > 0) {
        return buildPayload(ip);
      }
    }

    // 2. Check tool_execution or other events
    const ed = (a.eventData ?? a.data ?? a) as Record<string, unknown> | undefined;
    if (ed) {
      const data = (ed.data ?? ed) as Record<string, unknown>;
      // Check data.input or data.output as JSON string
      for (const field of ['input', 'output', 'result', 'payload']) {
        const val = data[field];
        if (typeof val === 'string' && (val.includes('{') || val.includes('['))) {
          try {
            const parsed = JSON.parse(val) as Record<string, unknown>;
            if (Array.isArray(parsed.risks) && parsed.risks.length > 0) {
              return buildPayload(parsed);
            }
            if (Array.isArray(parsed) && parsed.length > 0) {
              const res = buildFromJsonArray(parsed);
              if (res) return res;
            }
            if (typeof parsed.jsonArray === 'string') {
              const inner = JSON.parse(parsed.jsonArray) as unknown[];
              if (Array.isArray(inner) && inner.length > 0) {
                const res = buildFromJsonArray(inner);
                if (res) return res;
              }
            }
          } catch {
            // ignore non-JSON
          }
        } else if (typeof val === 'object' && val !== null) {
          const obj = val as Record<string, unknown>;
          if (Array.isArray(obj.risks) && obj.risks.length > 0) {
            return buildPayload(obj);
          }
        }
      }
    }
  }
  return null;
}

function buildFromJsonArray(arr: unknown[]): AgentUIPayload | null {
  const risks: RiskItem[] = [];
  for (const item of arr) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    risks.push(buildRiskItem(r));
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
    top_risks: risks.filter((r) => r.rag === 'Red').slice(0, 3).map((r) => r.risk_issue).filter(Boolean),
    risks,
  };
}

// ── Markdown Table Parser: converts markdown tables into structured payload ──
export function parseMarkdownTable(content: string): AgentUIPayload | null {
  const lines = content.split('\n');
  const tableRows: string[][] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      // Split on | and trim each cell
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());
      // Skip separator rows like | --- | --- |
      if (cells.every((c) => /^[-:\s]+$/.test(c))) continue;
      tableRows.push(cells);
    }
  }

  if (tableRows.length < 2) return null; // Need at least header + 1 data row

  const header = tableRows[0].map((h) => h.toLowerCase().replace(/[\s_\-]/g, ''));
  const risks: RiskItem[] = [];

  // Map header column indices to fields
  const colIndex = {
    category: header.findIndex((h) => h.includes('cat') || h.includes('type')),
    issue: header.findIndex((h) => h.includes('issue') || h.includes('desc') || h.includes('risk') || h.includes('finding')),
    reference: header.findIndex((h) => h.includes('ref') || h.includes('clause') || h.includes('section')),
    rag: header.findIndex((h) => h.includes('rag') || h.includes('status') || h.includes('level') || h.includes('severity')),
    impact: header.findIndex((h) => h.includes('impact') || h.includes('severity')),
    what: header.findIndex((h) => h.includes('what')),
    why: header.findIndex((h) => h.includes('why')),
    action: header.findIndex((h) => h.includes('action') || h.includes('mitig') || h.includes('recom') || h.includes('drill')),
  };

  for (let i = 1; i < tableRows.length; i++) {
    const row = tableRows[i];
    if (row.length === 0) continue;

    const rowObj: Record<string, unknown> = {};
    if (colIndex.category !== -1 && row[colIndex.category]) rowObj.risk_category = row[colIndex.category];
    if (colIndex.issue !== -1 && row[colIndex.issue]) rowObj.risk_issue = row[colIndex.issue];
    if (colIndex.reference !== -1 && row[colIndex.reference]) rowObj.contract_reference = row[colIndex.reference];
    if (colIndex.rag !== -1 && row[colIndex.rag]) rowObj.rag = row[colIndex.rag];
    if (colIndex.impact !== -1 && row[colIndex.impact]) rowObj.impact = row[colIndex.impact];
    if (colIndex.what !== -1 && row[colIndex.what]) rowObj.what = row[colIndex.what];
    if (colIndex.why !== -1 && row[colIndex.why]) rowObj.why = row[colIndex.why];
    if (colIndex.action !== -1 && row[colIndex.action]) rowObj.suggested_action = row[colIndex.action];

    // If no specific match for issue or category, use positional defaults
    if (!rowObj.risk_category && row[0]) rowObj.risk_category = row[0];
    if (!rowObj.risk_issue && row[1]) rowObj.risk_issue = row[1];

    const risk = buildRiskItem(rowObj);
    if (risk.risk_category || risk.risk_issue) {
      risks.push(risk);
    }
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
    top_risks: risks.filter((r) => r.rag === 'Red').slice(0, 3).map((r) => r.risk_issue).filter(Boolean),
    risks,
  };
}

// ── Merge annotations payload with markdown data to fill in any missing fields ──
function enrichPayload(annPayload: AgentUIPayload, mdPayload: AgentUIPayload | null): AgentUIPayload {
  if (!mdPayload || mdPayload.risks.length === 0) return annPayload;

  // If annotation risks have empty issues or references, try to fill from markdown table
  const enrichedRisks = annPayload.risks.map((annRisk, idx) => {
    const mdRisk = mdPayload.risks[idx];
    if (!mdRisk) return annRisk;

    return {
      ...annRisk,
      risk_category: annRisk.risk_category || mdRisk.risk_category,
      risk_issue: (annRisk.risk_issue && annRisk.risk_issue !== annRisk.risk_category)
        ? annRisk.risk_issue
        : (mdRisk.risk_issue || annRisk.risk_issue),
      contract_reference: annRisk.contract_reference || mdRisk.contract_reference,
      what: annRisk.what || mdRisk.what,
      why: annRisk.why || mdRisk.why,
      potential_impact: annRisk.potential_impact || mdRisk.potential_impact,
      suggested_action: annRisk.suggested_action || mdRisk.suggested_action,
    };
  });

  // Re-evaluate top risks if needed
  let top_risks = annPayload.top_risks.filter(Boolean);
  if (top_risks.length === 0) {
    top_risks = enrichedRisks
      .filter((r) => r.rag === 'Red')
      .slice(0, 3)
      .map((r) => r.risk_issue)
      .filter(Boolean);
  }

  return {
    ...annPayload,
    top_risks: top_risks.length > 0 ? top_risks : mdPayload.top_risks,
    risks: enrichedRisks.length > 0 ? enrichedRisks : mdPayload.risks,
  };
}

// ── Public entry point ───────────────────────────────────────────────────────
export function parseAgentResponse(rawJson: string): AgentResponse {
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

  // 1. Try to extract rich payload from annotations
  const annPayload = annotations.length > 0 ? extractUIPayload(annotations) : null;

  // 2. Try to extract markdown table payload from content
  const mdPayload = content ? parseMarkdownTable(content) : null;

  // 3. Select / combine the best available structured data
  if (annPayload) {
    const finalPayload = enrichPayload(annPayload, mdPayload);
    return { type: 'structured', payload: finalPayload, raw: content };
  }

  if (mdPayload) {
    return { type: 'structured', payload: mdPayload, raw: content };
  }

  // 4. Fall back to plain text
  return { type: 'raw', raw: content || rawJson };
}
