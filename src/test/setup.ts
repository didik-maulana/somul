import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

/**
 * jsdom implements none of these, and Radix's slider and popover call all of them during layout.
 * Without the stubs every primitive-backed component throws before its first assertion.
 *
 * TypeScript already declares them on the DOM lib, so the assignments are unconditional rather
 * than `??=` — the types say they exist, and only the runtime disagrees.
 */
class ResizeObserverStub implements ResizeObserver {
  observe(): void {
    // jsdom has no layout engine, so there is never a resize to report.
  }

  unobserve(): void {
    // Intentionally empty.
  }

  disconnect(): void {
    // Intentionally empty.
  }
}

globalThis.ResizeObserver = ResizeObserverStub;

// Pointer capture and scrolling have no meaning without a compositor.
Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => undefined;
Element.prototype.releasePointerCapture = () => undefined;
Element.prototype.scrollIntoView = () => undefined;
