import QRCode from 'qrcode';
import { h, icon, toast, copyText, downloadBlob, fmtDate, fmtBytes } from '../lib/ui.js';
import { getState, replaceState, logSync, pref, setPref } from '../lib/store.js';
import { encodeState, decodeState, mergeState, splitForQr, createChunkCollector } from '../lib/sync.js';
import { isNative, shareText } from '../lib/native.js';

export async function render(root) {
  const st = getState();
  const deviceName = h('input', { type: 'text', value: pref('deviceName', defaultDeviceName()), placeholder: 'Name this device, e.g. Phone', onchange: (e) => setPref('deviceName', e.target.value.trim()) });

  // ---------------- export
  const codeBox = h('textarea', { class: 'code', readonly: true, placeholder: 'Press "Create sync code" to generate the code for this device.' });
  const info = h('div', { class: 'muted small' });
  const qrHost = h('div');
  let code = '';
  const generate = () => {
    code = encodeState(getState(), pref('deviceName', ''));
    codeBox.value = code;
    info.textContent = `${code.length} characters (${fmtBytes(code.length)}). Contains notes, written answers and attempts, bookmarks, studied marks, reading position and your slide links. Not your PDFs or API key.`;
    exportBtns.querySelectorAll('button').forEach((b) => (b.disabled = false));
    qrHost.replaceChildren();
    logSync({ kind: 'export', device: pref('deviceName', '') });
  };
  const emailBtn = h('button', { class: 'btn', disabled: true, onclick: () => {
    const subject = encodeURIComponent(`Medical Tome sync code from ${pref('deviceName', 'my device')}`);
    const body = encodeURIComponent(`Open Mae's Medical Tome → Sync → Import and paste the whole block below.\n\n${code}\n`);
    const href = `mailto:?subject=${subject}&body=${body}`;
    if (href.length > 1800) { toast('This code is too long for an e-mail link. Use "Save as file" and attach it, or Copy and paste it into the e-mail body.', 'error', 6000); return; }
    location.href = href;
  } }, icon('mail'), 'E-mail');
  const exportBtns = h('div', { class: 'row' },
    h('button', { class: 'btn primary', onclick: generate }, icon('sync'), 'Create sync code'),
    h('button', { class: 'btn', disabled: true, onclick: async () => toast((await copyText(code)) ? 'Code copied. Paste it into an e-mail or message to yourself.' : 'Copy failed. Select the text and copy it manually.', 'ok') }, icon('copy'), 'Copy'),
    (navigator.share || isNative()) ? h('button', { class: 'btn', disabled: true, onclick: () => (isNative() ? shareText('Medical Tome sync code', code) : navigator.share({ title: 'Medical Tome sync code', text: code })).catch(() => {}) }, icon('share'), 'Share…') : null,
    emailBtn,
    h('button', { class: 'btn', disabled: true, onclick: () => downloadBlob(new Blob([code], { type: 'text/plain' }), `medical-tome-sync-${new Date().toISOString().slice(0, 10)}.mmt.txt`) }, icon('download'), 'Save as file'),
    h('button', { class: 'btn', disabled: true, onclick: () => showQr(qrHost, code) }, icon('qr'), 'Show QR'));

  const exportCard = h('div', { class: 'card' }, h('h2', {}, '1. Export from this device'),
    h('p', { class: 'small muted' }, 'No account, no server. The code is a compressed copy of your study data. Send it to your other device any way you like.'),
    h('label', { class: 'small' }, 'This device is called'), deviceName,
    h('div', { style: { height: '.6rem' } }), exportBtns, h('div', { style: { height: '.6rem' } }), codeBox, info, qrHost);

  // ---------------- import
  const pasteBox = h('textarea', { class: 'code', placeholder: 'Paste a sync code here (MMT1.…). Line breaks and extra text around it are fine.' });
  const preview = h('div');
  const fileIn = h('input', { type: 'file', accept: '.txt,.mmt,text/plain', style: { display: 'none' }, onchange: async (e) => { const f = e.target.files[0]; if (f) { pasteBox.value = await f.text(); doPreview(); } } });
  const scanHost = h('div');
  const doPreview = () => {
    preview.replaceChildren();
    let incoming;
    try { incoming = decodeState(pasteBox.value); } catch (e) { preview.append(h('p', { class: 'notice warn' }, e.message)); return; }
    const { merged, summary } = mergeState(getState(), incoming);
    const names = { notes: 'notes', bookmarks: 'bookmarks', studied: 'studied marks', progress: 'positions', userLinks: 'slide links', practice: 'written answers' };
    preview.append(
      h('p', { class: 'small' }, `From ${incoming.device || 'another device'}, exported ${fmtDate(incoming.at)}.`),
      h('div', { class: 'diff' }, h('div', {}, h('b', {}, String(summary.added)), 'new'), h('div', {}, h('b', {}, String(summary.updated)), 'newer than mine'), h('div', {}, h('b', {}, String(summary.kept)), 'mine is newer')),
      h('p', { class: 'muted small' }, Object.entries(summary.byCollection).map(([k, v]) => `${names[k]}: +${v.added} ↑${v.updated}`).join(' · ')),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: async () => {
          await replaceState({ ...getState(), ...merged });
          logSync({ kind: 'import', device: incoming.device, added: summary.added, updated: summary.updated });
          toast(`Imported: ${summary.added} new, ${summary.updated} updated.`, 'ok', 4000);
          pasteBox.value = ''; preview.replaceChildren(); drawLog();
        } }, icon('check'), 'Merge into this device'),
        h('span', { class: 'muted small' }, 'Newer entries win, per item. Nothing is deleted.')));
  };
  const importCard = h('div', { class: 'card' }, h('h2', {}, '2. Import on the other device'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => fileIn.click() }, icon('download'), 'Open file'), fileIn,
      navigator.mediaDevices?.getUserMedia ? h('button', { class: 'btn', onclick: () => startScan(scanHost, (c) => { pasteBox.value = c; doPreview(); }) }, icon('camera'), 'Scan QR') : null,
      navigator.clipboard?.readText ? h('button', { class: 'btn', onclick: async () => { try { pasteBox.value = await navigator.clipboard.readText(); doPreview(); } catch { toast('Clipboard access was refused. Paste manually.', 'error'); } } }, icon('copy'), 'Paste from clipboard') : null),
    h('div', { style: { height: '.6rem' } }), scanHost, pasteBox,
    h('div', { class: 'row', style: { marginTop: '.5rem' } }, h('button', { class: 'btn', onclick: doPreview }, 'Preview changes')),
    preview);

  // ---------------- log
  const logCard = h('div', { class: 'card' }, h('h3', {}, 'Recent syncs'), h('div', { id: 'synclog' }));
  const drawLog = () => {
    const log = getState().syncLog || [];
    logCard.querySelector('#synclog').replaceChildren(log.length ? h('ul', { class: 'small' }, ...log.map((l) => h('li', {}, `${fmtDate(l.at)} · ${l.kind === 'export' ? 'exported code' : `imported from ${l.device || 'another device'} (+${l.added}, ↑${l.updated})`}`))) : h('p', { class: 'muted small' }, 'Nothing yet.'));
  };
  drawLog();

  root.replaceChildren(h('h1', {}, 'Sync between phone and computer'),
    h('div', { class: 'notice small', style: { marginBottom: '1rem' } }, 'Workflow: on the device you just studied on, create a code and send it to yourself (e-mail, chat, QR or file). On the other device, paste or scan it and merge. Do it in both directions whenever you switch devices.'),
    exportCard, importCard, logCard);
  return () => stopScan();
}

