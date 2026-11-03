/** Tiny DOM helpers: h() element builder, toast, confirm, formatting. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function toast(msg, kind = 'info', ms = 3200) {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div', { id: 'toasts' }); document.body.append(host); }
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
  while (host.children.length >= 3) host.firstElementChild.remove();
  host.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

export const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const fmtDate = (ts) => (ts ? new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never');
export const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }, text);
  document.body.append(ta); ta.select();
  const ok = document.execCommand && document.execCommand('copy');
  ta.remove();
  return !!ok;
}

export function downloadBlob(blob, filename) {
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

export const icons = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5zM6.5 4a.5.5 0 0 0-.5.5V17.3c.16-.03.33-.05.5-.05H18V4z"/></svg>',
  slides: '<svg viewBox="0 0 24 24"><path d="M3 4h18v12H3zm2 2v8h14V6zm6 11h2v2h3v2H8v-2h3z"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M11 3h2v9.6l3.3-3.3 1.4 1.4-5.7 5.7-5.7-5.7 1.4-1.4L11 12.6zM4 18h16v2H4z"/></svg>',
  sync: '<svg viewBox="0 0 24 24"><path d="M12 4a8 8 0 0 1 7.4 5H17v2h6V5h-2v2.3A10 10 0 0 0 2.1 11h2A8 8 0 0 1 12 4zm7.9 9a8 8 0 0 1-15.3 2H7v-2H1v6h2v-2.3A10 10 0 0 0 21.9 13z"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><path d="m19.4 13 2 1.2-2 3.5-2.3-.9a7 7 0 0 1-1.7 1l-.4 2.4H11l-.4-2.4a7 7 0 0 1-1.7-1l-2.3.9-2-3.5 2-1.2a7 7 0 0 1 0-2L4.6 9.8l2-3.5 2.3.9a7 7 0 0 1 1.7-1L11 3.8h4l.4 2.4a7 7 0 0 1 1.7 1l2.3-.9 2 3.5-2 1.2a7 7 0 0 1 0 2zM13 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M15.4 5.4 8.8 12l6.6 6.6-1.4 1.4-8-8 8-8z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="m8.6 5.4 6.6 6.6-6.6 6.6 1.4 1.4 8-8-8-8z"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 2 3 6.6 7 .8-5.2 4.9 1.4 7.1L12 18l-6.2 3.4 1.4-7.1L2 9.4l7-.8z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m9.5 16.2-3.7-3.7-1.4 1.4 5.1 5.1 11-11-1.4-1.4z"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1 1.4 1.4 1-1a3 3 0 0 1 4.2 4.2l-3 3a3 3 0 0 1-4.2 0zm4-2a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1-1.4-1.4-1 1a3 3 0 0 1-4.2-4.2l3-3a3 3 0 0 1 4.2 0z"/></svg>',
  qr: '<svg viewBox="0 0 24 24"><path d="M3 3h8v8H3zm2 2v4h4V5zm8-2h8v8h-8zm2 2v4h4V5zM3 13h8v8H3zm2 2v4h4v-4zm8-2h3v3h-3zm5 0h3v3h-3zm-5 5h3v3h-3zm5 0h3v3h-3z"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M9 3h6l1.5 2H20a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3.5zm3 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M18 16a3 3 0 0 0-2.2 1l-7-4a3 3 0 0 0 0-2l7-4A3 3 0 1 0 15 5l.1.6-7 4a3 3 0 1 0 0 4.8l7 4A3 3 0 1 0 18 16z"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2.4V17h16V7.4l-8 5.3zM18.7 7H5.3L12 11.4z"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><path d="M8 2h11a1 1 0 0 1 1 1v13h-2V4H8zM4 6h11a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm1 2v12h9V8z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4zM6 8h12l-1 13H7z"/></svg>',
  offline: '<svg viewBox="0 0 24 24"><path d="M12 3a7 7 0 0 1 6.9 5.8A4.5 4.5 0 0 1 18 18H7a5 5 0 0 1-1.2-9.9A7 7 0 0 1 12 3zm-1 6v4H8.5l3.5 3.5 3.5-3.5H13V9z"/></svg>',
};
export const icon = (name, cls = '') => h('span', { class: `icon ${cls}`, html: icons[name], 'aria-hidden': 'true' });
