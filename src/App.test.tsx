// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import App from './App';

// The real OCR engine needs web workers + WASM; component tests stub it.
// The small delay lets tests exercise the "already scanning" guards.
vi.mock('./lib/ocr/engine', () => ({
  recognizeLabelText: vi.fn(
    () =>
      new Promise((resolve) =>
        setTimeout(
          () => resolve({ text: 'MOCKED LABEL TEXT', confidence: 91, preprocessSteps: ['grayscale'] }),
          120
        )
      )
  ),
  terminateOcr: vi.fn(async () => {})
}));

describe('App', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders the seeded sample queue with statuses', () => {
    render(<App />);
    const queue = screen.getByRole('complementary', { name: 'Label queue' });
    expect(within(queue).getByText('OLD TOM DISTILLERY')).toBeInTheDocument();
    expect(within(queue).getByText('CANYON MESA RED')).toBeInTheDocument();
    // Sample 4 (title-case warning) and 5 (ABV mismatch) are seeded as issues.
    expect(within(queue).getAllByText('Issue').length).toBeGreaterThanOrEqual(2);
  });

  it('shows findings for the selected label and switches records', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /^NORTH COAST GIN/ }));
    const findingsPanel = screen.getByRole('tabpanel');
    expect(within(findingsPanel).getByText('Government warning')).toBeInTheDocument();
    expect(
      within(findingsPanel).getByText(/not in the required capital letters/i)
    ).toBeInTheDocument();
  });

  it('re-verifies edited text via the extracted text tab', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('tab', { name: 'Extracted text' }));
    const textarea = screen.getByRole('textbox', { name: 'Extracted label text' });
    await user.clear(textarea);
    await user.type(textarea, 'WRONG BRAND ENTIRELY');
    await user.click(screen.getByRole('button', { name: /Verify text/ }));

    await user.click(screen.getByRole('tab', { name: 'Findings' }));
    const findingsPanel = screen.getByRole('tabpanel');
    const brandRow = within(findingsPanel).getByText('Brand name').closest('tr');
    expect(brandRow).not.toBeNull();
    expect(within(brandRow as HTMLElement).getByText('Issue')).toBeInTheDocument();
  });

  it('removes a record from the queue', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /Remove CANYON MESA RED/ }));
    const queue = screen.getByRole('complementary', { name: 'Label queue' });
    expect(within(queue).queryByText('CANYON MESA RED')).not.toBeInTheDocument();
  });

  it('re-verifies live when application fields change (no stale findings)', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Old Tom starts as Pass; corrupting the brand must flip status without
    // any explicit "verify" click.
    const brandInput = screen.getByRole('textbox', { name: /Brand name/i });
    await user.clear(brandInput);
    await user.type(brandInput, 'COMPLETELY DIFFERENT BRAND');

    const queue = screen.getByRole('complementary', { name: 'Label queue' });
    const row = within(queue).getByText('COMPLETELY DIFFERENT BRAND').closest('li');
    expect(within(row as HTMLElement).getByText('Issue')).toBeInTheDocument();
  });

  it('counts labels already being scanned as skipped, not completed', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Run OCR' }));
    await user.click(screen.getByRole('button', { name: /Verify batch/ }));

    expect(await screen.findByText(/skipped — already being scanned/)).toBeInTheDocument();
    // Let the in-flight OCR finish inside the test to avoid act() leakage.
    expect(await screen.findByText('Verification complete')).toBeInTheDocument();
  });

  it('supports keyboard arrow navigation between tabs', async () => {
    const user = userEvent.setup();
    render(<App />);

    const findingsTab = screen.getByRole('tab', { name: 'Findings' });
    findingsTab.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Extracted text' })).toHaveAttribute('aria-selected', 'true');
  });
});
