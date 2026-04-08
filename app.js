/**
 * app.js — Lógica principal Bitácora Digital Construrike v3 (Fixed)
 */

const app = {
  isOnline: navigator.onLine,
  isAdmin: false,
  currentPhotos: [],
  currentGPS: null,
  formTimestamp: null,
  cameraStream: null,
  config: { obra: '', residente: '' },
  records: [],
  syncInProgress: false
};

// ═══════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════

async function initApp() {
  try {
    await localDB.open();
    initSupabase();
    setupEventListeners();
    setupConnectivity();
    updateOnlineIndicator();

    const pinHash = await localDB.getConfig('pinHash');
    if (!pinHash) {
      showScreen('screen-setup');
    } else {
      showScreen('screen-login');
    }
    console.log('[APP] Inicializada');
  } catch (err) {
    console.error('[APP] Error init:', err);
    showToast('Error al inicializar', 'error');
  }
}

// ═══════════════════════════════════════════════════════════
// PANTALLAS
// ═══════════════════════════════════════════════════════════

function showScreen(id) {
  document.querySelectorAll('.app-screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

async function enterApp() {
  await loadConfig();
  updateOnlineIndicator();
  await updatePendingBadge();
  await loadRecords();
  showScreen('screen-main');
  updateModeUI();

  if (navigator.onLine && app.isAdmin) {
    setTimeout(() => syncToCloud(), 2000);
  }
}

function updateModeUI() {
  document.querySelectorAll('.admin-only').forEach(el => {
    if (app.isAdmin) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });

  const vb = document.getElementById('viewer-banner');
  if (app.isAdmin) {
    vb.classList.add('hidden');
  } else {
    vb.classList.remove('hidden');
  }
}

// ═══════════════════════════════════════════════════════════
// MODALES — usar clase .active
// ═══════════════════════════════════════════════════════════

function openModal(id) {
  document.getElementById(id).classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  document.body.style.overflow = '';
  if (id === 'modal-record-form') stopCameraStream();
}

// ═══════════════════════════════════════════════════════════
// PIN — SETUP & LOGIN
// ═══════════════════════════════════════════════════════════

async function setupPin() {
  const pin = document.getElementById('setup-pin').value.trim();
  const confirm = document.getElementById('setup-pin-confirm').value.trim();
  const error = document.getElementById('setup-error');

  if (pin.length < 4) {
    error.textContent = 'El PIN debe tener al menos 4 dígitos';
    error.classList.remove('hidden');
    return;
  }
  if (pin !== confirm) {
    error.textContent = 'Los PINs no coinciden';
    error.classList.remove('hidden');
    return;
  }

  try {
    const hash = await hashPin(pin);
    await localDB.setConfig('pinHash', hash);
    if (cloud.isAvailable()) await cloud.setConfig('pinHash', hash);

    error.classList.add('hidden');
    app.isAdmin = true;
    showToast('PIN configurado correctamente', 'success');
    await enterApp();
  } catch (err) {
    error.textContent = 'Error al guardar PIN';
    error.classList.remove('hidden');
  }
}

async function loginWithPin() {
  const pin = document.getElementById('login-pin').value.trim();
  const error = document.getElementById('login-error');

  if (!pin) {
    error.textContent = 'Ingresa el PIN';
    error.classList.remove('hidden');
    return;
  }

  try {
    const storedHash = await localDB.getConfig('pinHash');
    const inputHash = await hashPin(pin);

    if (inputHash === storedHash) {
      error.classList.add('hidden');
      app.isAdmin = true;
      showToast('Acceso administrativo', 'success');
      await enterApp();
    } else {
      error.textContent = 'PIN incorrecto';
      error.classList.remove('hidden');
      document.getElementById('login-pin').value = '';
    }
  } catch (err) {
    error.textContent = 'Error de verificación';
    error.classList.remove('hidden');
  }
}

async function enterAsViewer() {
  app.isAdmin = false;
  showToast('Modo solo lectura', 'info');
  await enterApp();
}

// ═══════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════

async function loadConfig() {
  try {
    let obra = null, residente = null;
    if (cloud.isAvailable()) {
      obra = await cloud.getConfig('obra');
      residente = await cloud.getConfig('residente');
    }
    if (!obra) obra = await localDB.getConfig('obra');
    if (!residente) residente = await localDB.getConfig('residente');
    app.config.obra = obra || '';
    app.config.residente = residente || '';
    updateConfigBanner();
  } catch (err) {
    console.warn('[APP] Error cargando config:', err);
  }
}

function updateConfigBanner() {
  const bo = document.getElementById('banner-obra');
  const br = document.getElementById('banner-residente');
  if (app.config.obra) {
    bo.textContent = app.config.obra;
    br.textContent = app.config.residente || '';
  } else {
    bo.textContent = 'Sin obra configurada';
    br.textContent = '';
  }
}

function openConfig() {
  document.getElementById('config-obra').value = app.config.obra;
  document.getElementById('config-residente').value = app.config.residente;
  openModal('modal-config');
}

async function saveConfig() {
  try {
    const obra = document.getElementById('config-obra').value.trim();
    const residente = document.getElementById('config-residente').value.trim();
    await localDB.setConfig('obra', obra);
    await localDB.setConfig('residente', residente);
    if (cloud.isAvailable()) {
      await cloud.setConfig('obra', obra);
      await cloud.setConfig('residente', residente);
    }
    app.config.obra = obra;
    app.config.residente = residente;
    updateConfigBanner();
    closeModal('modal-config');
    showToast('Configuración guardada', 'success');
  } catch (err) {
    showToast('Error al guardar', 'error');
  }
}

// ═══════════════════════════════════════════════════════════
// FORMULARIO — NUEVO REGISTRO
// ═══════════════════════════════════════════════════════════

function openNewRecordForm() {
  if (!app.config.obra) {
    showToast('Configura la obra primero', 'warning');
    openConfig();
    return;
  }

  app.currentPhotos = [];
  app.currentGPS = null;
  app.formTimestamp = new Date().toISOString();

  document.getElementById('photos-strip').innerHTML = '';
  updatePhotoCount();
  document.getElementById('field-description').value = '';
  document.getElementById('field-volumenes').value = '';
  document.getElementById('field-personal').value = '';
  document.getElementById('field-maquinaria').value = '';
  document.getElementById('field-tipo').value = 'Normal';
  document.getElementById('field-clima').value = 'Bueno';
  document.getElementById('field-conectividad').value = app.isOnline ? 'Buena' : 'Sin señal';

  const counter = document.getElementById('desc-counter');
  counter.textContent = '0/20 mín.';
  counter.className = 'field-hint';

  document.getElementById('display-timestamp').textContent = formatDateTime(new Date(app.formTimestamp));
  getGPS();
  document.getElementById('btn-save-record').disabled = true;

  openModal('modal-record-form');
}

// ═══════════════════════════════════════════════════════════
// CÁMARA — MÚLTIPLES FOTOS
// ═══════════════════════════════════════════════════════════

async function capturePhoto() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Cámara no soportada', 'error');
    return;
  }

  const btn = document.getElementById('btn-take-photo');
  btn.disabled = true;
  btn.textContent = '⏳ Abriendo cámara...';

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } }
    });
    app.cameraStream = stream;

    const video = document.createElement('video');
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.setAttribute('autoplay', '');
    await new Promise(r => { video.onloadedmetadata = () => { video.play(); r(); }; });
    await new Promise(r => setTimeout(r, 400));

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    app.currentPhotos.push(canvas.toDataURL('image/jpeg', 0.7));
    stopCameraStream();

    renderPhotoStrip();
    validateForm();
    showToast('Foto ' + app.currentPhotos.length + ' capturada', 'success');
  } catch (err) {
    stopCameraStream();
    if (err.name === 'NotAllowedError') {
      showToast('Permiso de cámara denegado', 'error');
    } else {
      showToast('Error al acceder a la cámara', 'error');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = '📷 Tomar Foto';
  }
}

