import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { BackendGate } from './components/BackendGate';
import { AppRouter } from './router';
import './styles.css';
import { registerServiceWorker } from './registerServiceWorker';
import { loadTheme } from './theme';

loadTheme();
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRouter>
      <BackendGate>
        <App />
      </BackendGate>
    </AppRouter>
  </StrictMode>,
);
