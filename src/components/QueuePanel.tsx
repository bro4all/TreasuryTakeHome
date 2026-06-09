import { RotateCcw, Trash2 } from 'lucide-react';
import type { LabelRecord } from '../types';
import { StatusBadge } from './StatusBadge';
import { statusFromQueue } from './statusMeta';

interface QueuePanelProps {
  records: LabelRecord[];
  selectedId: string;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onRestoreSamples: () => void;
}

export function QueuePanel({ records, selectedId, onSelect, onRemove, onRestoreSamples }: QueuePanelProps) {
  return (
    <aside className="queue-panel" aria-label="Label queue">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Batch queue</p>
          <h2>Applications</h2>
        </div>
        <span className="queue-count">{records.length}</span>
      </div>

      {records.length ? (
        <ul className="queue-list">
          {records.map((record) => (
            <li key={record.id} className="queue-row">
              <button
                className={record.id === selectedId ? 'queue-item active' : 'queue-item'}
                type="button"
                onClick={() => onSelect(record.id)}
                aria-current={record.id === selectedId ? 'true' : undefined}
              >
                <div className="queue-main">
                  <span className="queue-title">{record.application.brandName || record.fileName}</span>
                  <span className="queue-meta">
                    {record.applicationId} · {record.priority}
                  </span>
                </div>
                <StatusBadge status={record.summary?.status ?? statusFromQueue(record.ocrStatus)} compact />
              </button>
              <button
                className="queue-remove"
                type="button"
                aria-label={`Remove ${record.application.brandName || record.fileName} from queue`}
                title="Remove from queue"
                onClick={() => onRemove(record.id)}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="queue-empty">
          <p>The queue is empty.</p>
          <button className="secondary-button" type="button" onClick={onRestoreSamples}>
            <RotateCcw size={16} aria-hidden="true" />
            Restore sample batch
          </button>
        </div>
      )}
    </aside>
  );
}
