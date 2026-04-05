/* ═══════════════════════════════════════════════════════════
   MIJNWIJN — app.js
   Applicatielogica: login, filters, Google Drive, CRUD
   ═══════════════════════════════════════════════════════════ */

/* ── CONFIGURATIE ────────────────────────────────────────────
   Pas hier de Google Client ID aan als je een nieuwe aanmaakt
   ─────────────────────────────────────────────────────────── */
const CONFIG = {
  CLIENT_ID:     '1018551131120-rsrl1l068d1o0dtfj2p9spkkgsgafe2p.apps.googleusercontent.com',
  DRIVE_FILE:    'mijnwijn_data.json',
  DRIVE_SCOPE:   'https://www.googleapis.com/auth/drive.file',
};


/* ── STATE ───────────────────────────────────────────────────── */
let wines        = [];          // Actieve wijnlijst
let accessToken  = null;        // Google OAuth token
let driveFileId  = null;        // ID van het Drive bestand
let currentWijn  = null;        // Geselecteerde wijn (detail modal)
let formScore    = 0;           // Score in het formulier
let fSoort       = 'all';       // Actieve soortfilter
let fScores      = new Set();   // Actieve scorefilters (meerkeuze)


/* ══════════════════════════════════════════════════════════════
   GOOGLE LOGIN
   ══════════════════════════════════════════════════════════════ */

/**
 * Wordt aangeroepen door de Google Identity Services library
 * zodra de gebruiker succesvol inlogt.
 */
function handleCredentialResponse(response) {
  // Decodeer het JWT token om naam/email te lezen
  const payload = JSON.parse(atob(response.credential.split('.')[1]));
  document.getElementById('userName').textContent = payload.given_name || payload.email;

  // Toon de app, verberg het loginscherm
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display = '';

  // Haal een access token op voor Google Drive
  requestDriveToken();
}

/**
 * Vraag een OAuth access token aan voor Drive-toegang.
 */
function requestDriveToken() {
  const client = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope:     CONFIG.DRIVE_SCOPE,
    callback:  (tokenResponse) => {
      if (tokenResponse.error) {
        setDrive('err', 'Drive toegang geweigerd');
        return;
      }
      accessToken = tokenResponse.access_token;
      initApp();
    },
  });
  client.requestAccessToken({ prompt: '' });
}

/**
 * Start de app na succesvolle login en token.
 */
function initApp() {
  initDropdowns();
  syncDrive();
}

/**
 * Uitloggen: pagina herladen.
 */
function signOut() {
  google.accounts.id.disableAutoSelect();
  location.reload();
}

/**
 * Initialiseer de Google Sign-In knop zodra de pagina geladen is.
 */
window.addEventListener('load', () => {
  google.accounts.id.initialize({
    client_id: CONFIG.CLIENT_ID,
    callback:  handleCredentialResponse,
    auto_select: false,
  });
  google.accounts.id.renderButton(
    document.getElementById('googleSignInBtn'),
    { theme: 'filled_black', size: 'large', text: 'signin_with_google', locale: 'nl' }
  );
});


/* ══════════════════════════════════════════════════════════════
   GOOGLE DRIVE — opslaan en laden
   ══════════════════════════════════════════════════════════════ */

/**
 * Stuur een verzoek naar de Google Drive API.
 */
async function driveReq(path, opts = {}) {
  if (!accessToken) return null;
  const res = await fetch('https://www.googleapis.com/' + path, {
    ...opts,
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      ...(opts.headers || {}),
    },
  });
  return res.ok ? res : null;
}

/**
 * Stel de statusbalk in (ok / busy / fout).
 */
function setDrive(state, msg) {
  const dot = document.getElementById('driveDot');
  dot.className = 'dot' + (state === 'ok' ? ' ok' : state === 'busy' ? ' busy' : '');
  document.getElementById('driveLabel').textContent = msg;
}

/**
 * Synchroniseer met Google Drive:
 * - Bestand gevonden → laden
 * - Niet gevonden → huidige data uploaden
 */
