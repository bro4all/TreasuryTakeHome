import { useRef } from 'react';
import { ClipboardCheck, Eye, FileText } from 'lucide-react';
import type { LabelRecord } from '../types';
import { FindingsTable } from './FindingsTable';

export type ResultsTab = 'findings' | 'text';

interface ResultsPanelProps {
  record: LabelRecord;
  activeTab: ResultsTab;
  onTabChange: (tab: ResultsTab) => void;
  onTextChange: (value: string) => void;
  onVerifyText: () => void;
}

const TABS: Array<{ id: ResultsTab; label: string; icon: typeof ClipboardCheck }> = [
  { id: 'findings', label: 'Findings', icon: ClipboardCheck },
  { id: 'text', label: 'Extracted text', icon: FileText }
];

export function ResultsPanel({ record, activeTab, onTabChange, onTextChange, onVerifyText }: ResultsPanelProps) {
  const tabRefs = useRef<Partial<Record<ResultsTab, HTMLButtonElement | null>>>({});
  const scanning = record.ocrStatus === 'scanning';

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const currentIndex = TABS.findIndex((tab) => tab.id === activeTab);
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const next = TABS[(currentIndex + offset + TABS.length) % TABS.length];
    onTabChange(next.id);
    tabRefs.current[next.id]?.focus();
  }

  return (
    <section className="results-panel" aria-label="Verification findings">
      <div className="results-header">
        <div className="tab-list" role="tablist" aria-label="Result views">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              ref={(element) => {
                tabRefs.current[id] = element;
              }}
              id={`tab-${id}`}
              className={activeTab === id ? 'tab active' : 'tab'}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              aria-controls={`tabpanel-${id}`}
              tabIndex={activeTab === id ? 0 : -1}
              onClick={() => onTabChange(id)}
              onKeyDown={handleTabKeyDown}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>

        <button
          className="secondary-button"
          type="button"
          onClick={onVerifyText}
          disabled={scanning}
          title={scanning ? 'OCR is running — wait for it to finish' : undefined}
        >
          <Eye size={16} aria-hidden="true" />
          Verify text
        </button>
      </div>

      {activeTab === 'findings' ? (
        <div id="tabpanel-findings" role="tabpanel" aria-labelledby="tab-findings">
          <FindingsTable findings={record.findings} />
        </div>
      ) : (
        <div id="tabpanel-text" role="tabpanel" aria-labelledby="tab-text">
          <textarea
            className="ocr-textarea"
            value={record.ocrText}
            onChange={(event) => onTextChange(event.target.value)}
            aria-label="Extracted label text"
            placeholder="Run OCR on the label image, or paste the label text here when the photo is unreadable."
            spellCheck={false}
            disabled={scanning}
            title={scanning ? 'OCR is running — its result will replace this text' : undefined}
          />
        </div>
      )}
    </section>
  );
}
