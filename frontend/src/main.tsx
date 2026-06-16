import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { BackendGate } from './components/BackendGate';
import './styles.css';
import { registerServiceWorker } from './registerServiceWorker';
import { loadTheme } from './theme';

loadTheme();
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BackendGate>
      <App />
    </BackendGate>
  </StrictMode>,
);
