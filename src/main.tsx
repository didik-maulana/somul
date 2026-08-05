import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import { UpdateWindow } from '@/features/update/components/UpdateWindow';
import { startThemeSync } from '@/lib/theme';
import '@/styles/index.css';

// Before render, not inside a component: the panel opens over the desktop, and a light frame
// flashing before the dark theme lands is very visible against a dark wallpaper.
startThemeSync();

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root container #root is missing from index.html');
}

// Both windows load this same bundle; the query string is which one asked. Routing on it here
// rather than inside a component keeps the panel's tree free of a branch it can never take.
const isUpdateWindow = new URLSearchParams(window.location.search).get('view') === 'update';

createRoot(container).render(
  <StrictMode>{isUpdateWindow ? <UpdateWindow /> : <App />}</StrictMode>,
);
