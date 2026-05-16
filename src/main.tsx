/**
 * @file main.tsx
 * @description The main entry point for the React application.
 * Initializes the React root and renders the App component within StrictMode.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
