// ==UserScript==
// @name         nCore Mass Torrent Downloader
// @namespace    bubi.torrent.auto
// @version      1.0.1
// @description  Automatikus tömeges torrent letöltő nCore keresési találatokhoz
// @author       Bubi
// @match        https://ncore.pro/torrents.php*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const SEL = {
    sor: 'div.box_torrent',
    cim: 'a[href^="torrents.php?action=details&id="]:not(.torrent)'
  };

  const OLDAL_LIMIT = 100;
  const ALAP = {
    max: 30,
    mode: 'normal',          // 'normal' | 'fast' | 'embertelen'
    veletlen: false,
    autoscroll: true,
    mute: false,
    volume: 70
  };
  const STORAGE_KEY = 'bubi_ncore_autodl_v100';

  const $  = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rnd = (a,b)=> Math.random()*(b-a)+a;
  const clamp = (v,a,b)=> Math.max(a, Math.min(b, v));
  const now = ()=> performance.now();
  const absUrl = rel => { try { return new URL(rel, location.origin).toString(); } catch { return rel; } };

  function loadSettings() {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? { ...ALAP, ...JSON.parse(raw) } : { ...ALAP }; }
    catch { return { ...ALAP }; }
  }
  function saveSettings() {
    const data = {
      max: parseInt($('#bubi_max').value||ALAP.max,10),
      mode: $('#bubi_mode').value,
      veletlen: $('#bubi_rand').checked,
      autoscroll: $('#bubi_autoscroll').checked,
      mute: $('#bubi_mute').checked,
      volume: parseInt($('#bubi_vol').value||ALAP.volume,10)
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  let fut = false, startTs = 0, errors = 0;
  const settings = loadSettings();

  // ===== HUD =====
  const panel = document.createElement('div');
  panel.style.cssText = `
    position: fixed; top: 80px; right: 20px; z-index: 2147483647;
    background: rgba(20,20,20,.95); color:#fff; padding:12px; border-radius:10px;
    font: 12px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    box-shadow: 0 8px 24px rgba(0,0,0,.35); width: 320px;`;
  panel.innerHTML = `
    <div style="font-weight:700;margin-bottom:6px">Automata letöltés</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <label>Max (≤ ${OLDAL_LIMIT})<br><input id="bubi_max" type="number" min="1" max="${OLDAL_LIMIT}" value="${clamp(settings.max,1,OLDAL_LIMIT)}" style="width:100%"></label>
      <label>Mód<br>
        <select id="bubi_mode" style="width:100%">
          <option value="normal">Normál</option>
          <option value="fast">Gyors</option>
          <option value="embertelen">Embertelen</option>
        </select>
      </label>
      <label>Véletlen sorrend<br><input id="bubi_rand" type="checkbox" ${settings.veletlen?'checked':''}></label>
      <label>Auto-scroll log<br><input id="bubi_autoscroll" type="checkbox" ${settings.autoscroll?'checked':''}></label>
    </div>
    <div style="margin-top:8px;display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center">
      <label>Hang (kész jelzés)<br><input id="bubi_vol" type="range" min="0" max="100" value="${clamp(settings.volume,0,100)}" style="width:100%"></label>
      <label style="white-space:nowrap;margin-top:16px"><input id="bubi_mute" type="checkbox" ${settings.mute?'checked':''}> Némít</label>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button id="bubi_start" style="flex:1;padding:8px 10px;border-radius:8px;border:0;cursor:pointer;background:#3aa757;color:#fff">Indítás</button>
      <button id="bubi_stop"  style="flex:1;padding:8px 10px;border-radius:8px;border:0;cursor:pointer;background:#8a1e1e;color:#fff">Leállítás</button>
    </div>
    <div id="bubi_status" style="margin-top:8px;opacity:.9">Állapot: várakozik</div>
    <div id="bubi_stats" style="margin-top:4px;opacity:.85"></div>
    <div id="bubi_log" style="margin-top:8px;max-height:200px;overflow:auto;padding:8px;border-radius:8px;background:rgba(255,255,255,.06);font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.45"></div>
  `;
  document.body.appendChild(panel);
  $('#bubi_mode').value = settings.mode;

  const logBox = $('#bubi_log');
  function log(msg) {
    const ts = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.textContent = `[${ts}] ${msg}`;
    logBox.appendChild(div);
    if ($('#bubi_autoscroll').checked) logBox.scrollTop = logBox.scrollHeight;
  }
  const setStatus = t => $('#bubi_status').textContent = `Állapot: ${t}`;
  function setStats(done,max,elapsedMs,errors){
    $('#bubi_stats').textContent =
      `Indítva: ${done}/${max} | Hibák: ${errors} | Futási idő: ${(elapsedMs/1000).toFixed(2)} mp`;
  }

  function ding() {
    if ($('#bubi_mute').checked) return;
    const vol = Math.max(0, Math.min(1, (parseInt($('#bubi_vol').value||settings.volume,10)/100))) * 0.2;
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type='sine'; o.frequency.value=880;
    o.connect(g); g.connect(ctx.destination);
    g.gain.value = vol;
    o.start(); g.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime+0.9);
    o.stop(ctx.currentTime+0.95);
  }

  function triggerDownload(url) {
    const frame = document.createElement('iframe');
    frame.style.display = 'none';
    frame.src = url;
    document.body.appendChild(frame);
    setTimeout(() => frame.remove(), 3000);
  }
  async function fetchDownloadUrl(detailsHref) {
    const url = absUrl(detailsHref);
    const html = await fetch(url, { credentials: 'same-origin' }).then(r => r.text());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let a = [...doc.querySelectorAll('a[href*="action=download"]')]
              .find(x => /torrent letöltése/i.test(x.textContent||''));
    if (!a) a = doc.querySelector('a[href*="action=download"]');
    return a ? absUrl(a.getAttribute('href')) : null;
  }

  // mentés
  ['bubi_max','bubi_mode','bubi_rand','bubi_autoscroll','bubi_mute','bubi_vol']
    .forEach(id => { $('#'+id).addEventListener('change', saveSettings); $('#'+id).addEventListener('input', saveSettings); });

  // futás
  $('#bubi_start').addEventListener('click', async () => {
    if (fut) return;
    fut = true; errors = 0; startTs = now();
    setStatus('fut'); log('Indítás');

    const max = clamp(parseInt($('#bubi_max').value||settings.max,10), 1, OLDAL_LIMIT);
    const sorok = $$(SEL.sor);
    if (!sorok.length) { alert('Nincs találat'); setStatus('nincs találat'); fut=false; return; }

    let rows = sorok.slice(0, Math.min(max, sorok.length));
    if ($('#bubi_rand').checked) rows = rows.sort(()=>Math.random()-0.5);

    // ——— mód beállítások
    const mode = $('#bubi_mode').value; // << FIX: definiálva
    let dmin = 7, dmax = 18, afterMs = 1500;
    if (mode === 'fast') { dmin = 0.3; dmax = 0.6; afterMs = 300; }
    if (mode === 'embertelen') { dmin = 0; dmax = 0; afterMs = 15; } // gyakorlatilag instant

    await sleep(200);

    let done=0;
    for (const row of rows) {
      if (!fut) break;
      try {
        const title = row.querySelector(SEL.cim);
        if (!title) { log('Nincs cím link'); errors++; continue; }

        const name = title.textContent.trim();
        const dlUrl = await fetchDownloadUrl(title.getAttribute('href'));

        if (dlUrl) { triggerDownload(dlUrl); log(`Indítva: ${name}`); done++; }
        else { log(`Nem találtam linket: ${name}`); errors++; }

        setStats(done, max, now()-startTs, errors);

        // mini technikai várakozás minden indítás után
        await sleep(afterMs);

        // Normál/Gyors módban emberi szünet, Embertelenben nulla
        if (mode !== 'embertelen') await sleep(rnd(dmin*1000, dmax*1000));

      } catch(e){
        console.error(e);
        log('Hiba, továbblépek');
        errors++;
        await sleep(100);
      }
    }

    fut=false; setStatus('kész'); setStats(done,max,now()-startTs,errors); ding();
    alert(`Kész. Indítva: ${done}/${max}, hibák: ${errors}`);
  });

  $('#bubi_stop').addEventListener('click', () => { fut=false; setStatus('leállítva'); log('Leállítva'); });

})();