async function syncDrive() {
  setDrive('busy', 'Synchroniseren…');
  try {
    const res = await driveReq(
      `drive/v3/files?q=name='${CONFIG.DRIVE_FILE}'+and+trashed=false&fields=files(id)`
    );
    if (!res) { setDrive('err', 'Geen toegang tot Drive'); return; }

    const { files } = await res.json();

    if (files.length > 0) {
      // Bestand gevonden → laden
      driveFileId = files[0].id;
      const dl = await driveReq(`drive/v3/files/${driveFileId}?alt=media`);
      if (dl) {
        wines = await dl.json();
        refreshDropdowns();
        renderList();
        renderStats();
        setDrive('ok', `Gesynchroniseerd — ${wines.length} wijnen`);
        toast('✓ Geladen vanuit Google Drive');
        return;
      }
    }

    // Geen bestand gevonden → maak nieuw aan met begindata
    wines = JSON.parse(JSON.stringify(INITIAL_DATA));
    await uploadDrive();
    refreshDropdowns();
    renderList();
    renderStats();

  } catch (e) {
    setDrive('err', 'Sync mislukt');
    console.error(e);
  }
}

/**
 * Upload de huidige wijnlijst naar Google Drive.
 */
async function uploadDrive() {
  const json     = JSON.stringify(wines);
  const meta     = JSON.stringify({ name: CONFIG.DRIVE_FILE, mimeType: 'application/json' });
  const boundary = 'mijnwijn_boundary';
  const body     = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;

  const method = driveFileId ? 'PATCH' : 'POST';
  const url    = driveFileId
    ? `upload/drive/v3/files/${driveFileId}?uploadType=multipart`
    : `upload/drive/v3/files?uploadType=multipart`;

  const res = await driveReq(url, {
    method,
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });

  if (res) {
    const f = await res.json();
    driveFileId = f.id;
    setDrive('ok', `Opgeslagen — ${wines.length} wijnen`);
  } else {
    setDrive('err', 'Opslaan mislukt');
  }
}

/**
 * Sla op na elke wijziging (als Drive verbonden is).
 */
function autoSave() {
  if (driveFileId) uploadDrive();
}


/* ══════════════════════════════════════════════════════════════
   DROPDOWNS INITIALISEREN
   ══════════════════════════════════════════════════════════════ */

function initDropdowns() {
  populateSelect('selWinkel', wines.map(w => w.winkel));
  populateSelect('selLand',   wines.map(w => w.land));
}

function refreshDropdowns() {
  resetSelect('selWinkel');
  resetSelect('selLand');
  populateSelect('selWinkel', wines.map(w => w.winkel));
  populateSelect('selLand',   wines.map(w => w.land));
}

function populateSelect(id, values) {
  const sel    = document.getElementById(id);
  const unique = [...new Set(values.filter(Boolean))].sort();
  unique.forEach(v => sel.add(new Option(v, v)));
}

function resetSelect(id) {
  const sel = document.getElementById(id);
  while (sel.options.length > 1) sel.remove(1);
}


/* ══════════════════════════════════════════════════════════════
   FILTERS & LIJST RENDEREN
   ══════════════════════════════════════════════════════════════ */

/** Soortfilter: single select chips */
function setChip(el) {
  document.querySelectorAll('[data-g="soort"]').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  fSoort = el.dataset.v;
  renderList();
}

/** Scorefilter: multi select chips */
function toggleScore(el) {
  const v = el.dataset.v;
  if (fScores.has(v)) { fScores.delete(v); el.classList.remove('on'); }
  else                { fScores.add(v);    el.classList.add('on'); }
  renderList();
}

