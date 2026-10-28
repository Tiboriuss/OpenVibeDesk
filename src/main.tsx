import React from 'react';
import { createRoot } from 'react-dom/client';
import { NativeApp } from './NativeApp';
import './styles.css';
import './unified.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><NativeApp /></React.StrictMode>);
