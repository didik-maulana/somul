import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PeakMeter } from '@/features/mixer/components/PeakMeter';
import { publishPeaks, resetMeterEngine } from '@/features/mixer/lib/meterEngine';
import type { SessionId } from '@/types/ipc';

const SESSION_ID = 'mock:session:spotify' as SessionId;

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });

afterEach(() => {
  resetMeterEngine();
});

describe('PeakMeter', () => {
  it('opens at silence rather than at an invented level', () => {
    render(<PeakMeter sessionId={SESSION_ID} />);

    expect(screen.getByTestId('peak-readout')).toHaveTextContent('−∞ dB');
  });

  it('paints a published peak without a re-render', async () => {
    const { container } = render(<PeakMeter sessionId={SESSION_ID} />);

    publishPeaks([{ sessionId: SESSION_ID, peak: 0.5 }]);
    await nextFrame();

    expect(screen.getByTestId('peak-readout')).toHaveTextContent('−6 dB');

    const fill = container.querySelector<HTMLElement>('[class*="origin-left"]');

    expect(fill?.style.transform).toMatch(/^scaleX\(0\.8/);
    expect(fill?.style.opacity).toBe('1');
  });

  it('ignores peaks addressed to another session', async () => {
    render(<PeakMeter sessionId={SESSION_ID} />);

    publishPeaks([{ sessionId: 'mock:session:chrome' as SessionId, peak: 0.9 }]);
    await nextFrame();

    expect(screen.getByTestId('peak-readout')).toHaveTextContent('−∞ dB');
  });
});
