import { useRef } from 'react';
import { Download, Loader2, Play, ShieldCheck, Square, Upload } from 'lucide-react';

interface TopBarProps {
  batchRunning: boolean;
  batchProgress: { done: number; total: number } | null;
  canExport: boolean;
  onFiles: (files: FileList | null) => void;
  onVerifyBatch: () => void;
  onStopBatch: () => void;
  onExport: () => void;
}

export function TopBar({
  batchRunning,
  batchProgress,
  canExport,
  onFiles,
  onVerifyBatch,
  onStopBatch,
  onExport
}: TopBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <header className="masthead">
      <div className="brand-cluster">
        <div className="brand-mark" aria-hidden="true">
          <ShieldCheck size={24} strokeWidth={1.8} />
        </div>
        <div className="brand-text">
          <p className="masthead-eyebrow">U.S. Department of the Treasury — Alcohol and Tobacco Tax and Trade Bureau</p>
          <h1>TTB Label Verification</h1>
        </div>
      </div>

      <div className="topbar-actions">
        <button className="ghost-button" type="button" onClick={onExport} disabled={!canExport}>
          <Download size={16} aria-hidden="true" />
          Export report
        </button>
        <button className="ghost-button" type="button" onClick={() => fileInputRef.current?.click()}>
          <Upload size={16} aria-hidden="true" />
          Upload labels
        </button>
        {batchRunning ? (
          <button className="primary-button" type="button" onClick={onStopBatch}>
            <Square size={14} aria-hidden="true" />
            Stop batch
            {batchProgress ? (
              <span className="batch-progress">
                {batchProgress.done}/{batchProgress.total}
              </span>
            ) : null}
          </button>
        ) : (
          <button className="primary-button" type="button" onClick={onVerifyBatch}>
            <Play size={16} aria-hidden="true" />
            Verify batch
          </button>
        )}
        {batchRunning ? <Loader2 className="spin topbar-spinner" size={18} aria-hidden="true" /> : null}
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept="image/*"
          multiple
          aria-label="Upload label images"
          onChange={(event) => {
            onFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>
    </header>
  );
}
