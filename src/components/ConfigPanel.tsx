import { TextInput, PasswordInput } from '@carbon/react';
import { Settings } from '@carbon/icons-react';
import type { AgentConfig } from '../types';

interface Props {
  config: AgentConfig;
  onChange: (config: AgentConfig) => void;
}

export function ConfigPanel({ config, onChange }: Props) {
  const set = (field: keyof AgentConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...config, [field]: e.target.value });

  return (
    <div className="clm-field-group">
      <span className="clm-section-label">
        <Settings size={12} style={{ marginRight: 6, verticalAlign: 'middle' }} />
        Agent Configuration
      </span>

      <TextInput
        id="cfg-base-url"
        labelText="Agent Base URL"
        value={config.baseUrl}
        onChange={set('baseUrl')}
        placeholder="http://your-host:port"
        size="sm"
      />

      <TextInput
        id="cfg-slug"
        labelText="Agent Slug"
        value={config.agentSlug}
        onChange={set('agentSlug')}
        placeholder="trade-finance-risk-analyzer"
        size="sm"
        helperText="The agent identifier from agentOS"
      />

      <PasswordInput
        id="cfg-api-key"
        labelText="API Key"
        value={config.apiKey}
        onChange={set('apiKey')}
        placeholder="sk_…"
        size="sm"
        hidePasswordLabel="Hide API key"
        showPasswordLabel="Show API key"
      />
    </div>
  );
}
