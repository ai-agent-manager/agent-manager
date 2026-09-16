import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ApiClient, bootstrapToken } from './api/client.js';
import './styles/tokens.css';

// Strip the bootstrap secret before the application makes any network request.
const token = bootstrapToken(window.location, {
  getItem: (key) => window.sessionStorage.getItem(key),
  setItem: (key, value) => window.sessionStorage.setItem(key, value),
}, window.history);
const client = new ApiClient(token);
createRoot(document.getElementById('root')!).render(<StrictMode><App client={client} /></StrictMode>);
