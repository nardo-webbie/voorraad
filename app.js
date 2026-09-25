const LOCATIONS = ['Koelkast', 'Vriezer', 'Voorraadkast', 'Overig'];
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const state = { products: [], batches: [], loc: 'Alles', q: '' };

/* ---------- API ---------- */
async function api(path, body) {
  const opts = { headers: { 'x-app-pin': store.get('pin', '') } };
  if (body) {
    opts.method = 'POST';
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(path, opts);
  if (r.status === 401) {
    const pin = await askPin();
    if (pin == null) throw new Error('Geen toegang');
    store.set('pin', pin);
    return api(path, body);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Fout ${r.status}`);
  return j;
}

async function load() {
  try {
    const d = await api('/api/stock');
    state.products = d.products;
    state.batches = d.batches;
    render();
  } catch (e) {
    toast(e.message);
  }
}

/* ---------- Helpers ---------- */
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 2200);
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr + 'T00:00:00') - today) / 86400000);
}

function expiryPill(dateStr) {
  const d = daysUntil(dateStr);
  if (d == null) return '';
  const nice = new Date(dateStr + 'T00:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
  if (d < 0) return `<span class="pill bad">verlopen ${nice}</span>`;
  if (d === 0) return `<span class="pill bad">vandaag</span>`;
  if (d <= 3) return `<span class="pill warn">nog ${d} ${d === 1 ? 'dag' : 'dagen'}</span>`;
  return `<span class="pill ok">t/m ${nice}</span>`;
}

const thumb = (p) => p.image_url
  ? `<img class="thumb" src="${esc(p.image_url)}" alt="" loading="lazy">`
  : `<div class="thumb">🥫</div>`;

const shopItems = () => state.products.filter((p) => p.min_qty > 0 && Number(p.total) < p.min_qty);

/* ---------- Render ---------- */
function render() {
  // Filterchips
  $('#locFilter').innerHTML = ['Alles', ...LOCATIONS]
    .map((l) => `<button class="chip ${l === state.loc ? 'active' : ''}" data-loc="${l}">${l}</button>`).join('');

  // Meldingen houdbaarheid
  const expired = state.batches.filter((b) => b.expiry && daysUntil(b.expiry) < 0);
  const soon = state.batches.filter((b) => b.expiry && daysUntil(b.expiry) >= 0 && daysUntil(b.expiry) <= 3);
  $('#alerts').innerHTML =
    (expired.length ? `<div class="alert bad">⚠️ ${expired.length} ${expired.length === 1 ? 'partij is' : 'partijen zijn'} over de datum</div>` : '') +
    (soon.length ? `<div class="alert">⏰ ${soon.length} ${soon.length === 1 ? 'partij verloopt' : 'partijen verlopen'} binnen 3 dagen</div>` : '');

  // Voorraadlijst
  const q = state.q.toLowerCase();
  const items = state.products
    .map((p) => {
      const bs = state.batches.filter((b) => b.barcode === p.barcode && (state.loc === 'Alles' || b.location === state.loc));
      return { p, bs, total: bs.reduce((s, b) => s + Number(b.qty), 0) };
    })
    .filter(({ p, total }) => total > 0 && (!q || `${p.name} ${p.brand}`.toLowerCase().includes(q)));

  $('#stockList').innerHTML = items.length ? items.map(({ p, bs, total }) => `
    <div class="item">
      ${thumb(p)}
      <div data-edit="${esc(p.barcode)}">
        <div class="name">${esc(p.name)}</div>
        <div class="meta">${esc([p.brand, p.quantity].filter(Boolean).join(' · '))}</div>
      </div>
      <div class="count">${total}</div>
      <div class="batches">
        ${bs.map((b) => `
          <div class="batch">
            <div class="grow">${esc(b.location)} ${expiryPill(b.expiry)}</div>
            <button class="step" data-batch="${b.id}" data-bc="${esc(b.barcode)}" data-d="-1" aria-label="Eén minder">−</button>
            <b>${b.qty}</b>
            <button class="step" data-batch="${b.id}" data-bc="${esc(b.barcode)}" data-d="1" aria-label="Eén meer">+</button>
          </div>`).join('')}
      </div>
    </div>`).join('')
    : `<div class="empty">${state.products.length ? 'Niets gevonden.' : 'Nog geen voorraad.<br>Ga naar <b>Scannen</b> om te beginnen.'}</div>`;

  // Boodschappen
  const shop = shopItems();
  $('#shopList').innerHTML = shop.length ? shop.map((p) => `
    <div class="item">
      ${thumb(p)}
      <div data-edit="${esc(p.barcode)}">
        <div class="name">${esc(p.name)}</div>
        <div class="meta">nog ${p.total} van minimaal ${p.min_qty}</div>
      </div>
      <div class="count">+${p.min_qty - p.total}</div>
    </div>`).join('')
    : `<div class="empty">Alles op voorraad 👍<br><span class="small">Stel per product een minimum in via het product in je voorraad.</span></div>`;
  const badge = $('#shopBadge');
  badge.hidden = !shop.length;
  badge.textContent = shop.length;
}

/* ---------- Dialogen ---------- */
function askPin() {
  return new Promise((resolve) => {
    const dlg = $('#dlg');
    $('#dlgBody').innerHTML = `
      <h3>Pincode</h3>
      <p class="muted small">Deze voorraad is beveiligd.</p>
      <input id="pinIn" type="password" inputmode="numeric" autocomplete="current-password">
      <div class="actions"><button class="btn" value="ok">OK</button></div>`;
    dlg.onclose = () => resolve(dlg.returnValue === 'ok' ? $('#pinIn').value : null);
    dlg.showModal();
  });
}

function editProduct(barcode) {
  const p = state.products.find((x) => x.barcode === barcode);
  if (!p) return;
  const dlg = $('#dlg');
  $('#dlgBody').innerHTML = `
    <h3>Product bewerken</h3>
    <p class="muted small">Barcode ${esc(p.barcode)}</p>
    <label>Naam</label><input id="eName" value="${esc(p.name)}">
    <div class="grid2">
      <div><label>Merk</label><input id="eBrand" value="${esc(p.brand)}"></div>
      <div><label>Inhoud</label><input id="eQty" value="${esc(p.quantity)}"></div>
    </div>
    <label>Minimale voorraad (voor boodschappenlijst)</label>
    <input id="eMin" type="number" min="0" inputmode="numeric" value="${p.min_qty || 0}">
    <div class="actions">
      <button class="btn secondary" value="cancel">Annuleren</button>
      <button class="btn" value="save">Opslaan</button>
    </div>`;
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'save') return;
    try {
      await api('/api/products', {
        ...p, name: $('#eName').value, brand: $('#eBrand').value,
        quantity: $('#eQty').value, min_qty: $('#eMin').value,
      });
      toast('Opgeslagen');
      load();
    } catch (e) { toast(e.message); }
  };
  dlg.showModal();
}

/* ---------- Scanner ---------- */
const scanner = { stream: null, timer: null, controls: null, busy: false, last: '', lastAt: 0 };

async function startScan() {
  if (scanner.stream || scanner.controls) return;
  const video = $('#video');
  $('#scanHint').textContent = 'Richt de camera op een barcode';
  try {
    const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
    const native = 'BarcodeDetector' in window &&
      (await BarcodeDetector.getSupportedFormats()).includes('ean_13');

    if (native) {
      scanner.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
      });
      video.srcObject = scanner.stream;
      await video.play();
      const det = new BarcodeDetector({ formats });
      scanner.timer = setInterval(async () => {
        if (scanner.busy || video.readyState < 2) return;
        try {
          const codes = await det.detect(video);
          if (codes[0]) onCode(codes[0].rawValue);
        } catch {}
      }, 250);
    } else {
      // iPhone / browsers zonder BarcodeDetector: ZXing
      if (!window.ZXingBrowser) await loadScript('https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/umd/zxing-browser.min.js');
      const reader = new ZXingBrowser.BrowserMultiFormatReader();
      scanner.controls = await reader.decodeFromConstraints(
        { video: { facingMode: 'environment' }, audio: false }, video,
        (result) => { if (result && !scanner.busy) onCode(result.getText()); }
      );
    }
  } catch (e) {
    $('#scanHint').textContent = 'Camera niet beschikbaar — typ de barcode hieronder';
    console.error(e);
  }
}

function stopScan() {
  clearInterval(scanner.timer); scanner.timer = null;
  scanner.stream?.getTracks().forEach((t) => t.stop()); scanner.stream = null;
  scanner.controls?.stop(); scanner.controls = null;
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

function onCode(code) {
  code = String(code).trim();
  const now = Date.now();
  if (code === scanner.last && now - scanner.lastAt < 3000) return; // dubbele scans negeren
  scanner.last = code; scanner.lastAt = now;
  scanner.busy = true;
  navigator.vibrate?.(60);
  showProduct(code);
}

async function showProduct(barcode) {
  const box = $('#scanResult');
  box.innerHTML = `<div class="card muted">Zoeken naar ${esc(barcode)}…</div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  let res;
  try { res = await api(`/api/products?barcode=${encodeURIComponent(barcode)}`); }
  catch (e) { box.innerHTML = `<div class="card">${esc(e.message)}</div>`; scanner.busy = false; return; }

  const p = res.product;
  const known = res.found;
  const bs = state.batches.filter((b) => b.barcode === barcode);
  const total = bs.reduce((s, b) => s + Number(b.qty), 0);
  const lastLoc = store.get('lastLoc', 'Voorraadkast');
  let qty = 1;

  box.innerHTML = `
    <div class="card">
      ${known ? `
        <div class="product-head">
          ${thumb(p)}
          <div>
            <h2>${esc(p.name)}</h2>
            <div class="muted small">${esc([p.brand, p.quantity].filter(Boolean).join(' · '))}</div>
            <div class="small">Op voorraad: <b>${total}</b></div>
          </div>
        </div>` : `
        <h2 style="margin:0 0 4px;font-size:18px">Onbekend product</h2>
        <p class="muted small" style="margin:0">Barcode ${esc(barcode)} staat niet in Open Food Facts. Vul het één keer in, daarna wordt het herkend.</p>
        <label>Naam *</label><input id="nName" placeholder="bijv. Halfvolle melk">
        <div class="grid2">
          <div><label>Merk</label><input id="nBrand"></div>
          <div><label>Inhoud</label><input id="nQty" placeholder="1 L"></div>
        </div>`}
      <div class="grid2">
        <div><label>Locatie</label>
          <select id="sLoc">${LOCATIONS.map((l) => `<option ${l === lastLoc ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </div>
        <div><label>Houdbaar tot</label><input id="sExp" type="date"></div>
      </div>
      <div class="qty-row">
        <span class="muted">Aantal</span>
        <button class="step" id="qMin">−</button><span class="val" id="qVal">1</span><button class="step" id="qPlus">+</button>
      </div>
      <div class="actions">
        ${known && total ? `<button class="btn danger" id="bUse">Verbruiken</button>` : ''}
        <button class="btn" id="bAdd">Toevoegen</button>
      </div>
      <div class="actions"><button class="btn secondary" id="bNext">Volgende scannen</button></div>
    </div>`;

  const setQty = (n) => { qty = Math.max(1, n); $('#qVal').textContent = qty; };
  $('#qMin').onclick = () => setQty(qty - 1);
  $('#qPlus').onclick = () => setQty(qty + 1);
  $('#bNext').onclick = resetScan;

  $('#bAdd').onclick = async () => {
    try {
      if (!known) {
        const name = $('#nName').value.trim();
        if (!name) { toast('Vul een naam in'); return; }
        await api('/api/products', { barcode, name, brand: $('#nBrand').value, quantity: $('#nQty').value });
      }
      const location = $('#sLoc').value;
      store.set('lastLoc', location);
      await api('/api/stock', { barcode, delta: qty, location, expiry: $('#sExp').value });
      toast(`${qty}× toegevoegd`);
      await load();
      resetScan();
    } catch (e) { toast(e.message); }
  };
  const use = $('#bUse');
  if (use) use.onclick = async () => {
    try {
      await api('/api/stock', { barcode, delta: -Math.min(qty, total) });
      toast(`${Math.min(qty, total)}× verbruikt`);
      await load();
      resetScan();
    } catch (e) { toast(e.message); }
  };
}

function resetScan() {
  $('#scanResult').innerHTML = '';
  scanner.busy = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- Navigatie & events ---------- */
function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'scan') startScan(); else stopScan();
  store.set('view', name);
}

document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (b) showView(b.dataset.view);
});
$('#locFilter').addEventListener('click', (e) => {
  const c = e.target.closest('[data-loc]'); if (c) { state.loc = c.dataset.loc; render(); }
});
$('#search').addEventListener('input', (e) => { state.q = e.target.value; render(); });
$('#btnRefresh').addEventListener('click', load);
$('#manualForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('#manualCode').value.replace(/\D/g, '');
  if (code) { scanner.busy = true; showProduct(code); $('#manualCode').value = ''; }
});
document.addEventListener('click', async (e) => {
  const step = e.target.closest('[data-batch]');
  if (step) {
    step.disabled = true;
    try { await api('/api/stock', { barcode: step.dataset.bc, id: Number(step.dataset.batch), delta: Number(step.dataset.d) }); await load(); }
    catch (err) { toast(err.message); step.disabled = false; }
    return;
  }
  const ed = e.target.closest('[data-edit]');
  if (ed) editProduct(ed.dataset.edit);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopScan();
  else if ($('#view-scan').classList.contains('active')) startScan();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');

showView(store.get('view', 'stock') === 'scan' ? 'stock' : store.get('view', 'stock'));
load();
