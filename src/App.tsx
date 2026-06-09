import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageUp } from 'lucide-react';
import { ApplicationPanel, type ApplicationField } from './components/ApplicationPanel';
import { LabelPreview } from './components/LabelPreview';
import { MetricsBar } from './components/MetricsBar';
import { QueuePanel } from './components/QueuePanel';
import { ResultsPanel, type ResultsTab } from './components/ResultsPanel';
import { Toasts } from './components/Toasts';
import { TopBar } from './components/TopBar';
import { useLabelQueue } from './hooks/useLabelQueue';
import { downloadTextFile, findingsToCsv } from './lib/export';
import { summarizeFindings } from './lib/verification';
import type { ToastMessage } from './types';

const FIELD_LABELS: Record<string, string> = {
  brandName: 'brand name',
  classType: 'class/type',
  alcoholContent: 'alcohol content',
  proof: 'proof',
  netContents: 'net contents',
  producerAddress: 'producer/bottler statement',
  countryOfOrigin: 'country of origin',
  importerAddress: 'importer address'
};

function App() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastTimers = useRef<Map<string, number>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = toastTimers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      toastTimers.current.delete(id);
    }
  }, []);

  const notify = useCallback(
    (tone: ToastMessage['tone'], message: string) => {
      const id = crypto.randomUUID();
      setToasts((current) => [...current.slice(-3), { id, tone, message }]);
      toastTimers.current.set(
        id,
        window.setTimeout(() => dismissToast(id), 7000)
      );
    },
    [dismissToast]
  );

  useEffect(() => {
    const timers = toastTimers.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
    };
  }, []);

  const queue = useLabelQueue(notify);
  const [activeTab, setActiveTab] = useState<ResultsTab>('findings');
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);

  const { addFiles } = queue;
  const handleNewFiles = useCallback(
    (files: Iterable<File>) => {
      const { added, rejected } = addFiles(files);
      if (rejected.length) {
        notify('error', `Skipped ${rejected.length} file${rejected.length === 1 ? '' : 's'}: ${rejected.join(', ')}`);
      }
      if (added) {
        notify('info', `Added ${added} label${added === 1 ? '' : 's'} to the queue. Run OCR to extract text.`);
      }
    },
    [notify, addFiles]
  );

  // Clipboard paste: agents often screenshot labels from COLA submissions.
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest('textarea, input')) return; // let text fields paste text
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length) handleNewFiles(files);
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleNewFiles]);

  function onDragEnter(event: React.DragEvent) {
    event.preventDefault();
    if (!event.dataTransfer.types.includes('Files')) return;
    dragDepth.current += 1;
    setDragActive(true);
  }

  function onDragLeave(event: React.DragEvent) {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    if (event.dataTransfer.files.length) handleNewFiles(event.dataTransfer.files);
  }

  function handleExport() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(`label-verification-report-${stamp}.csv`, findingsToCsv(queue.records), 'text/csv;charset=utf-8');
    notify('success', 'Batch report downloaded as CSV.');
  }

  function handleSuggest() {
    if (!queue.selectedRecord) return;
    const filled = queue.applySuggestions(queue.selectedRecord.id);
    if (filled.length) {
      const names = filled.map((field) => FIELD_LABELS[field] ?? field).join(', ');
      notify('info', `Suggested ${names} from the label text — review before verifying.`);
    } else {
      notify('info', 'No suggestions: fields are already filled or nothing recognizable was found.');
    }
  }

  const selectedRecord = queue.selectedRecord;
  const selectedSummary = selectedRecord?.summary ?? summarizeFindings(selectedRecord?.findings ?? []);
  const canExport = queue.records.some((record) => record.findings.length > 0);

  return (
    <div
      className="app-shell"
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="gov-banner">
        <span className="gov-banner-flag" aria-hidden="true" />
        <span>
          An evaluation prototype in the style of official U.S. government systems — not an official website.
        </span>
      </div>

      <TopBar
        batchRunning={queue.batch !== null}
        batchProgress={queue.batch}
        canExport={canExport}
        onFiles={(files) => files && handleNewFiles(files)}
        onVerifyBatch={() => void queue.runBatch()}
        onStopBatch={queue.stopBatch}
        onExport={handleExport}
      />

      <MetricsBar records={queue.records} />

      <main className="workbench">
        <QueuePanel
          records={queue.records}
          selectedId={selectedRecord?.id ?? ''}
          onSelect={queue.select}
          onRemove={queue.removeRecord}
          onRestoreSamples={queue.restoreSamples}
        />

        {selectedRecord ? (
          <>
            <section className="center-column">
              <LabelPreview
                record={selectedRecord}
                summary={selectedSummary}
                onRunOcr={() => queue.runOcr(selectedRecord.id)}
              />
              <ResultsPanel
                record={selectedRecord}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                onTextChange={(value) => queue.updateExtractedText(selectedRecord.id, value)}
                onVerifyText={() => queue.verifyText(selectedRecord.id)}
              />
            </section>

            <ApplicationPanel
              record={selectedRecord}
              summary={selectedSummary}
              onFieldChange={(field: ApplicationField, value: string) =>
                queue.updateApplication(selectedRecord.id, field, value)
              }
              onSuggestFromLabel={handleSuggest}
            />
          </>
        ) : (
          <section className="center-column">
            <div className="empty-workbench">
              <ImageUp size={34} aria-hidden="true" />
              <h2>No labels in the queue</h2>
              <p>Upload label images, paste a screenshot, or restore the sample batch to get started.</p>
            </div>
          </section>
        )}
      </main>

      <footer className="identifier">
        <div className="identifier-identity">
          <strong>TTB Label Verification Console</strong>
          <span>Prototype for evaluation only — not an official TTB system.</span>
        </div>
        <span className="identifier-privacy">
          All processing runs in your browser; label images and application data never leave this device.
        </span>
      </footer>

      {dragActive ? (
        <div className="dropzone-overlay" aria-hidden="true">
          <div className="dropzone-card">
            <ImageUp size={30} />
            <strong>Drop label images to add them to the queue</strong>
          </div>
        </div>
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default App;
