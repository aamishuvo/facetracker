/** Bootstrap: tab switching, toasts, and wiring up the two tools. */

import { initLive } from './live.js';
import { initClip } from './clip.js';

const toastEl = document.getElementById('toast');
let toastTimer = 0;

function toast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle('is-err', isError);
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), isError ? 6000 : 3200);
}

const backendPill = document.getElementById('backendPill');
function setBackend(name) {
  backendPill.textContent = `backend: ${name}`;
  backendPill.title = name === 'webgl'
    ? 'Running on your GPU via WebGL.'
    : 'Running on the CPU — WebGL was unavailable, so expect a low frame rate.';
}

// tabs
const tabs = [...document.querySelectorAll('.tab')];
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
      document.getElementById(t.getAttribute('aria-controls')).classList.toggle('is-active', on);
    });
  });
});

if (typeof faceapi === 'undefined') {
  toast('The face-api bundle failed to load. Was assets/js/vendor/ deployed?', true);
} else {
  initLive({ toast, setBackend });
  initClip({ toast, setBackend });
}

if (!window.isSecureContext) {
  document.getElementById('gateFoot').textContent =
    'This page is not on https:// — browsers will refuse camera access here.';
}
