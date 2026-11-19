import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ApiClient, bootstrapToken } from './api/client.js';
import './styles/tokens.css';

// Strip the launch code from the address bar and exchange it before the application makes any other request.
void bootstrapToken(window.location, {
  getItem: (key) => window.sessionStorage.getItem(key),
  setItem: (key, value) => window.sessionStorage.setItem(key, value),
}, window.history).then((token) => {
  createRoot(document.getElementById('root')!).render(<StrictMode><App client={new ApiClient(token)} /></StrictMode>);
});
