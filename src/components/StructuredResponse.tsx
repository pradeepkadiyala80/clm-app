import { useState } from 'react';
import type { ParsedResponse, RiskItem, RagStatus } from '../types';
import { Tag } from '@carbon/react';
import { ChevronDown, ChevronUp } from '@carbon/icons-react';

const PIPELINE = [
  'Trade Finance Contract',
  'AI Contract Review',
  'Risk Identification',
  'Risk Categorisation',
  'RAG Assessment',
  'Executive Risk Dashboard',
  'Detailed Risk & Mitigation',
];

const RAG_TAG_TYPE: Record<RagStatus, 'red' | 'warm-gray' | 'green'> = {
  Red: 'red',
  Amber: 'warm-gray',
  Green: 'green',
};

const RAG_LABEL: Record<RagStatus, string> = {
  Red: '● Red',
  Amber: '● Amber',
  Green: '● Green',
};

interface Props {
  data: ParsedResponse;
}

export function StructuredResponse({ data }: Props) {
  const { payload } = data;
  const reviewedAt = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="clm-response">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="clm-response-header">
        <div>
          <p className="clm-response-agent-label">IBMSirion Vault · AI Risk Assessment</p>
          <h2 className="clm-response-title">
            {payload.contract_name ?? 'Trade Finance Contract Risk Review'}
          </h2>
          <p className="clm-response-date">Reviewed {reviewedAt}</p>
        </div>

        <div className="clm-overall-risk">
          <span className="clm-overall-label">Overall Risk</span>
          <Tag
            type={RAG_TAG_TYPE[payload.overall_contract_risk]}
            size="md"
          >
            {RAG_LABEL[payload.overall_contract_risk]}
          </Tag>
        </div>
      </div>

      {/* ── Executive Summary ───────────────────────────────────── */}
      <div className="clm-section">
        <p className="clm-section-heading">Executive Summary</p>
        <div className="clm-summary-cards">
          <SummaryCard count={payload.high_count} status="Red" label="High-risk issues requiring immediate attention" />
          <SummaryCard count={payload.moderate_count} status="Amber" label="Moderate risks or issues requiring review" />
          <SummaryCard count={payload.low_count} status="Green" label="Low or no material risk identified" />
        </div>
      </div>

      {/* ── Top Risks ───────────────────────────────────────────── */}
      {payload.top_risks.length > 0 && (
        <div className="clm-section">
          <p className="clm-section-heading">Top Risks Requiring Attention</p>
          <div className="clm-top-risks">
            {payload.top_risks.slice(0, 3).map((risk, i) => (
              <div key={i} className="clm-top-risk-item">
                <span className="clm-top-risk-num">{i + 1}</span>
                {risk}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Full Risk Register ───────────────────────────────────── */}
      <div className="clm-section">
        <p className="clm-section-heading">
          Full Risk Register — {payload.risks.length} findings
        </p>
        <div className="clm-risk-list">
          {(['Red', 'Amber', 'Green'] as RagStatus[]).flatMap((rag) =>
            payload.risks
              .filter((r) => r.rag === rag)
              .map((risk, i) => <RiskCard key={`${rag}-${i}`} risk={risk} />)
          )}
        </div>
      </div>

      {/* ── Pipeline ────────────────────────────────────────────── */}
      <div className="clm-section">
        <p className="clm-section-heading">How This Review Was Produced</p>
        <div className="clm-pipeline">
          {PIPELINE.map((step, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="clm-pipeline-step">{step}</span>
              {i < PIPELINE.length - 1 && <span className="clm-pipeline-arrow">→</span>}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Expandable risk card ──────────────────────────────────────────────────────
function RiskCard({ risk }: { risk: RiskItem }) {
  const [open, setOpen] = useState(false);
  const hasDetail = risk.what || risk.why || risk.suggested_action || risk.potential_impact;

  return (
    <div className={`clm-risk-card rag-${risk.rag.toLowerCase()}`}>
      <div
        className="clm-risk-card-header"
        onClick={() => hasDetail && setOpen((o) => !o)}
        role={hasDetail ? 'button' : undefined}
        tabIndex={hasDetail ? 0 : undefined}
        onKeyDown={(e) => { if (hasDetail && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen((o) => !o); } }}
        aria-expanded={hasDetail ? open : undefined}
      >
        <Tag type={RAG_TAG_TYPE[risk.rag]} size="sm">
          {RAG_LABEL[risk.rag]}
        </Tag>
        <div className="clm-risk-meta">
          <p className="clm-risk-cat">{risk.risk_category}</p>
          <p className="clm-risk-issue">{risk.risk_issue}</p>
          {risk.contract_reference && (
            <p className="clm-risk-ref">{risk.contract_reference}</p>
          )}
        </div>
        {hasDetail && (
          <span className={`clm-risk-chevron ${open ? 'open' : ''}`}>
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        )}
      </div>

      {open && hasDetail && (
        <div className="clm-risk-detail">
          {risk.what && (
            <DetailRow label="What" value={risk.what} />
          )}
          {risk.why && (
            <DetailRow label="Why it matters" value={risk.why} />
          )}
          {risk.potential_impact && (
            <DetailRow label="Potential impact" value={risk.potential_impact} />
          )}
          {risk.suggested_action && (
            <DetailRow label="Suggested action" value={risk.suggested_action} accent />
          )}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="clm-detail-row">
      <span className={`clm-detail-label ${accent ? 'accent' : 'default'}`}>{label}:</span>
      {value}
    </div>
  );
}

// ── Summary card ─────────────────────────────────────────────────────────────
const SUMMARY_COLORS: Record<RagStatus, { count: string; border: string }> = {
  Red:   { count: '#da1e28', border: '#fa4d56' },
  Amber: { count: '#f1c21b', border: '#f1c21b' },
  Green: { count: '#24a148', border: '#42be65' },
};

const SUMMARY_EMOJI: Record<RagStatus, string> = {
  Red: '🔴', Amber: '🟡', Green: '🟢',
};

function SummaryCard({ count, status, label }: { count: number; status: RagStatus; label: string }) {
  const colors = SUMMARY_COLORS[status];
  return (
    <div
      className="clm-summary-card"
      style={{ borderTop: `3px solid ${colors.border}` }}
    >
      <div className="clm-summary-card-header" style={{ color: colors.count }}>
        <span>{SUMMARY_EMOJI[status]}</span>
        <span>{status} risks</span>
      </div>
      <div className="clm-summary-card-count" style={{ color: colors.count }}>
        {count}
      </div>
      <p className="clm-summary-card-desc">{label}</p>
    </div>
  );
}
