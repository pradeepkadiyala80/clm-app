import { useRef } from 'react';
import { Document, TrashCan, Upload } from '@carbon/icons-react';

interface Props {
  onFile: (file: File | null) => void;
  file: File | null;
  disabled?: boolean;
}

export function FileUpload({ onFile, file, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = (f: File | null) => {
    if (!f) return;
    const ok = f.name.endsWith('.docx') || f.name.endsWith('.pdf') || f.name.endsWith('.doc');
    if (!ok) { alert('Only .docx, .doc, or .pdf files are supported.'); return; }
    onFile(f);
  };

  return (
    <div>
      <span className="clm-section-label">Contract File</span>

      {file ? (
        <div className="clm-file-attached">
          <Document size={16} />
          <span className="clm-file-name">{file.name}</span>
          <span className="clm-file-size">{(file.size / 1024).toFixed(0)} KB</span>
          {!disabled && (
            <button
              onClick={() => onFile(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: 'inherit' }}
              title="Remove file"
              aria-label="Remove file"
            >
              <TrashCan size={16} />
            </button>
          )}
        </div>
      ) : (
        <div
          className="clm-drop-zone"
          onClick={() => !disabled && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('dragging'); }}
          onDragLeave={(e) => e.currentTarget.classList.remove('dragging')}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('dragging');
            handle(e.dataTransfer.files[0] ?? null);
          }}
          role="button"
          tabIndex={disabled ? -1 : 0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); !disabled && inputRef.current?.click(); } }}
          aria-disabled={disabled}
        >
          <div className="clm-drop-icon">
            <Upload size={24} />
          </div>
          <p className="clm-drop-label">
            Drop file here or <span>browse</span>
          </p>
          <p className="clm-drop-hint">.docx · .doc · .pdf</p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".docx,.doc,.pdf"
        style={{ display: 'none' }}
        onChange={(e) => handle(e.target.files?.[0] ?? null)}
        disabled={disabled}
      />
    </div>
  );
}
