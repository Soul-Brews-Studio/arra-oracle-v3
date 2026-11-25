import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import { HubApp } from './HubApp';

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><HubApp /></StrictMode>);