function defaultDeviceName() {
  const ua = navigator.userAgent;
  if (/HarmonyOS|HUAWEI|HMSCore/i.test(ua)) return 'Huawei phone';
  if (/Android/i.test(ua)) return 'Android phone';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/iPhone|iPad/i.test(ua)) return 'iPhone';
  if (/Mac/i.test(ua)) return 'Mac';
  return 'This device';
}

async function showQr(host, code) {
  const chunks = splitForQr(code, 1000);
  let i = 0;
  const canvas = h('canvas');
  const label = h('div', { class: 'small', style: { color: '#333' } });
  const draw = async () => {
    await QRCode.toCanvas(canvas, chunks[i], { errorCorrectionLevel: 'L', width: Math.min(360, window.innerWidth - 80), margin: 1 });
    label.textContent = chunks.length > 1 ? `QR ${i + 1} of ${chunks.length}: scan each one in any order` : 'Scan with the other device: Sync → Scan QR';
  };
  const nav = chunks.length > 1 ? h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => { i = (i - 1 + chunks.length) % chunks.length; draw(); } }, icon('prev')), h('button', { class: 'btn sm', onclick: () => { i = (i + 1) % chunks.length; draw(); } }, icon('next'))) : null;
  host.replaceChildren(h('div', { class: 'qr-wrap' }, canvas, label, nav));
  await draw();
}

let stream = null, scanTimer = null;
function stopScan() { if (scanTimer) cancelAnimationFrame(scanTimer); scanTimer = null; stream?.getTracks().forEach((t) => t.stop()); stream = null; }
async function startScan(host, onCode) {
  stopScan();
  const video = h('video', { class: 'scan', playsinline: true, muted: true, autoplay: true });
  const status = h('div', { class: 'small muted' }, 'Point the camera at the QR code…');
  host.replaceChildren(video, status, h('div', { class: 'row', style: { margin: '.4rem 0' } }, h('button', { class: 'btn sm', onclick: () => { stopScan(); host.replaceChildren(); } }, 'Stop camera')));
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); } catch (e) { host.replaceChildren(h('p', { class: 'notice warn' }, `Camera not available: ${e.message}. Paste the code instead.`)); return; }
  video.srcObject = stream;
  await video.play();
  const collector = createChunkCollector();
  const detector = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
  let jsQR = null;
  if (!detector) jsQR = (await import('jsqr')).default;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let last = '';
  const tick = async () => {
    if (!stream) return;
    if (video.readyState >= 2) {
      let text = null;
      try {
        if (detector) { const codes = await detector.detect(video); text = codes[0]?.rawValue || null; }
        else { canvas.width = video.videoWidth; canvas.height = video.videoHeight; ctx.drawImage(video, 0, 0); const img = ctx.getImageData(0, 0, canvas.width, canvas.height); text = jsQR(img.data, img.width, img.height)?.data || null; }
      } catch {}
      if (text && text !== last) {
        last = text;
        try {
          const s = collector.add(text);
          if (s.done) { stopScan(); host.replaceChildren(); onCode(s.code); toast('QR code read', 'ok'); return; }
          status.textContent = `Got ${s.have} of ${s.total}. Still needed: ${s.missing.join(', ')}`;
        } catch (e) { status.textContent = e.message; }
      }
    }
    scanTimer = requestAnimationFrame(tick);
  };
  tick();
}
