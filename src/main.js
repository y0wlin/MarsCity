import './ui/styles.css';
import { App } from './app/App.js';

const container = document.getElementById('app');
const app = new App(container);
app.start().catch((e) => {
  console.error(e);
  const d = document.createElement('pre');
  d.style.cssText = 'position:fixed;inset:20px;color:#f88;font:12px monospace;white-space:pre-wrap';
  d.textContent = 'Start failed: ' + (e.stack || e);
  document.body.appendChild(d);
});