/** Rendert de gefilterde en gesorteerde wijnlijst. */
function renderList() {
  const q        = document.getElementById('searchInput').value.toLowerCase();
  const sort     = document.getElementById('sortSel').value;
  const winkelF  = document.getElementById('selWinkel').value;
  const landF    = document.getElementById('selLand').value;

  let list = wines.filter(w => {
    if (fSoort !== 'all' && w.soort !== fSoort)   return false;
    if (fScores.size > 0 && !fScores.has(String(w.score))) return false;
    if (winkelF && w.winkel !== winkelF)           return false;
    if (landF   && w.land   !== landF)             return false;
    if (q) {
      const hay = [w.naam, w.producent, w.druif, w.land, w.regio, w.winkel, w.opmerkingen]
        .join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  list.sort((a, b) => {
    if (sort === 'score_desc') return (b.score||0) - (a.score||0);
    if (sort === 'score_asc')  return (a.score||0) - (b.score||0);
    if (sort === 'naam')       return (a.naam||'').localeCompare(b.naam||'');
    if (sort === 'datum_desc') return (b.datum||'').localeCompare(a.datum||'');
    if (sort === 'datum_asc')  return (a.datum||'').localeCompare(b.datum||'');
    return 0;
  });

  // Teller + actieve filters samenvatting
  document.getElementById('countTxt').textContent = `${list.length} wijnen`;
  const parts = [];
  if (fSoort !== 'all') parts.push(fSoort === 'Rose' ? 'Rosé' : fSoort);
  if (fScores.size > 0) parts.push([...fScores].map(s => s === '0' ? '☆' : '★'.repeat(+s)).join('/'));
  if (winkelF) parts.push(winkelF);
  if (landF)   parts.push(landF);
  document.getElementById('filterSummary').textContent = parts.join(' · ');

  // Render kaartjes
  const container = document.getElementById('wineList');
  if (!list.length) {
    container.innerHTML = '<div class="empty">🍷 Geen resultaten</div>';
    return;
  }

  container.innerHTML = list.map(w => {
    const dotC   = w.soort === 'Wit' ? 'dw' : w.soort === 'Rose' ? 'dro' : 'dr';
    const tagC   = w.soort === 'Wit' ? 'sw' : w.soort === 'Rose' ? 'sro' : 'sr';
    const soortL = w.soort === 'Rose' ? 'Rosé' : (w.soort || '');
    const stars  = w.score ? '★'.repeat(w.score) + '☆'.repeat(5 - w.score) : '☆☆☆☆☆';
    const starsC = w.score ? 'wstars' : 'wstars none';
    const druifS = w.druif ? w.druif.split(',')[0].trim() : '';
    const prijs  = w.prijs ? `€${w.prijs.toFixed(2)}` : '';
    const meta   = [w.land, w.jaar, druifS].filter(Boolean).join(' · ');

    return `<div class="wcard" onclick="openDetail('${w.id}')">
  <div class="wdot ${dotC}"></div>
  <div class="wbody">
    <div class="wrow1">
      <div class="wname">${escH(w.naam)}</div>
      <span class="wsoort ${tagC}">${soortL}</span>
    </div>
    <div class="wrow2">
      <span>${meta}</span>
      <span class="${starsC}">${stars}</span>
      ${prijs ? `<span class="wp">${prijs}</span>` : ''}
    </div>
  </div>
</div>`;
  }).join('');
}

/** HTML-tekens escapen om XSS te voorkomen */
function escH(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}


/* ══════════════════════════════════════════════════════════════
   DETAIL MODAL
   ══════════════════════════════════════════════════════════════ */

function openDetail(id) {
  currentWijn = wines.find(w => w.id === id);
  if (!currentWijn) return;
  const w = currentWijn;

  document.getElementById('m-naam').textContent  = w.naam;
  document.getElementById('m-stars').textContent = w.score
    ? '★'.repeat(w.score) + '☆'.repeat(5 - w.score)
    : '☆☆☆☆☆';
  document.getElementById('m-prod').textContent   = w.producent || '—';
  document.getElementById('m-soort').textContent  = w.soort === 'Rose' ? 'Rosé' : (w.soort || '—');
  document.getElementById('m-land').textContent   = w.land || '—';
  document.getElementById('m-jaar').textContent   = w.jaar || '—';
  document.getElementById('m-regio').textContent  = [w.regio, w.subregio].filter(Boolean).join(' › ') || '—';
  document.getElementById('m-druif').textContent  = w.druif || '—';
  document.getElementById('m-winkel').textContent = w.winkel || '—';

  const dp = [
    w.datum ? '📅 ' + w.datum : '',
    w.prijs ? '€' + w.prijs.toFixed(2) : '',
  ].filter(Boolean).join('  ');
  document.getElementById('m-dp').textContent = dp || '—';

  document.getElementById('m-opwrap').style.display = w.opmerkingen ? '' : 'none';
  document.getElementById('m-op').textContent = w.opmerkingen;

  document.getElementById('detailOv').classList.add('open');
}

function closeOv(e, id) {
  if (e.target.id === id) closeById(id);
}

function closeById(id) {
  document.getElementById(id).classList.remove('open');
}

function editWijn() {
  closeById('detailOv');
  openEditForm(currentWijn);
}

function deleteWijn() {
  if (!confirm(`"${currentWijn.naam}" verwijderen?`)) return;
  wines = wines.filter(w => w.id !== currentWijn.id);
  closeById('detailOv');
  refreshDropdowns();
  renderList();
  renderStats();
  autoSave();
  toast('🗑 Verwijderd');
}


/* ══════════════════════════════════════════════════════════════
   FORMULIER — toevoegen & bewerken
   ══════════════════════════════════════════════════════════════ */

function openAddForm() {
  document.getElementById('fTitle').textContent = 'Wijn toevoegen';
  document.getElementById('fId').value = '';
  ['fNaam','fProd','fRegio','fSubregio','fDruif','fWinkel','fOp'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('fJaar').value  = '';
  document.getElementById('fPrijs').value = '';
  document.getElementById('fSoort').value = 'Rood';
  document.getElementById('fLand').value  = '';
  document.getElementById('fDatum').value = new Date().toISOString().split('T')[0];
  formScore = 0;
  updateStars();
  document.getElementById('formOv').classList.add('open');
}

function openEditForm(w) {
  document.getElementById('fTitle').textContent    = 'Wijn bewerken';
  document.getElementById('fId').value             = w.id;
  document.getElementById('fNaam').value           = w.naam || '';
  document.getElementById('fProd').value           = w.producent || '';
  document.getElementById('fJaar').value           = w.jaar || '';
  document.getElementById('fSoort').value          = w.soort || 'Rood';
  document.getElementById('fLand').value           = w.land || '';
  document.getElementById('fRegio').value          = w.regio || '';
  document.getElementById('fSubregio').value       = w.subregio || '';
  document.getElementById('fDruif').value          = w.druif || '';
  document.getElementById('fWinkel').value         = w.winkel || '';
  document.getElementById('fPrijs').value          = w.prijs || '';
  document.getElementById('fDatum').value          = w.datum || '';
  document.getElementById('fOp').value             = w.opmerkingen || '';
  formScore = w.score || 0;
  updateStars();
  document.getElementById('formOv').classList.add('open');
}

function setScore(n) { formScore = n; updateStars(); }

function updateStars() {
  document.querySelectorAll('.sbtn').forEach((b, i) => {
    b.classList.toggle('lit', i > 0 && i <= formScore);
  });
}

function saveWijn() {
  const naam = document.getElementById('fNaam').value.trim();
  if (!naam) { alert('Wijnnaam is verplicht'); return; }

  const id = document.getElementById('fId').value;
  const w  = {
    id:          id || String(Date.now()),
    naam,
    producent:   document.getElementById('fProd').value.trim(),
    jaar:        parseInt(document.getElementById('fJaar').value) || null,
    soort:       document.getElementById('fSoort').value,
    land:        document.getElementById('fLand').value,
    regio:       document.getElementById('fRegio').value.trim(),
    subregio:    document.getElementById('fSubregio').value.trim(),
    druif:       document.getElementById('fDruif').value.trim(),
    winkel:      document.getElementById('fWinkel').value.trim(),
    prijs:       parseFloat(document.getElementById('fPrijs').value) || null,
    datum:       document.getElementById('fDatum').value,
    score:       formScore,
    opmerkingen: document.getElementById('fOp').value.trim(),
  };

  if (id) {
    const idx = wines.findIndex(x => x.id === id);
    if (idx >= 0) wines[idx] = w;
  } else {
    wines.unshift(w);
  }

  closeById('formOv');
  refreshDropdowns();
  renderList();
  renderStats();
  autoSave();
  toast(id ? '✓ Bijgewerkt' : '✓ Toegevoegd');
}


/* ══════════════════════════════════════════════════════════════
   STATISTIEKEN
   ══════════════════════════════════════════════════════════════ */

function renderStats() {
  const scored = wines.filter(w => w.score > 0);
  const avg    = scored.length
    ? (scored.reduce((s, w) => s + w.score, 0) / scored.length).toFixed(1)
    : '—';

  document.getElementById('s-tot').textContent   = wines.length;
  document.getElementById('s-avg').textContent   = avg;
  document.getElementById('s-5star').textContent = wines.filter(w => w.score === 5).length;

  // Hulpfunctie: tel unieke waarden
  const count = key => {
    const m = {};
    wines.forEach(w => { if (w[key]) m[w[key]] = (m[w[key]] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };

  // Balk-HTML genereren
  const bar = (entries, max = 10) => entries.slice(0, max).map(([k, v]) =>
    `<div class="srow">
      <span style="min-width:90px;font-size:11px">${escH(k)}</span>
      <div class="sbar-wrap"><div class="sbar" style="width:${Math.round(v / entries[0][1] * 100)}%"></div></div>
      <span class="sval">${v}</span>
    </div>`
  ).join('');

  document.getElementById('s-landen').innerHTML  = bar(count('land'));
  document.getElementById('s-winkels').innerHTML = bar(count('winkel'));

  // Soort met eigen kleur
  const soorten = count('soort');
  document.getElementById('s-soort').innerHTML = soorten.map(([k, v]) =>
    `<div class="srow">
      <span style="min-width:60px;font-size:11px">${k === 'Rose' ? 'Rosé' : k}</span>
      <div class="sbar-wrap">
        <div class="sbar" style="width:${Math.round(v / wines.length * 100)}%;background:${
          k === 'Wit' ? 'var(--wit-c)' : k === 'Rose' ? 'var(--rose-c)' : 'var(--rood-c)'
        }"></div>
      </div>
      <span class="sval">${v}</span>
    </div>`
  ).join('');

  // 5-sterren wijnen
  const top5 = wines.filter(w => w.score === 5);
  document.getElementById('s-top5').innerHTML = top5.length
    ? top5.map(w =>
        `<div class="srow" style="cursor:pointer" onclick="openDetail('${w.id}')">
          <span style="font-size:12px;flex:1">${escH(w.naam)}</span>
          <span style="font-size:11px;color:var(--muted)">${w.land || ''}</span>
        </div>`
      ).join('')
    : '<div style="color:var(--muted);font-size:12px;padding:6px 0">Nog geen 5-sterren wijnen</div>';
}


/* ══════════════════════════════════════════════════════════════
   TABS
   ══════════════════════════════════════════════════════════════ */

function switchTab(tab, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
  if (el) el.classList.add('on');
  document.getElementById('listView').style.display  = tab === 'list' ? '' : 'none';
  document.getElementById('statsView').classList.toggle('on', tab === 'stats');
  document.getElementById('fabBtn').style.display    = tab === 'list' ? '' : 'none';
}


/* ══════════════════════════════════════════════════════════════
   EXPORTEREN
   ══════════════════════════════════════════════════════════════ */

function exportCSV() {
  const cols = ['naam','producent','soort','land','regio','subregio','druif','jaar','winkel','datum','prijs','score','opmerkingen'];
  const rows = wines.map(w =>
    cols.map(c => `"${String(w[c] ?? '').replace(/"/g, '""')}"`).join(',')
  );
  const blob = new Blob(
    ['\uFEFF' + [cols.join(','), ...rows].join('\n')],
    { type: 'text/csv;charset=utf-8' }
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'MijnWijn.csv';
  a.click();
  toast('↓ CSV gedownload');
}


/* ══════════════════════════════════════════════════════════════
   TOAST MELDING
   ══════════════════════════════════════════════════════════════ */

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show';
  setTimeout(() => { t.className = 'toast'; }, 2800);
}
