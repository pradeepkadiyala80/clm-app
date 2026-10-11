import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AgentResponse } from '../types';
import { StructuredResponse } from './StructuredResponse';

interface Props {
  response: AgentResponse;
}

export function ResponsePanel({ response }: Props) {
  if (response.type === 'structured') {
    return <StructuredResponse data={response} />;
  }

  return (
    <div className="clm-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {response.raw}
      </ReactMarkdown>
    </div>
  );
}
