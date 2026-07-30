import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import { startThemeSync } from '@/lib/theme';
import '@/styles/index.css';

// Before render, not inside a component: the panel opens over the desktop, and a light frame
// flashing before the dark theme lands is very visible against a dark wallpaper.
startThemeSync();

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root container #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
