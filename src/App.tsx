import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Header, HeaderName, HeaderGlobalBar, HeaderGlobalAction, SkipToContent,
  Button, InlineNotification,
} from '@carbon/react';
import {
  SendAlt, Reset, DocumentDownload, Bot,
  DocumentAttachment, Attachment, Settings, Close, ChevronRight,
} from '@carbon/icons-react';
import { ConfigPanel } from './components/ConfigPanel';
import { ResponsePanel } from './components/ResponsePanel';
import { uploadFile, sendMessage } from './api';
import { parseAgentResponse } from './parser';
import type { AgentConfig, Message, ParsedResponse, AgentResponse } from './types';
import './carbon.scss';
import './App.scss';

const INITIAL_CONFIG: AgentConfig = {
  baseUrl: 'https://ibm-techxchange.sirioncloud.io',
  apiKey: '',
  agentSlug: 'trade-finance-risk-analyzer-2',
};

const SUGGESTIONS = [
  { icon: '📄', text: 'Show me a standard RAG risk table for trade finance contracts.' },
  { icon: '🔴', text: 'What are the top 3 red risks in this contract?' },
  { icon: '💰', text: 'Summarise the payment obligations and their risks.' },
  { icon: '⚖️', text: 'Which clauses carry the most sanctions exposure?' },
];

