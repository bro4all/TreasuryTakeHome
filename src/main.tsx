import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// Federal typefaces, self-hosted so no CDN request ever leaves the device:
// Public Sans is the USWDS interface face; Merriweather is its display serif.
import '@fontsource/public-sans/400.css';
import '@fontsource/public-sans/600.css';
import '@fontsource/public-sans/700.css';
import '@fontsource/public-sans/800.css';
import '@fontsource/merriweather/700.css';
import '@fontsource/merriweather/900.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
