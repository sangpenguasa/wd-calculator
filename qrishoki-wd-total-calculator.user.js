// ==UserScript==
// @name         QRISHOKI WD Total Calculator
// @namespace    qrishoki-wd-calc
// @version      2.0
// @match        https://linkpembayaran.online/bo/reports/withdraw*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/sangpenguasa/wd-calculator/main/qrishoki-wd-total-calculator.user.js
// @downloadURL  https://raw.githubusercontent.com/sangpenguasa/wd-calculator/main/qrishoki-wd-total-calculator.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const HOST_KEY = location.hostname + location.pathname;
  const NAME_KEY = `wdcalc_name_${HOST_KEY}`;
  const POS_KEY  = `wdcalc_pos_${HOST_KEY}`;
  const ROWPEND_KEY = `wdcalc_rowpending_${HOST_KEY}`;
  const AMTPEND_KEY = `wdcalc_amtpending_${HOST_KEY}`;
  const MINUS_KEY = `wdcalc_minus_${HOST_KEY}`;
  const MULTIPLIER = 1200;

  const UPDATE_URL = 'https://raw.githubusercontent.com/sangpenguasa/wd-calculator/main/qrishoki-wd-total-calculator.user.js';
  const CHECK_EVERY_MS = 30 * 60 * 1000;
  const cmpVer = (a, b) => {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  };
  function checkUpdate() {
    if (/GANTI_/.test(UPDATE_URL) || typeof GM_xmlhttpRequest !== 'function') return;
    GM_xmlhttpRequest({
      method: 'GET',
      url: UPDATE_URL + '?t=' + Date.now(),
      onload: (r) => {
        const m = /@version\s+([\d.]+)/.exec(r.responseText || '');
        const cur = (typeof GM_info !== 'undefined' && GM_info.script) ? GM_info.script.version : '0';
        const box = document.getElementById('wdcalc-update');
        if (!m || !box) return;
        if (cmpVer(m[1], cur) > 0) {
          box.textContent = `⬆ Update v${m[1]} tersedia — klik untuk update`;
          box.style.display = 'block';
        } else {
          box.style.display = 'none';
        }
      },
      onerror: () => {}
    });
  }

  let minusMode = GM_getValue(MINUS_KEY, true); // default: format minus

  const parseNumber = (str) => {
    if (!str) return 0;
    const cleaned = String(str).replace(/[^\d-]/g, '');
    const n = parseInt(cleaned, 10);
    return isNaN(n) ? 0 : n;
  };

  const fmt = (n) => n.toLocaleString('en-US');

  var panel = null;
  const isDataTable = (t) => !!t && /Transaction ID/i.test(t.textContent.slice(0, 3000));

  function getStatValue(label) {
    try {
      const want = label.toLowerCase();

      for (const t of document.querySelectorAll('table')) {
        if (isDataTable(t)) continue;
        const rows = Array.from(t.rows);
        for (let r = 0; r < rows.length - 1; r++) {
          const cells = Array.from(rows[r].cells);
          const idx = cells.findIndex(c => c.textContent.trim().toLowerCase() === want);
          if (idx < 0) continue;
          const c = rows[r + 1].cells[idx];
          if (c && /\d/.test(c.textContent)) return parseNumber(c.textContent);
        }
      }

      const candidates = document.querySelectorAll('div, span, th, td');
      for (const cell of candidates) {
        if (panel && panel.contains(cell)) continue;
        if (cell.textContent.trim().toLowerCase() !== want) continue;
        if (cell.children.length > 1) continue;
        if (isDataTable(cell.closest('table'))) continue;

        let sib = cell.nextElementSibling;
        while (sib) {
          const t = sib.textContent.trim();
          if (/\d/.test(t)) return parseNumber(t);
          sib = sib.nextElementSibling;
        }
        const parent = cell.parentElement;
        if (parent && parent.parentElement) {
          const idx = Array.from(parent.children).indexOf(cell);
          const rowParent = parent.parentElement;
          const rowIdx = Array.from(rowParent.children).indexOf(parent);
          const nextRow = rowParent.children[rowIdx + 1];
          if (nextRow && nextRow.children[idx]) {
            const t = nextRow.children[idx].textContent.trim();
            if (/\d/.test(t)) return parseNumber(t);
          }
        }
      }
      return null;
    } catch (e) {
      console.warn('[WDCalc] getStatValue error', label, e);
      return null;
    }
  }

  function getBalance() {
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      // 1) Teks "Balance" lalu cari "Rp xxx" di induk terdekat (pendek)
      while ((n = walker.nextNode())) {
        if (!/Balance/i.test(n.nodeValue)) continue;
        if (panel && panel.contains(n)) continue;
        let el = n.parentElement;
        for (let i = 0; i < 5 && el; i++, el = el.parentElement) {
          const t = el.textContent.replace(/\s+/g, ' ').trim();
          if (t.length > 90) break;
          const m = t.match(/Rp\.?\s*([\d.,]+)/i);
          if (m) return parseNumber(m[1]);
        }
      }
      // 2) Fallback: teks "Rp xxx" murni di area header atas
      const w2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while ((n = w2.nextNode())) {
        if (!/^\s*Rp\.?\s*[\d.,]+\s*$/i.test(n.nodeValue)) continue;
        const el = n.parentElement;
        if (!el || (panel && panel.contains(el))) continue;
        if (el.getBoundingClientRect().top < 110) {
          const m = n.nodeValue.match(/Rp\.?\s*([\d.,]+)/i);
          if (m) return parseNumber(m[1]);
        }
      }
      return null;
    } catch (e) {
      console.warn('[WDCalc] getBalance error', e);
      return null;
    }
  }

  const style = document.createElement('style');
  style.textContent = `
    #wdcalc-panel {
      position: fixed; z-index: 999999; width: 230px;
      background: #14141f; color: #fff; border: 1px solid #333;
      border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,.5);
      font-family: Arial, sans-serif; font-size: 13px; overflow: hidden;
      user-select: none;
    }
    #wdcalc-header {
      background: #1f1f30; padding: 8px 10px; cursor: move;
      display: flex; justify-content: center; align-items: center;
      position: relative;
      font-weight: bold; font-size: 13px; letter-spacing: .5px;
    }
    #wdcalc-header input {
      background: #14141f; border: 1px solid #3a3a50; color: #fff; font-weight: bold;
      font-size: 13px; width: 150px; outline: none; text-align: center;
      border-radius: 6px; padding: 4px 8px; box-sizing: border-box;
    }
    #wdcalc-header input:focus { border-color: #4ade80; }
    #wdcalc-update {
      display: none; background: #b45309; color: #fff; font-size: 11px; font-weight: bold;
      text-align: center; padding: 6px 8px; cursor: pointer;
    }
    #wdcalc-update:hover { background: #d97706; }
    #wdcalc-body { padding: 12px 10px; text-align: center; }
    #wdcalc-total {
      font-size: 20px; font-weight: bold; color: #4ade80; margin-bottom: 10px;
      word-break: break-all;
    }
    #wdcalc-breakdown { font-size: 11px; color: #999; line-height: 1.6; text-align: left; margin-bottom: 8px; }
    #wdcalc-breakdown span { color: #ddd; }
    #wdcalc-fields { display: flex; gap: 6px; margin-bottom: 8px; }
    .wdcalc-field { flex: 1; text-align: left; }
    .wdcalc-field label { display: block; font-size: 10px; color: #999; margin-bottom: 2px; }
    .wdcalc-field input {
      width: 100%; box-sizing: border-box; background: #1f1f30; border: 1px solid #3a3a50;
      border-radius: 6px; color: #fff; font-size: 12px; padding: 4px 6px; outline: none;
    }
    #wdcalc-footer { padding: 0 10px 10px; display: flex; gap: 6px; }
    #wdcalc-copy, #wdcalc-sign, #wdcalc-recalc {
      background: #2a2a3d; color: #fff; border: 1px solid #3a3a50;
      border-radius: 6px; padding: 6px 0; font-size: 12px; cursor: pointer;
    }
    #wdcalc-copy { flex: 1; }
    #wdcalc-sign, #wdcalc-recalc { width: 40px; font-weight: bold; }
    #wdcalc-copy:hover, #wdcalc-sign:hover, #wdcalc-recalc:hover { background: #3a3a50; }
    #wdcalc-copy.copied { background: #16803c; border-color: #16803c; }
    #wdcalc-sign.minus { background: #7f1d1d; border-color: #b91c1c; }
    #wdcalc-toggle {
      cursor: pointer; background: none; border: none; color: #999; font-size: 14px;
      position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
    }
  `;
  document.head.appendChild(style);

  panel = document.createElement('div');
  panel.id = 'wdcalc-panel';
  panel.innerHTML = `
    <div id="wdcalc-header">
      <input id="wdcalc-name" type="text" value="${GM_getValue(NAME_KEY, 'isinamawebmu')}" title="Klik untuk edit nama" />
      <button id="wdcalc-toggle">−</button>
    </div>
    <div id="wdcalc-content">
      <div id="wdcalc-update" title="Klik lalu pilih Install/Update di Tampermonkey"></div>
      <div id="wdcalc-body">
        <div id="wdcalc-total">-</div>
        <div id="wdcalc-breakdown">
          Total Row: <span id="wd-row">-</span><br>
          Total Amount: <span id="wd-amt">-</span><br>
          Balance: <span id="wd-bal">-</span>
        </div>
        <div id="wdcalc-fields">
          <div class="wdcalc-field">
            <label>Row Pending</label>
            <input id="wd-row-pending" type="text" inputmode="numeric" value="${GM_getValue(ROWPEND_KEY, '')}" />
          </div>
          <div class="wdcalc-field">
            <label>Amount Pending</label>
            <input id="wd-amt-pending" type="text" inputmode="numeric" value="${GM_getValue(AMTPEND_KEY, '')}" />
          </div>
        </div>
      </div>
      <div id="wdcalc-footer">
        <button id="wdcalc-copy">Copy</button>
        <button id="wdcalc-recalc" title="Klik Calculate Total & baca ulang">⟳</button>
        <button id="wdcalc-sign" title="Mode minus = kirim 5 nominal | Mode plus = nama + total">−</button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  const savedPos = GM_getValue(POS_KEY, { top: 100, left: window.innerWidth - 260 });
  panel.style.top = savedPos.top + 'px';
  panel.style.left = savedPos.left + 'px';

  const nameInput = panel.querySelector('#wdcalc-name');
  nameInput.addEventListener('change', () => GM_setValue(NAME_KEY, nameInput.value));

  const toggleBtn = panel.querySelector('#wdcalc-toggle');
  const content = panel.querySelector('#wdcalc-content');
  toggleBtn.addEventListener('click', () => {
    const hidden = content.style.display === 'none';
    content.style.display = hidden ? '' : 'none';
    toggleBtn.textContent = hidden ? '−' : '+';
  });

  const signBtn = panel.querySelector('#wdcalc-sign');
  function renderSignBtn() {
    signBtn.textContent = minusMode ? '−' : '+';
    signBtn.classList.toggle('minus', minusMode);
  }
  signBtn.addEventListener('click', () => {
    minusMode = !minusMode;
    GM_setValue(MINUS_KEY, minusMode);
    renderSignBtn();
    update();
  });
  renderSignBtn();

  (function makeDraggable() {
    const header = panel.querySelector('#wdcalc-header');
    let dragging = false, offX = 0, offY = 0;
    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
      dragging = true;
      offX = e.clientX - panel.offsetLeft;
      offY = e.clientY - panel.offsetTop;
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      panel.style.left = (e.clientX - offX) + 'px';
      panel.style.top = (e.clientY - offY) + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      GM_setValue(POS_KEY, { top: panel.offsetTop, left: panel.offsetLeft });
    });
  })();

  const rowPendingInput = panel.querySelector('#wd-row-pending');
  const amtPendingInput = panel.querySelector('#wd-amt-pending');
  rowPendingInput.addEventListener('input', () => { GM_setValue(ROWPEND_KEY, rowPendingInput.value); update(); });
  amtPendingInput.addEventListener('input', () => { GM_setValue(AMTPEND_KEY, amtPendingInput.value); update(); });

  let currentTotal = 0;
  let parts = { bal: 0, amt: 0, row: 0, amtPend: 0, rowPend: 0 };
  panel.querySelector('#wdcalc-copy').addEventListener('click', () => {
    const btn = panel.querySelector('#wdcalc-copy');
    const f = MULTIPLIER;
    const text = minusMode
      ? [
          fmt(parts.bal),
          fmt(parts.amt),
          fmt(parts.row * f),
          parts.amtPend ? fmt(parts.amtPend) : '',
          parts.rowPend ? fmt(parts.rowPend * f) : ''
        ].join('\n')
      : `${nameInput.value}\n${fmt(Math.abs(currentTotal))}`;
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text);
    } else {
      navigator.clipboard.writeText(text);
    }
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1200);
  });

  panel.querySelector('#wdcalc-recalc').addEventListener('click', () => {
    const b = Array.from(document.querySelectorAll('button')).find(x => /calculate total/i.test(x.textContent) && !panel.contains(x));
    if (b) b.click();
    update();
    setTimeout(update, 1500);
  });

  panel.querySelector('#wdcalc-update').addEventListener('click', () => {
    window.open(UPDATE_URL + '?t=' + Date.now(), '_blank');
  });

  function isWithdrawPage() {
    return /\/bo\/reports\/withdraw/i.test(location.pathname);
  }

  function syncVisibility() {
    panel.style.display = isWithdrawPage() ? '' : 'none';
  }

  (function hookHistory() {
    const _push = history.pushState;
    const _replace = history.replaceState;
    history.pushState = function (...args) {
      _push.apply(this, args);
      syncVisibility();
    };
    history.replaceState = function (...args) {
      _replace.apply(this, args);
      syncVisibility();
    };
    window.addEventListener('popstate', syncVisibility);
  })();

  syncVisibility();

  function update() {
    const rowAuto = getStatValue('Total Row');
    const amtAuto = getStatValue('Total Amount');
    const bal = getBalance();

    const rowOk = rowAuto !== null && rowAuto !== undefined;
    const amtOk = amtAuto !== null && amtAuto !== undefined;
    const balOk = bal !== null && bal !== undefined;

    const rowPending = parseNumber(rowPendingInput.value);
    const amtPending = parseNumber(amtPendingInput.value);

    const rowTotal = (rowAuto || 0) + rowPending;
    const amtTotal = (amtAuto || 0) + amtPending;

    parts = { bal: bal || 0, amt: amtAuto || 0, row: rowAuto || 0, amtPend: amtPending, rowPend: rowPending };
    const raw = (rowTotal * MULTIPLIER) + amtTotal + (bal || 0);
    currentTotal = minusMode ? -raw : raw;

    const totalEl = panel.querySelector('#wdcalc-total');
    totalEl.textContent = fmt(currentTotal);
    panel.querySelector('#wd-row').textContent = rowOk ? fmt(rowAuto) : 'N/A';
    panel.querySelector('#wd-amt').textContent = amtOk ? fmt(amtAuto) : 'N/A';
    panel.querySelector('#wd-bal').textContent = balOk ? fmt(bal) : 'N/A';

    totalEl.style.color = (rowOk && amtOk && balOk) ? (minusMode ? '#fb923c' : '#4ade80') : '#f87171';
  }

  update();
  let debounce;
  const observer = new MutationObserver((muts) => {
    if (muts.every(m => panel.contains(m.target))) return;
    clearTimeout(debounce);
    debounce = setTimeout(update, 500);
    syncVisibility();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  setInterval(update, 2000);
  checkUpdate();
  setInterval(checkUpdate, CHECK_EVERY_MS);

})();
