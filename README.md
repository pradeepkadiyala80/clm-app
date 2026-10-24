# Contract Lifecycle Management — IBM Carbon React Client

An IBM Carbon Design System application for AI-powered contract risk analysis using the agentOS Trade Finance Risk RAG Analyzer agent. Upload a contract file, ask questions in natural language, and receive a structured Red-Amber-Green (RAG) risk review with expandable drill-down detail.

---

## Prerequisites

- **Node.js** v18 or later
- **npm** v9 or later

Check your versions:

```bash
node -v
npm -v
```

---

## Quick Start

```bash
# 1. Navigate into the app directory
cd clm-app

# 2. Install dependencies (only needed once)
npm install

# 3. Start the development server
npm run dev
```

Open your browser at **http://localhost:5173** (or the port printed in the terminal).

---

## Testing the App

### Step 1 — Fill in Agent Configuration

The left panel pre-fills the Base URL and Slug. Add your API key:

| Field | Value |
|---|---|
| **Agent Base URL** | `http://ibm-techxchange.sirioncloud.io:8000` |
| **Agent Slug** | `trade-finance-risk-analyzer-2` |
| **API Key** | *(obtain from your agentOS — never commit this value)* |

Use the **show/hide eye button** on the API Key field to reveal the key.

### Step 2 — Attach the Contract File

Click **browse** (or drag and drop) in the **Contract File** drop zone and select:

```
TRADE_FINANCE_FACILITY_AGREEMENT_1.docx
```

This file is in the **project root**, one level above `clm-app/`.

### Step 3 — Send the Test Prompt

The input box is pre-filled with:

```
Show me a standard RAG risk table for trade finance contracts.
```

Press **Enter** or click the **Send** button. The app will:

1. Upload the contract file to the agentOS file endpoint
2. Attach the file reference to your message
3. Stream the structured risk review into the right panel

### Step 4 — Read the Response

The right panel renders the agent's output as a structured IBM Carbon report:

| Section | What it shows |
|---|---|
| **Overall Risk** | Red / Amber / Green Carbon Tag for the whole contract |
| **Executive Summary** | Three metric cards — counts of Red, Amber and Green findings |
| **Top Risks** | The 3 most critical issues, highlighted with a red left border |
| **Full Risk Register** | All findings as expandable cards — click any card to reveal *What*, *Why it matters*, *Potential impact* and *Suggested action* |
| **Pipeline** | The AI processing steps that produced the review |

### Step 5 — Download the CSV

When a structured result is displayed, click **Download CSV** (top-right of the result panel) to save all risk findings as a spreadsheet with columns: Risk Category, Risk Issue, Contract Reference, RAG Status, Impact, What, Why, Suggested Action.

---

## Follow-up Questions

The app maintains a session ID across turns. After the first response, send follow-up questions without re-attaching the file:

- `What are the top 3 red risks in this contract?`
- `Which clauses create the most payment risk?`
- `Summarise the sanctions obligations for the Applicant.`

Click the **Reset** icon (↺) in the header to clear the conversation and start a new session.

---

## Production Build

```bash
npm run build
```

Output goes to `dist/`. Serve with any static file host:

```bash
npx serve dist
```

---

## Project Structure

```
clm-app/
├── src/
│   ├── api.ts                      # agentOS API client — file upload + chat completion
│   ├── parser.ts                   # Extracts structured RAG payload from API annotations
│   ├── types.ts                    # Shared TypeScript types
│   ├── App.tsx                     # Shell — Carbon Header, two-column layout, state management
│   ├── App.scss                    # Layout styles using Carbon design tokens
│   ├── carbon.scss                 # Carbon component imports and theme setup
│   └── components/
│       ├── ConfigPanel.tsx         # Carbon TextInput + PasswordInput for agent config
│       ├── FileUpload.tsx          # Drag-and-drop contract file selector
│       ├── StructuredResponse.tsx  # Full risk report — summary cards, risk cards, pipeline
│       └── ResponsePanel.tsx       # Routes to StructuredResponse or markdown fallback
├── index.html
├── package.json
└── vite.config.ts
```

---

## IBM Carbon Components Used

| Component | Usage |
|---|---|
| `Header`, `HeaderName`, `HeaderGlobalBar`, `HeaderGlobalAction` | Top navigation bar with IBM prefix |
| `Button` | Send (primary), Download CSV (ghost), Reset (icon) |
| `TextInput` | Agent Base URL and Slug fields |
| `PasswordInput` | API Key field with built-in show/hide |
| `Tag` | Red / Amber / Green RAG status badges |
| `InlineNotification` | Error messages |
| `InlineLoading` | Analysing contract loading state |
| `SkipToContent` | Accessibility skip link |
| `@carbon/icons-react` | All icons — `SendAlt`, `Reset`, `DocumentDownload`, `Bot`, `UserAvatar`, `ChevronDown/Up`, `Document`, `TrashCan`, `Upload`, `Settings` |

---

## API Endpoints Used

| Operation | Method | Path |
|---|---|---|
| Upload contract file | `POST` | `/agentos/api/files/upload` |
| Chat completion | `POST` | `/agentos/api/chat-agents/{slug}/chat/completions` |

Both endpoints use `Authorization: Bearer <api-key>`. The chat endpoint also receives an `X-Session-Id` header so the agent retains conversation history server-side.
