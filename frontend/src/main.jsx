import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { configError } from './runtimeConfig.js';
import Guest from './pages/Guest.jsx';
import Manager from './pages/Manager.jsx';
import './styles.css';

// A missing or invalid /config.js stops here with a visible message instead of
// a menu that silently fails to load.
function ConfigError({ message }) {
  return (
    <div style={{ padding: 24, maxWidth: 560, margin: '40px auto', fontFamily: 'sans-serif', lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 20 }}>Menu is temporarily unavailable</h1>
      <p>The site's runtime configuration (<code>/config.js</code>) is missing or invalid.</p>
      <pre style={{ whiteSpace: 'pre-wrap', background: '#f4f4f4', padding: 12 }}>{message}</pre>
    </div>
  );
}

if (configError) console.error('[config] ' + configError);

createRoot(document.getElementById('root')).render(
  configError ? <ConfigError message={configError} /> : (
    <React.StrictMode>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Guest />} />
          <Route path="/manager" element={<Manager />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </React.StrictMode>
  )
);