function makeId() { return Math.random().toString(36).slice(2, 10); }
function makeSessionId() { return `TFA-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }

// Auto-resize textarea
function useAutoResize(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value, ref]);
}

export default function App() {
  const [config, setConfig] = useState<AgentConfig>(INITIAL_CONFIG);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploadedFileId, setUploadedFileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId] = useState(makeSessionId);
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeResult, setActiveResult] = useState<AgentResponse | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useAutoResize(textareaRef, input);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    if (!config.baseUrl || !config.apiKey || !config.agentSlug) {
      setSettingsOpen(true);
      setError('Please fill in the Agent Configuration before sending.');
      return;
    }
    setError(null);
    setLoading(true);

    const userMsg: Message = {
      id: makeId(), role: 'user', content: text,
      timestamp: new Date(), fileName: file?.name,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    try {
      let fileId: string | undefined;
      if (file) {
        fileId = await uploadFile(config, file);
        setUploadedFileId(fileId);
        setFile(null);              // clear the file chip after upload
      } else if (uploadedFileId) {
        fileId = uploadedFileId;    // reuse already-uploaded file ID on follow-ups
      }

      const rawResponse = await sendMessage(config, [...messages, userMsg], sessionId, fileId);
      const parsed = parseAgentResponse(rawResponse);

      const assistantMsg: Message = {
        id: makeId(), role: 'assistant',
        // Store only the text content for history — not the raw JSON blob.
        // Sending the full JSON back to agentOS on follow-ups causes 500 errors.
        content: parsed.type === 'structured'
          ? (parsed.raw ?? 'Risk analysis complete.')
          : (parsed.raw ?? rawResponse),
        timestamp: new Date(), parsed,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Auto-open the panel when structured result arrives
      if (parsed.type === 'structured') {
        setActiveResult(parsed);
        setPanelOpen(true);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
      setInput(text);
    } finally {
      setLoading(false);
    }
  }, [input, config, file, uploadedFileId, messages, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const clearConversation = () => {
    setMessages([]); setFile(null); setUploadedFileId(null); setError(null);
    setInput(''); setPanelOpen(false); setActiveResult(null);
  };

  const downloadCSV = () => {
    if (!activeResult || activeResult.type !== 'structured') return;
    const risks = activeResult.payload.risks;
    const headers = ['Risk Category', 'Risk Issue', 'Contract Reference', 'RAG Status', 'Impact', 'What', 'Why', 'Suggested Action'];
    const lines = [
      headers.join(','),
      ...risks.map((r) =>
        [r.risk_category, r.risk_issue, r.contract_reference ?? '', r.rag, r.impact ?? '', r.what ?? '', r.why ?? '', r.suggested_action ?? '']
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `risk-table-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openResult = (msg: Message) => {
    if (msg.parsed?.type === 'structured') {
      setActiveResult(msg.parsed as ParsedResponse);
      setPanelOpen(true);
    }
  };

  const configReady = !!(config.baseUrl && config.apiKey && config.agentSlug);

  return (
    <div className="clm-shell">

      {/* ── IBM Carbon Header ──────────────────────────────────── */}
      <Header aria-label="Contract Lifecycle Management">
        <SkipToContent />
        <HeaderName href="#" prefix="IBMSirion Vault">
          Trade Finance
        </HeaderName>
        <HeaderGlobalBar>
          <HeaderGlobalAction
            aria-label="Agent settings"
            tooltipAlignment="end"
            isActive={settingsOpen}
            onClick={() => setSettingsOpen((o) => !o)}
          >
            <Settings size={20} />
          </HeaderGlobalAction>
          <HeaderGlobalAction
            aria-label="New conversation"
            tooltipAlignment="end"
            onClick={clearConversation}
          >
            <Reset size={20} />
          </HeaderGlobalAction>
        </HeaderGlobalBar>
      </Header>

      {/* ── Settings drawer ─────────────────────────────────────── */}
      {settingsOpen && (
        <div className="clm-settings-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="clm-settings-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="clm-settings-header">
              <span>Agent Settings</span>
              <Button kind="ghost" size="sm" hasIconOnly renderIcon={Close}
                iconDescription="Close" onClick={() => setSettingsOpen(false)} />
            </div>
            <div className="clm-settings-body">
              <div className="clm-settings-section">
                <span className="clm-settings-section-label">Connection</span>
                <ConfigPanel config={config} onChange={setConfig} />
              </div>
              <div className="clm-settings-section">
                <span className="clm-settings-section-label">Session</span>
                <div className="clm-session-badge">
                  Session ID: <code>{sessionId}</code>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Body: chat col + risk panel ─────────────────────────── */}
      <div className="clm-body">

        {/* ── Chat column ───────────────────────────────────────── */}
        <div className="clm-chat-col">

          {/* Scrollable thread */}
          <div className="clm-thread">
            <div className="clm-thread-inner">

              {/* Welcome state */}
              {messages.length === 0 && (
                <div className="clm-welcome">

                  {/* Dummy hero banner — CSS gradient + inline SVG, no real bank images */}
                  <div className="clm-hero-banner">
                    <div className="clm-hero-left">
                      <div className="clm-hero-bank-name">IBMSirion Vault Bank</div>
                      <div className="clm-hero-tagline">Trusted Since 1892</div>
                    </div>
                    {/* Inline SVG building silhouette — purely decorative dummy art */}
                    <svg className="clm-hero-icon" width="80" height="90" viewBox="0 0 80 90" fill="none" aria-hidden="true">
                      <rect x="30" y="10" width="20" height="70" fill="white"/>
                      <rect x="10" y="25" width="60" height="55" fill="white"/>
                      <rect x="0" y="75" width="80" height="5" fill="white"/>
                      <rect x="35" y="55" width="10" height="20" fill="#0a1628"/>
                      <rect x="15" y="35" width="10" height="12" fill="#0a1628"/>
                      <rect x="55" y="35" width="10" height="12" fill="#0a1628"/>
                      <rect x="15" y="52" width="10" height="12" fill="#0a1628"/>
                      <rect x="55" y="52" width="10" height="12" fill="#0a1628"/>
                      <polygon points="20,25 40,8 60,25" fill="white"/>
                      <rect x="37" y="2" width="6" height="10" fill="#c9a84c"/>
                    </svg>
                  </div>

                  <div className="clm-welcome-logo">
                    <Bot size={26} color="#c9a84c" />
                  </div>
                  <h1 className="clm-welcome-title">Contract Risk Analyzer</h1>
                  <p className="clm-welcome-sub">
                    Upload a trade finance contract, ask a question and receive an
                    AI-powered Red–Amber–Green risk review with full drill-down detail.
                  </p>
                  <hr className="clm-welcome-divider" />
                  <div className="clm-suggestion-grid">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s.text}
                        className="clm-suggestion-card"
                        onClick={() => setInput(s.text)}
                      >
                        <span className="card-icon">{s.icon}</span>
                        <span className="card-text">{s.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Messages */}
              {messages.map((msg) => (
                <div key={msg.id} className={`clm-msg ${msg.role}`}>

                  {/* User bubble */}
                  {msg.role === 'user' && (
                    <>
                      <div className="clm-msg-bubble-user">
                        {msg.fileName && (
                          <div className="clm-file-chip-user">
                            <DocumentAttachment size={12} />
                            {msg.fileName}
                          </div>
                        )}
                        {msg.content}
                      </div>
                      <span className="clm-msg-time">
                        {msg.timestamp.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </>
                  )}

                  {/* Assistant response */}
                  {msg.role === 'assistant' && (
                    <>
                      <div className="clm-msg-assistant-row">
                        <div className="clm-msg-avatar">
                          <Bot size={16} color="white" />
                        </div>
                        <div className="clm-msg-body">
                          {msg.parsed?.type === 'structured' ? (
                            /* Structured chip — click to open panel */
                            <div
                              className="clm-msg-structured-chip"
                              onClick={() => openResult(msg)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openResult(msg); }}
                            >
                              <div className="clm-chip-header">
                                <span className="clm-chip-title">
                                  {msg.parsed.payload.contract_name ?? 'Contract Risk Review'}
                                </span>
                                <span className="clm-chip-meta">
                                  {msg.timestamp.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <div className="clm-chip-counts">
                                <span className="clm-chip-count red">
                                  🔴 {msg.parsed.payload.high_count} Red
                                </span>
                                <span className="clm-chip-count amber">
                                  🟡 {msg.parsed.payload.moderate_count} Amber
                                </span>
                                <span className="clm-chip-count green">
                                  🟢 {msg.parsed.payload.low_count} Green
                                </span>
                              </div>
                              <span className="clm-chip-cta">
                                <ChevronRight size={14} />
                                Open full risk analysis
                              </span>
                            </div>
                          ) : (
                            <div className="clm-msg-text">
                              {msg.parsed
                                ? <ResponsePanel response={msg.parsed} />
                                : <p>{msg.content as string}</p>}
                            </div>
                          )}
                        </div>
                      </div>
                      <span className="clm-msg-time">
                        {msg.timestamp.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </>
                  )}
                </div>
              ))}

              {/* Typing indicator */}
              {loading && (
                <div className="clm-msg assistant">
                  <div className="clm-msg-assistant-row">
                    <div className="clm-msg-avatar">
                      <Bot size={16} color="white" />
                    </div>
                    <div className="clm-msg-body">
                      <div className="clm-typing">
                        <span className="clm-dot" />
                        <span className="clm-dot" />
                        <span className="clm-dot" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Error */}
              {error && (
                <InlineNotification
                  kind="error"
                  title="Error — "
                  subtitle={error}
                  onClose={() => setError(null)}
                  lowContrast
                />
              )}

              <div ref={bottomRef} />
            </div>
          </div>

          {/* ── Pinned input bar ──────────────────────────────── */}
          <div className="clm-input-bar">
            <div className="clm-input-inner">

              {/* Rounded card: file chip + textarea + toolbar */}
              <div className="clm-input-card">
                {file && (
                  <div className="clm-input-file-chip">
                    <DocumentAttachment size={12} />
                    <span>{file.name}</span>
                    <button onClick={() => setFile(null)} title="Remove file" aria-label="Remove file">
                      <Close size={12} />
                    </button>
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  className="clm-textarea"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about your contract…"
                  disabled={loading}
                  rows={1}
                  aria-label="Message"
                />
                {/* Bottom toolbar: attach icon left, send button right */}
                <div className="clm-input-toolbar">
                  <div className="clm-input-toolbar-left">
                    <button
                      className="clm-icon-btn"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={loading}
                      title="Attach contract file"
                      aria-label="Attach contract file"
                    >
                      <Attachment size={18} />
                    </button>
                  </div>
                  <button
                    className="clm-send-btn"
                    onClick={handleSend}
                    disabled={loading || !input.trim() || !configReady}
                    title="Send message"
                    aria-label="Send message"
                  >
                    <SendAlt size={18} />
                  </button>
                </div>
              </div>

              {/* Quick suggestion pills row */}
              <div className="clm-suggestion-pills">
                {SUGGESTIONS.slice(0, 3).map((s) => (
                  <button
                    key={s.text}
                    className="clm-pill"
                    onClick={() => setInput(s.text)}
                    title={s.text}
                  >
                    {s.icon} {s.text.slice(0, 38)}{s.text.length > 38 ? '…' : ''}
                  </button>
                ))}
              </div>

            </div>
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,.doc,.pdf"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setFile(f);
              e.target.value = '';
            }}
          />
        </div>

        {/* ── Risk panel (slides in from right) ──────────────── */}
        <div className={`clm-panel ${panelOpen ? 'open' : ''}`}>
          <div className="clm-panel-inner">
            <div className="clm-panel-header">
              <span className="clm-panel-title">Risk Analysis</span>
              <div className="clm-panel-actions">
                {activeResult && (
                  <Button
                    kind="ghost"
                    size="sm"
                    renderIcon={DocumentDownload}
                    iconDescription="Download CSV"
                    onClick={downloadCSV}
                  >
                    CSV
                  </Button>
                )}
                <Button
                  kind="ghost"
                  size="sm"
                  hasIconOnly
                  renderIcon={Close}
                  iconDescription="Close panel"
                  onClick={() => setPanelOpen(false)}
                />
              </div>
            </div>
            <div className="clm-panel-body">
              {activeResult && activeResult.type === 'structured' && (
                <ResponsePanel response={activeResult} />
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