function stopCameraStream() {
  if (app.cameraStream) {
    app.cameraStream.getTracks().forEach(t => t.stop());
    app.cameraStream = null;
  }
}

function renderPhotoStrip() {
  const strip = document.getElementById('photos-strip');
  strip.innerHTML = app.currentPhotos.map((photo, i) =>
    '<div class="photo-thumb-wrap">' +
      '<img src="' + photo + '" alt="Foto ' + (i+1) + '">' +
      '<button type="button" class="photo-remove" onclick="removePhoto(' + i + ')">✕</button>' +
      '<span class="photo-num">' + (i+1) + '</span>' +
    '</div>'
  ).join('');
  updatePhotoCount();
}

function removePhoto(index) {
  app.currentPhotos.splice(index, 1);
  renderPhotoStrip();
  validateForm();
}

function updatePhotoCount() {
  const el = document.getElementById('photo-count');
  const n = app.currentPhotos.length;
  el.textContent = n === 0 ? 'Sin fotos' : n + ' foto' + (n > 1 ? 's' : '');
  el.className = n > 0 ? 'photo-count has-photos' : 'photo-count';
}

// ═══════════════════════════════════════════════════════════
// GPS
// ═══════════════════════════════════════════════════════════

function getGPS() {
  const display = document.getElementById('display-gps');
  const status = document.getElementById('gps-status');

  if (!navigator.geolocation) {
    display.textContent = 'No soportado';
    status.textContent = '❌ No disponible';
    status.className = 'field-hint';
    return;
  }

  display.textContent = 'Obteniendo...';
  status.textContent = '⏳ Localizando...';
  status.className = 'field-hint warning animate-pulse';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      app.currentGPS = {
        lat: parseFloat(pos.coords.latitude.toFixed(6)),
        lng: parseFloat(pos.coords.longitude.toFixed(6))
      };
      display.textContent = app.currentGPS.lat + ', ' + app.currentGPS.lng;
      status.textContent = '✅ Obtenido';
      status.className = 'field-hint valid';
      validateForm();
    },
    (err) => {
      app.currentGPS = null;
      display.textContent = 'Error';
      status.className = 'field-hint';
      if (err.code === err.PERMISSION_DENIED) {
        status.textContent = '❌ Permiso denegado';
        showToast('Activa ubicación en configuración', 'error');
      } else if (err.code === err.POSITION_UNAVAILABLE) {
        status.textContent = '❌ No disponible';
      } else {
        status.textContent = '❌ Tiempo agotado';
      }
      validateForm();
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
  );
}

