import type { RagStatus } from '../types';

interface Props {
  status: RagStatus;
  size?: 'sm' | 'md' | 'lg';
  dot?: boolean;
}

const COLOR: Record<RagStatus, string> = {
  Red: '#c0392b',
  Amber: '#d97706',
  Green: '#16a34a',
};

const BG: Record<RagStatus, string> = {
  Red: '#fef2f2',
  Amber: '#fffbeb',
  Green: '#f0fdf4',
};

const BORDER: Record<RagStatus, string> = {
  Red: '#fecaca',
  Amber: '#fde68a',
  Green: '#bbf7d0',
};

export function RagBadge({ status, size = 'md', dot = true }: Props) {
  const fontSize = size === 'sm' ? 11 : size === 'lg' ? 14 : 12;
  const padding = size === 'sm' ? '2px 7px' : size === 'lg' ? '5px 12px' : '3px 9px';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        background: BG[status],
        color: COLOR[status],
        border: `1px solid ${BORDER[status]}`,
        borderRadius: 20,
        fontWeight: 700,
        fontSize,
        padding,
        whiteSpace: 'nowrap',
      }}
    >
      {dot && (
        <span
          style={{
            width: size === 'lg' ? 9 : 7,
            height: size === 'lg' ? 9 : 7,
            borderRadius: '50%',
            background: COLOR[status],
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
      )}
      {status}
    </span>
  );
}
