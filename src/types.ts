export type RagStatus = 'Red' | 'Amber' | 'Green';

// ── Rich risk item from the agent's UI component annotation ─────────────────
export interface RiskItem {
  risk_category: string;
  risk_issue: string;
  contract_reference?: string;
  impact?: string;
  rag: RagStatus;
  what?: string;
  why?: string;
  potential_impact?: string;
  severity?: string;
  suggested_action?: string;
}

// ── The structured payload emitted by the ui_risks_in_a_trade_finance_contract tool ──
export interface AgentUIPayload {
  overall_contract_risk: RagStatus;
  high_count: number;
  moderate_count: number;
  low_count: number;
  contract_name?: string;
  top_risks: string[];
  risks: RiskItem[];
}

// ── Parsed response variants ─────────────────────────────────────────────────
export interface ParsedResponse {
  type: 'structured';
  payload: AgentUIPayload;
  raw: string;
}

export interface RawResponse {
  type: 'raw';
  raw: string;
}

export type AgentResponse = ParsedResponse | RawResponse;

// ── Conversation message ─────────────────────────────────────────────────────
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  parsed?: AgentResponse;
  fileName?: string;
}

// ── Agent configuration ──────────────────────────────────────────────────────
export interface AgentConfig {
  baseUrl: string;
  apiKey: string;
  agentSlug: string;
}