// ═══════════════════════════════════════════════════════════
// VALIDACIÓN
// ═══════════════════════════════════════════════════════════

function validateForm() {
  const desc = document.getElementById('field-description').value.trim();
  const counter = document.getElementById('desc-counter');
  counter.textContent = desc.length + '/20 mín.';
  counter.className = desc.length >= 20 ? 'field-hint valid' : 'field-hint warning';

  const valid = app.currentPhotos.length > 0 && app.currentGPS !== null && desc.length >= 20;
  document.getElementById('btn-save-record').disabled = !valid;
  return valid;
}

// ═══════════════════════════════════════════════════════════
// GUARDAR REGISTRO
// ═══════════════════════════════════════════════════════════

async function saveRecord() {
  if (!validateForm()) return;

  const btn = document.getElementById('btn-save-record');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando...';

  try {
    const record = {
      timestamp: app.formTimestamp,
      photos: [...app.currentPhotos],
      photoUrls: [],
      gps: { ...app.currentGPS },
      obra: app.config.obra,
      residente: app.config.residente,
      description: document.getElementById('field-description').value.trim(),
      clima: document.getElementById('field-clima').value,
      conectividad: document.getElementById('field-conectividad').value,
      personal: parseInt(document.getElementById('field-personal').value) || null,
      volumenes: parseFloat(document.getElementById('field-volumenes').value) || null,
      maquinaria: document.getElementById('field-maquinaria').value.trim() || null,
      tipo: document.getElementById('field-tipo').value,
      synced: false,
      cloudId: null
    };

    const localId = await localDB.addRecord(record);

    if (cloud.isAvailable()) {
      try {
        const photoUrls = await cloud.uploadPhotos(record.photos, record.timestamp);
        const cloudId = await cloud.saveRecord(record, photoUrls);
        if (cloudId) {
          await localDB.updateRecord(localId, { synced: true, cloudId: cloudId, photoUrls: photoUrls });
        }
      } catch (syncErr) {
        console.warn('[APP] Sync inmediata falló:', syncErr);
      }
    }

    closeModal('modal-record-form');
    await loadRecords();
    await updatePendingBadge();
    showToast('Registro guardado', 'success');
  } catch (err) {
    console.error('[APP] Error guardando:', err);
    showToast('Error al guardar', 'error');
  } finally {
    btn.textContent = '✅ Guardar Registro';
    btn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════
// SYNC
// ═══════════════════════════════════════════════════════════

async function syncToCloud() {
  if (app.syncInProgress || !cloud.isAvailable()) return;
  app.syncInProgress = true;
  try {
    const synced = await cloud.syncPending(localDB);
    if (synced > 0) {
      showToast(synced + ' registro' + (synced > 1 ? 's' : '') + ' sincronizado' + (synced > 1 ? 's' : ''), 'success');
      await loadRecords();
      await updatePendingBadge();
    }
  } catch (err) {
    console.error('[APP] Sync error:', err);
  } finally {
    app.syncInProgress = false;
  }
}

// ═══════════════════════════════════════════════════════════
// CARGAR REGISTROS
// ═══════════════════════════════════════════════════════════

async function loadRecords() {
  try {
    let records = await localDB.getAllRecords();

    if (cloud.isAvailable()) {
      try {
        const cloudRecords = await cloud.fetchAllRecords();
        const localCloudIds = new Set(records.filter(r => r.cloudId).map(r => r.cloudId));
        for (const cr of cloudRecords) {
          if (!localCloudIds.has(cr.cloudId)) records.push(cr);
        }
      } catch (_) {}
    }

    records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    app.records = records;

    let filtered = [...records];

    const filterDate = document.getElementById('filter-date').value;
    if (filterDate) filtered = filtered.filter(r => r.timestamp.startsWith(filterDate));

    const search = document.getElementById('filter-search').value.trim().toLowerCase();
    if (search) {
      filtered = filtered.filter(r =>
        r.description.toLowerCase().includes(search) ||
        r.tipo.toLowerCase().includes(search) ||
        (r.maquinaria && r.maquinaria.toLowerCase().includes(search))
      );
    }

    document.getElementById('record-count').textContent = filtered.length + ' registro' + (filtered.length !== 1 ? 's' : '');

    const container = document.getElementById('records-list');
    const empty = document.getElementById('empty-state');

    if (filtered.length === 0) {
      container.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');
    container.innerHTML = filtered.map(r => renderCard(r)).join('');

    container.querySelectorAll('[data-local-id]').forEach(card => {
      card.addEventListener('click', () => {
        const localId = card.dataset.localId ? parseInt(card.dataset.localId) : null;
        const cloudId = card.dataset.cloudId ? parseInt(card.dataset.cloudId) : null;
        openDetail(localId, cloudId);
      });
    });
  } catch (err) {
    console.error('[APP] Error cargando registros:', err);
  }
}

function renderCard(r) {
  const date = formatDateTime(new Date(r.timestamp));
  const desc = r.description.length > 65 ? r.description.substring(0, 65) + '…' : r.description;
  const photoSrc = getFirstPhoto(r);
  const photoCount = getPhotoCount(r);
  const climaIcons = { 'Bueno': '☀️', 'Moderado': '⛅', 'Malo': '🌧️' };

  const tipoClass = { 'Normal': 'tipo-normal', 'Incidencia': 'tipo-incidencia', 'Hito': 'tipo-hito' }[r.tipo] || 'tipo-normal';
  const statusClass = r.synced ? 'status-synced' : 'status-pending';
  const statusText = r.synced ? '☁️ Sincronizado' : '💾 Local';

  return '<div data-local-id="' + (r.localId || '') + '" data-cloud-id="' + (r.cloudId || '') + '" class="record-card">' +
    '<div class="record-thumb">' +
      (photoSrc
        ? '<img src="' + photoSrc + '" alt="Foto" loading="lazy">'
        : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:24px;color:#475569">📷</div>') +
      (photoCount > 1 ? '<span class="photo-badge">' + photoCount + '</span>' : '') +
    '</div>' +
    '<div class="record-info">' +
      '<div class="record-header">' +
        '<span class="record-date">' + date + '</span>' +
        '<span class="tipo-badge ' + tipoClass + '">' + r.tipo + '</span>' +
      '</div>' +
      '<p class="record-desc">' + escapeHTML(desc) + '</p>' +
      '<div class="record-meta">' +
        '<span class="record-meta-item">' + (climaIcons[r.clima] || '') + ' ' + (r.clima || '') + '</span>' +
        (r.personal ? '<span class="record-meta-item">👷 ' + r.personal + '</span>' : '') +
        '<span class="status-badge ' + statusClass + '">' + statusText + '</span>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function getFirstPhoto(r) {
  if (r.photoUrls && r.photoUrls.length > 0) return r.photoUrls[0];
  if (r.photos && r.photos.length > 0) return r.photos[0];
  return null;
}

function getPhotoCount(r) {
  if (r.photoUrls && r.photoUrls.length > 0) return r.photoUrls.length;
  if (r.photos && r.photos.length > 0) return r.photos.length;
  return 0;
}

// ═══════════════════════════════════════════════════════════
// DETALLE
// ═══════════════════════════════════════════════════════════

async function openDetail(localId, cloudId) {
  let record = null;
  if (localId) record = await localDB.getRecord(localId);
  if (!record && cloudId) record = app.records.find(r => r.cloudId === cloudId);
  if (!record) return;

  const date = new Date(record.timestamp);
  const mapsUrl = 'https://maps.google.com/?q=' + record.gps.lat + ',' + record.gps.lng;

  const photos = (record.photoUrls && record.photoUrls.length > 0) ? record.photoUrls : (record.photos || []);
  const gallery = document.getElementById('detail-gallery');
  if (photos.length > 0) {
    gallery.innerHTML = photos.map((src, i) =>
      '<img src="' + src + '" alt="Foto ' + (i+1) + '" class="detail-photo" loading="lazy">'
    ).join('');
  } else {
    gallery.innerHTML = '<div style="width:100%;height:180px;background:#1e293b;border-radius:14px;display:flex;align-items:center;justify-content:center;color:#475569;font-size:16px;">Sin fotos</div>';
  }

  document.getElementById('detail-timestamp').textContent = formatDateTime(date);
  document.getElementById('detail-gps').innerHTML = '<a href="' + mapsUrl + '" target="_blank" rel="noopener" style="color:#60a5fa">' + record.gps.lat + ', ' + record.gps.lng + ' ↗</a>';
  document.getElementById('detail-obra').textContent = record.obra || '—';
  document.getElementById('detail-residente').textContent = record.residente || '—';
  document.getElementById('detail-description').textContent = record.description;
  document.getElementById('detail-clima').textContent = record.clima || '—';
  document.getElementById('detail-conectividad').textContent = record.conectividad || '—';
  document.getElementById('detail-personal').textContent = record.personal != null ? record.personal + ' personas' : '—';
  document.getElementById('detail-volumenes').textContent = record.volumenes != null ? record.volumenes + ' m³' : '—';
  document.getElementById('detail-maquinaria').textContent = record.maquinaria || '—';
  document.getElementById('detail-tipo').textContent = record.tipo;
  document.getElementById('detail-sync').innerHTML = record.synced
    ? '<span style="color:#6ee7b7">☁️ Sincronizado</span>'
    : '<span style="color:#fcd34d">💾 Guardado localmente</span>';

  openModal('modal-detail');
}

// ═══════════════════════════════════════════════════════════
// EXPORTAR CSV
// ═══════════════════════════════════════════════════════════

async function exportToCSV() {
  const records = app.records;
  if (records.length === 0) { showToast('No hay registros', 'warning'); return; }

  const headers = ['ID','Fecha','Latitud','Longitud','Obra','Residente','Descripción','Clima','Conectividad','Personal','Volúmenes_m3','Maquinaria','Tipo','Fotos','Estado'];
  const rows = records.map(r => [
    r.cloudId || r.localId || '',
    r.timestamp,
    r.gps.lat, r.gps.lng,
    '"' + (r.obra || '').replace(/"/g, '""') + '"',
    '"' + (r.residente || '').replace(/"/g, '""') + '"',
    '"' + r.description.replace(/"/g, '""') + '"',
    r.clima || '', r.conectividad || '',
    r.personal || '', r.volumenes || '',
    '"' + (r.maquinaria || '').replace(/"/g, '""') + '"',
    r.tipo, getPhotoCount(r),
    r.synced ? 'Sincronizado' : 'Local'
  ]);

  const csv = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), 'Bitacora_' + new Date().toISOString().slice(0,10) + '.csv');
  showToast('CSV: ' + records.length + ' registros', 'success');
}

// ═══════════════════════════════════════════════════════════
// EXPORTAR PDF
// ═══════════════════════════════════════════════════════════

async function exportToPDF() {
  const records = app.records;
  if (records.length === 0) { showToast('No hay registros', 'warning'); return; }

  if (typeof window.jspdf === 'undefined') {
    showToast('Cargando PDF...', 'info');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'letter');
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const m = 15;
  let y = m;

  doc.setFillColor(15,23,42); doc.rect(0,0,pw,38,'F');
  doc.setFillColor(37,99,235); doc.rect(0,35,pw,3,'F');
  doc.setTextColor(255,255,255); doc.setFontSize(20); doc.setFont('helvetica','bold');
  doc.text('Bitácora Digital', m, 16);
  doc.setFontSize(10); doc.setFont('helvetica','normal');
  doc.text((app.config.obra || 'Construrike') + ' — ' + (app.config.residente || ''), m, 24);
  doc.setFontSize(8);
  doc.text('Generado: ' + new Date().toLocaleString('es-MX') + ' | ' + records.length + ' registros', m, 32);
  y = 45;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (y + 75 > ph - m) { doc.addPage(); y = m; }
    if (i > 0) { doc.setDrawColor(200); doc.line(m,y,pw-m,y); y += 4; }

    doc.setTextColor(37,99,235); doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.text('#' + (r.cloudId || r.localId || (i+1)) + ' — ' + r.tipo, m, y); y += 6;

    doc.setTextColor(80,80,80); doc.setFontSize(9); doc.setFont('helvetica','normal');
    doc.text('Fecha: ' + formatDateTime(new Date(r.timestamp)), m, y); y += 4.5;
    doc.text('GPS: ' + r.gps.lat + ', ' + r.gps.lng, m, y); y += 4.5;
    doc.text('Clima: ' + (r.clima||'—') + ' | Conectividad: ' + (r.conectividad||'—') + ' | Personal: ' + (r.personal||'—'), m, y); y += 4.5;
    if (r.volumenes) { doc.text('Volúmenes: ' + r.volumenes + ' m³', m, y); y += 4.5; }
    if (r.maquinaria) { doc.text('Maquinaria: ' + r.maquinaria, m, y); y += 4.5; }

    doc.setTextColor(30,30,30);
    var lines = doc.splitTextToSize(r.description, pw-2*m);
    doc.text(lines, m, y); y += lines.length * 4 + 2;

    var photos = (r.photoUrls && r.photoUrls.length > 0) ? r.photoUrls : (r.photos || []);
    if (photos.length > 0 && y + 35 < ph - m) {
      var maxP = Math.min(photos.length, 3);
      for (var p = 0; p < maxP; p++) {
        try { doc.addImage(photos[p], 'JPEG', m + (p * 43), y, 40, 30); } catch(_) {}
      }
      y += 35;
    }
    y += 3;
  }

  var tp = doc.internal.getNumberOfPages();
  for (var pg = 1; pg <= tp; pg++) {
    doc.setPage(pg); doc.setFontSize(7); doc.setTextColor(150);
    doc.text('Bitácora Digital Construrike — Pág ' + pg + '/' + tp, pw/2, ph-6, { align: 'center' });
  }

  doc.save('Bitacora_' + new Date().toISOString().slice(0,10) + '.pdf');
  showToast('PDF: ' + records.length + ' registros', 'success');
}

// ═══════════════════════════════════════════════════════════
// CONECTIVIDAD
// ═══════════════════════════════════════════════════════════

function setupConnectivity() {
  window.addEventListener('online', () => {
    app.isOnline = true;
    updateOnlineIndicator();
    showToast('Conexión restaurada', 'success');
    if (app.isAdmin) syncToCloud();
  });
  window.addEventListener('offline', () => {
    app.isOnline = false;
    updateOnlineIndicator();
    showToast('Sin conexión — guardado local activo', 'warning');
  });
}

function updateOnlineIndicator() {
  const dot = document.getElementById('online-dot');
  const text = document.getElementById('online-text');
  const ind = document.getElementById('online-indicator');
  if (app.isOnline) {
    dot.className = 'indicator-dot online';
    text.textContent = 'Online';
    ind.className = 'connectivity-badge online';
  } else {
    dot.className = 'indicator-dot offline';
    text.textContent = 'Offline';
    ind.className = 'connectivity-badge offline';
  }
}

async function updatePendingBadge() {
  try {
    const count = await localDB.countPending();
    const badge = document.getElementById('pending-badge');
    if (count > 0) { badge.textContent = count; badge.classList.remove('hidden'); }
    else { badge.classList.add('hidden'); }
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════

function formatDateTime(d) {
  return d.toLocaleString('es-MX', {
    year:'numeric', month:'short', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hour12: false
  });
}

function escapeHTML(s) {
  var d = document.createElement('div');
  d.appendChild(document.createTextNode(s));
  return d.innerHTML;
}

function debounce(fn, ms) {
  var t; return function() { var a = arguments; clearTimeout(t); t = setTimeout(function() { fn.apply(null, a); }, ms); };
}

function downloadBlob(blob, name) {
  var u = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = u; a.download = name;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(u);
}

function loadScript(src) {
  return new Promise(function(r, e) {
    var s = document.createElement('script');
    s.src = src; s.onload = r; s.onerror = e;
    document.head.appendChild(s);
  });
}

// ═══════════════════════════════════════════════════════════
// TOASTS
// ═══════════════════════════════════════════════════════════

function showToast(msg, type) {
  type = type || 'info';
  var c = document.getElementById('toast-container');
  var cls = { success:'toast-success', warning:'toast-warning', error:'toast-error', info:'toast-info' };
  var icons = { success:'✅', warning:'⚠️', error:'❌', info:'ℹ️' };

  var t = document.createElement('div');
  t.className = 'toast-item ' + cls[type];
  t.innerHTML = '<span>' + icons[type] + '</span><span>' + escapeHTML(msg) + '</span>';
  c.appendChild(t);

  setTimeout(function() {
    t.classList.add('toast-exit');
    setTimeout(function() { t.remove(); }, 300);
  }, type === 'error' ? 5000 : 3000);
}

// ═══════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════════════

function setupEventListeners() {
  // Setup PIN
  document.getElementById('btn-setup-pin').addEventListener('click', setupPin);
  document.getElementById('setup-pin-confirm').addEventListener('keydown', function(e) { if (e.key === 'Enter') setupPin(); });

  // Login
  document.getElementById('btn-login-pin').addEventListener('click', loginWithPin);
  document.getElementById('btn-enter-viewer').addEventListener('click', enterAsViewer);
  document.getElementById('login-pin').addEventListener('keydown', function(e) { if (e.key === 'Enter') loginWithPin(); });

  // Config
  var configBtn = document.getElementById('btn-open-config');
  if (configBtn) configBtn.addEventListener('click', openConfig);
  document.getElementById('btn-save-config').addEventListener('click', saveConfig);

  // Nuevo registro
  document.getElementById('btn-new-record').addEventListener('click', openNewRecordForm);
  document.getElementById('btn-take-photo').addEventListener('click', capturePhoto);
  document.getElementById('btn-save-record').addEventListener('click', saveRecord);

  // Validación
  document.getElementById('field-description').addEventListener('input', validateForm);

  // Exportar
  document.getElementById('btn-export-csv').addEventListener('click', exportToCSV);
  document.getElementById('btn-export-pdf').addEventListener('click', exportToPDF);

  // Filtros
  document.getElementById('filter-date').addEventListener('change', loadRecords);
  document.getElementById('filter-search').addEventListener('input', debounce(loadRecords, 300));

  // Cerrar modales — botones con data-close
  document.querySelectorAll('[data-close]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      closeModal(btn.getAttribute('data-close'));
    });
  });

  // Cerrar modales — click en overlay
  document.querySelectorAll('.modal-overlay').forEach(function(overlay) {
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // Sync manual
  var syncBtn = document.getElementById('btn-sync');
  if (syncBtn) syncBtn.addEventListener('click', function() {
    if (cloud.isAvailable()) syncToCloud();
    else showToast('Sin conexión o Supabase no configurado', 'warning');
  });

  // Logout
  var logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', function() {
    app.isAdmin = false;
    showScreen('screen-login');
  });
}

// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', initApp);
