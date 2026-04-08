/**
 * app.js — Lógica principal Bitácora Digital Construrike v3
 * Admin PIN + Multi-foto + Supabase sync + Modo visitante
 */

// ─── Estado global ───
const app = {
  isOnline: navigator.onLine,
  isAdmin: false,
  currentPhotos: [],      // Array de base64 strings
  currentGPS: null,
  formTimestamp: null,
  cameraStream: null,
  config: { obra: '', residente: '' },
  records: [],            // Registros combinados (local + cloud)
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

    // Verificar si hay PIN configurado
    const pinHash = await localDB.getConfig('pinHash');

    if (!pinHash) {
      // Primera vez: mostrar setup de PIN
      showScreen('screen-setup');
    } else {
      // PIN existe: mostrar login
      showScreen('screen-login');
    }

    console.log('[APP] Inicializada');
  } catch (err) {
    console.error('[APP] Error init:', err);
    showToast('Error al inicializar', 'error');
  }
}

// ═══════════════════════════════════════════════════════════
// PANTALLAS Y NAVEGACIÓN
// ═══════════════════════════════════════════════════════════

function showScreen(screenId) {
  document.querySelectorAll('.app-screen').forEach(s => s.classList.add('hidden'));
  const screen = document.getElementById(screenId);
  if (screen) screen.classList.remove('hidden');
}

async function enterApp() {
  await loadConfig();
  updateOnlineIndicator();
  await updatePendingBadge();
  await loadRecords();
  showScreen('screen-main');

  // Actualizar UI según modo
  updateModeUI();

  // Sync si hay conexión
  if (navigator.onLine && app.isAdmin) {
    setTimeout(() => syncToCloud(), 2000);
  }
}

function updateModeUI() {
  const adminElements = document.querySelectorAll('.admin-only');
  const viewerBanner = document.getElementById('viewer-banner');
  const fabBtn = document.getElementById('btn-new-record');

  if (app.isAdmin) {
    adminElements.forEach(el => el.classList.remove('hidden'));
    viewerBanner.classList.add('hidden');
    fabBtn.classList.remove('hidden');
  } else {
    adminElements.forEach(el => el.classList.add('hidden'));
    viewerBanner.classList.remove('hidden');
    fabBtn.classList.add('hidden');
  }
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

    // También guardar en Supabase si está disponible
    if (cloud.isAvailable()) {
      await cloud.setConfig('pinHash', hash);
    }

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
// CONFIGURACIÓN (Obra + Residente)
// ═══════════════════════════════════════════════════════════

async function loadConfig() {
  try {
    // Intentar desde Supabase primero, luego local
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
// MODALES
// ═══════════════════════════════════════════════════════════

function openModal(id) {
  const m = document.getElementById(id);
  m.classList.remove('hidden');
  m.classList.add('flex');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  const m = document.getElementById(id);
  m.classList.add('hidden');
  m.classList.remove('flex');
  document.body.style.overflow = '';
  if (id === 'modal-record-form') stopCameraStream();
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

  // Reset
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
  document.getElementById('desc-counter').textContent = '0/20 mín.';
  document.getElementById('desc-counter').className = 'text-xs text-slate-500 mt-1';

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
    showToast('Cámara no soportada en este navegador', 'error');
    return;
  }

  const btn = document.getElementById('btn-take-photo');
  btn.disabled = true;
  btn.textContent = '⏳ Abriendo...';

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

    const base64 = canvas.toDataURL('image/jpeg', 0.7);
    app.currentPhotos.push(base64);
    stopCameraStream();

    renderPhotoStrip();
    validateForm();
    showToast(`Foto ${app.currentPhotos.length} capturada`, 'success');

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
  strip.innerHTML = app.currentPhotos.map((photo, i) => `
    <div class="photo-thumb-wrap relative flex-shrink-0">
      <img src="${photo}" class="w-20 h-20 object-cover rounded-xl border-2 border-slate-600" alt="Foto ${i + 1}">
      <button type="button" onclick="removePhoto(${i})"
        class="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center rounded-full bg-red-600 text-white text-xs font-bold shadow-lg hover:bg-red-500 transition">✕</button>
      <span class="absolute bottom-1 left-1 bg-black/60 text-[10px] text-white px-1.5 py-0.5 rounded">${i + 1}</span>
    </div>
  `).join('');
  updatePhotoCount();
}

function removePhoto(index) {
  app.currentPhotos.splice(index, 1);
  renderPhotoStrip();
  validateForm();
}

function updatePhotoCount() {
  const count = document.getElementById('photo-count');
  const n = app.currentPhotos.length;
  count.textContent = n === 0 ? 'Sin fotos' : `${n} foto${n > 1 ? 's' : ''}`;
  count.className = n > 0 ? 'text-xs text-emerald-400 mt-2 font-medium' : 'text-xs text-slate-500 mt-2';
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
    status.className = 'text-red-400 text-xs';
    return;
  }

  display.textContent = 'Obteniendo...';
  status.textContent = '⏳ Localizando...';
  status.className = 'text-amber-400 text-xs animate-pulse';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      app.currentGPS = {
        lat: parseFloat(pos.coords.latitude.toFixed(6)),
        lng: parseFloat(pos.coords.longitude.toFixed(6))
      };
      display.textContent = `${app.currentGPS.lat}, ${app.currentGPS.lng}`;
      status.textContent = '✅ Obtenido';
      status.className = 'text-emerald-400 text-xs';
      validateForm();
    },
    (err) => {
      app.currentGPS = null;
      display.textContent = 'Error';
      status.className = 'text-red-400 text-xs';
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
  counter.textContent = `${desc.length}/20 mín.`;
  counter.className = desc.length >= 20 ? 'text-xs text-emerald-400 mt-1' : 'text-xs text-amber-400 mt-1';

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

    // Guardar localmente primero (siempre)
    const localId = await localDB.addRecord(record);

    // Intentar sync inmediata a Supabase si hay conexión
    if (cloud.isAvailable()) {
      try {
        const photoUrls = await cloud.uploadPhotos(record.photos, record.timestamp);
        const cloudId = await cloud.saveRecord(record, photoUrls);

        if (cloudId) {
          await localDB.updateRecord(localId, {
            synced: true,
            cloudId: cloudId,
            photoUrls: photoUrls
          });
        }
      } catch (syncErr) {
        console.warn('[APP] Sync inmediata falló, queda pendiente:', syncErr);
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
// SYNC A SUPABASE
// ═══════════════════════════════════════════════════════════

async function syncToCloud() {
  if (app.syncInProgress || !cloud.isAvailable()) return;
  app.syncInProgress = true;

  try {
    const synced = await cloud.syncPending(localDB);
    if (synced > 0) {
      showToast(`${synced} registro${synced > 1 ? 's' : ''} sincronizado${synced > 1 ? 's' : ''}`, 'success');
      await loadRecords();
      await updatePendingBadge();
    }
  } catch (err) {
    console.error('[APP] Error en sync:', err);
  } finally {
    app.syncInProgress = false;
  }
}

// ═══════════════════════════════════════════════════════════
// CARGAR REGISTROS
// ═══════════════════════════════════════════════════════════

async function loadRecords() {
  try {
    // Obtener registros locales
    let records = await localDB.getAllRecords();

    // Si hay conexión y Supabase está disponible, descargar también de la nube
    if (cloud.isAvailable()) {
      try {
        const cloudRecords = await cloud.fetchAllRecords();

        // Merge: agregar registros de la nube que no existan localmente
        const localCloudIds = new Set(records.filter(r => r.cloudId).map(r => r.cloudId));
        for (const cr of cloudRecords) {
          if (!localCloudIds.has(cr.cloudId)) {
            records.push(cr);
          }
        }
      } catch (err) {
        console.warn('[APP] No se pudieron descargar registros de Supabase');
      }
    }

    // Ordenar por fecha desc
    records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    app.records = records;

    // Aplicar filtros
    let filtered = [...records];

    const filterDate = document.getElementById('filter-date').value;
    if (filterDate) {
      filtered = filtered.filter(r => r.timestamp.startsWith(filterDate));
    }

    const search = document.getElementById('filter-search').value.trim().toLowerCase();
    if (search) {
      filtered = filtered.filter(r =>
        r.description.toLowerCase().includes(search) ||
        r.tipo.toLowerCase().includes(search) ||
        (r.maquinaria && r.maquinaria.toLowerCase().includes(search))
      );
    }

    // Render
    const container = document.getElementById('records-list');
    const empty = document.getElementById('empty-state');
    document.getElementById('record-count').textContent = `${filtered.length} registro${filtered.length !== 1 ? 's' : ''}`;

    if (filtered.length === 0) {
      container.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');
    container.innerHTML = filtered.map(r => renderCard(r)).join('');

    // Event listeners en cards
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
  const tipoColors = {
    'Normal': 'bg-slate-700/80 text-slate-300',
    'Incidencia': 'bg-red-900/60 text-red-300',
    'Hito': 'bg-blue-900/60 text-blue-300'
  };

  const statusBadge = r.synced
    ? '<span class="status-badge synced">☁️ Sincronizado</span>'
    : '<span class="status-badge pending">💾 Local</span>';

  return `
    <div data-local-id="${r.localId || ''}" data-cloud-id="${r.cloudId || ''}" class="record-card">
      <div class="record-thumb">
        ${photoSrc
          ? `<img src="${photoSrc}" alt="Foto" class="w-full h-full object-cover" loading="lazy">`
          : '<div class="w-full h-full flex items-center justify-center text-2xl text-slate-600">📷</div>'}
        ${photoCount > 1 ? `<span class="photo-badge">${photoCount}</span>` : ''}
      </div>
      <div class="record-info">
        <div class="flex items-center justify-between gap-2 mb-1">
          <span class="text-[11px] text-slate-400">${date}</span>
          <span class="text-[10px] px-2 py-0.5 rounded-full font-medium ${tipoColors[r.tipo] || ''}">${r.tipo}</span>
        </div>
        <p class="text-[13px] text-slate-200 leading-snug mb-1.5 line-clamp-2">${escapeHTML(desc)}</p>
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-[11px] text-slate-500">${climaIcons[r.clima] || ''} ${r.clima || ''}</span>
          ${r.personal ? `<span class="text-[11px] text-slate-500">👷 ${r.personal}</span>` : ''}
          ${statusBadge}
        </div>
      </div>
    </div>`;
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
// DETALLE DE REGISTRO
// ═══════════════════════════════════════════════════════════

async function openDetail(localId, cloudId) {
  let record = null;

  if (localId) {
    record = await localDB.getRecord(localId);
  }

  if (!record && cloudId) {
    record = app.records.find(r => r.cloudId === cloudId);
  }

  if (!record) return;

  const modal = document.getElementById('modal-detail');
  const date = new Date(record.timestamp);
  const mapsUrl = `https://maps.google.com/?q=${record.gps.lat},${record.gps.lng}`;

  // Galería de fotos
  const photos = (record.photoUrls && record.photoUrls.length > 0)
    ? record.photoUrls
    : (record.photos || []);

  const gallery = document.getElementById('detail-gallery');
  if (photos.length > 0) {
    gallery.innerHTML = photos.map((src, i) => `
      <img src="${src}" alt="Foto ${i + 1}" class="detail-photo" loading="lazy">
    `).join('');
  } else {
    gallery.innerHTML = '<div class="w-full h-48 bg-slate-800 rounded-xl flex items-center justify-center text-slate-600 text-lg">Sin fotos</div>';
  }

  document.getElementById('detail-timestamp').textContent = formatDateTime(date);
  document.getElementById('detail-gps').innerHTML = `<a href="${mapsUrl}" target="_blank" rel="noopener" class="text-blue-400 hover:underline">${record.gps.lat}, ${record.gps.lng} ↗</a>`;
  document.getElementById('detail-obra').textContent = record.obra || '—';
  document.getElementById('detail-residente').textContent = record.residente || '—';
  document.getElementById('detail-description').textContent = record.description;
  document.getElementById('detail-clima').textContent = record.clima || '—';
  document.getElementById('detail-conectividad').textContent = record.conectividad || '—';
  document.getElementById('detail-personal').textContent = record.personal != null ? `${record.personal} personas` : '—';
  document.getElementById('detail-volumenes').textContent = record.volumenes != null ? `${record.volumenes} m³` : '—';
  document.getElementById('detail-maquinaria').textContent = record.maquinaria || '—';
  document.getElementById('detail-tipo').textContent = record.tipo;
  document.getElementById('detail-sync').innerHTML = record.synced
    ? '<span class="text-emerald-400">☁️ Sincronizado en la nube</span>'
    : '<span class="text-amber-400">💾 Guardado localmente</span>';

  openModal('modal-detail');
}

// ═══════════════════════════════════════════════════════════
// EXPORTAR CSV
// ═══════════════════════════════════════════════════════════

async function exportToCSV() {
  const records = app.records;
  if (records.length === 0) { showToast('No hay registros', 'warning'); return; }

  const headers = ['ID', 'Fecha', 'Latitud', 'Longitud', 'Obra', 'Residente', 'Descripción', 'Clima', 'Conectividad', 'Personal', 'Volúmenes_m3', 'Maquinaria', 'Tipo', 'Fotos', 'Estado'];
  const rows = records.map(r => [
    r.cloudId || r.localId || '',
    r.timestamp,
    r.gps.lat,
    r.gps.lng,
    `"${(r.obra || '').replace(/"/g, '""')}"`,
    `"${(r.residente || '').replace(/"/g, '""')}"`,
    `"${r.description.replace(/"/g, '""')}"`,
    r.clima || '',
    r.conectividad || '',
    r.personal || '',
    r.volumenes || '',
    `"${(r.maquinaria || '').replace(/"/g, '""')}"`,
    r.tipo,
    getPhotoCount(r),
    r.synced ? 'Sincronizado' : 'Local'
  ]);

  const csv = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `Bitacora_${new Date().toISOString().slice(0, 10)}.csv`);
  showToast(`CSV: ${records.length} registros`, 'success');
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

  // Header
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pw, 38, 'F');
  doc.setFillColor(37, 99, 235);
  doc.rect(0, 35, pw, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('Bitácora Digital', m, 16);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`${app.config.obra || 'Construrike'} — ${app.config.residente || ''}`, m, 24);
  doc.setFontSize(8);
  doc.text(`Generado: ${new Date().toLocaleString('es-MX')} | ${records.length} registros`, m, 32);
  y = 45;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (y + 75 > ph - m) { doc.addPage(); y = m; }
    if (i > 0) { doc.setDrawColor(200); doc.line(m, y, pw - m, y); y += 4; }

    doc.setTextColor(37, 99, 235);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`#${r.cloudId || r.localId || (i + 1)} — ${r.tipo}`, m, y);
    y += 6;

    doc.setTextColor(80, 80, 80);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Fecha: ${formatDateTime(new Date(r.timestamp))}`, m, y); y += 4.5;
    doc.text(`GPS: ${r.gps.lat}, ${r.gps.lng}`, m, y); y += 4.5;
    doc.text(`Clima: ${r.clima || '—'} | Conectividad: ${r.conectividad || '—'} | Personal: ${r.personal || '—'}`, m, y); y += 4.5;
    if (r.volumenes) { doc.text(`Volúmenes: ${r.volumenes} m³`, m, y); y += 4.5; }
    if (r.maquinaria) { doc.text(`Maquinaria: ${r.maquinaria}`, m, y); y += 4.5; }

    doc.setTextColor(30, 30, 30);
    const lines = doc.splitTextToSize(r.description, pw - 2 * m);
    doc.text(lines, m, y);
    y += lines.length * 4 + 2;

    // Fotos (máximo 3 en una fila)
    const photos = (r.photoUrls && r.photoUrls.length > 0) ? r.photoUrls : (r.photos || []);
    if (photos.length > 0 && y + 35 < ph - m) {
      const maxPhotos = Math.min(photos.length, 3);
      const photoW = 40;
      const photoH = 30;
      for (let p = 0; p < maxPhotos; p++) {
        try {
          doc.addImage(photos[p], 'JPEG', m + (p * (photoW + 3)), y, photoW, photoH);
        } catch (_) { /* skip broken photos */ }
      }
      y += photoH + 5;
    }
    y += 3;
  }

  // Footer
  const tp = doc.internal.getNumberOfPages();
  for (let p = 1; p <= tp; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text(`Bitácora Digital Construrike — Pág ${p}/${tp}`, pw / 2, ph - 6, { align: 'center' });
  }

  doc.save(`Bitacora_${new Date().toISOString().slice(0, 10)}.pdf`);
  showToast(`PDF: ${records.length} registros`, 'success');
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
    if (count > 0) {
      badge.textContent = count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════

function formatDateTime(d) {
  return d.toLocaleString('es-MX', {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
}

function escapeHTML(s) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(s));
  return d.innerHTML;
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function downloadBlob(blob, name) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u; a.download = name;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(u);
}

function loadScript(src) {
  return new Promise((r, e) => {
    const s = document.createElement('script');
    s.src = src; s.onload = r; s.onerror = e;
    document.head.appendChild(s);
  });
}

// ═══════════════════════════════════════════════════════════
// TOASTS
// ═══════════════════════════════════════════════════════════

function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const colors = {
    success: 'toast-success', warning: 'toast-warning',
    error: 'toast-error', info: 'toast-info'
  };
  const icons = { success: '✅', warning: '⚠️', error: '❌', info: 'ℹ️' };

  const t = document.createElement('div');
  t.className = `toast-item ${colors[type]}`;
  t.innerHTML = `<span>${icons[type]}</span><span>${escapeHTML(msg)}</span>`;
  c.appendChild(t);

  setTimeout(() => {
    t.classList.add('toast-exit');
    setTimeout(() => t.remove(), 300);
  }, type === 'error' ? 5000 : 3000);
}

// ═══════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════════════

function setupEventListeners() {
  // Setup PIN
  document.getElementById('btn-setup-pin').addEventListener('click', setupPin);

  // Login
  document.getElementById('btn-login-pin').addEventListener('click', loginWithPin);
  document.getElementById('btn-enter-viewer').addEventListener('click', enterAsViewer);
  document.getElementById('login-pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') loginWithPin(); });

  // Config
  document.getElementById('btn-open-config')?.addEventListener('click', openConfig);
  document.getElementById('btn-close-config').addEventListener('click', () => closeModal('modal-config'));
  document.getElementById('btn-save-config').addEventListener('click', saveConfig);

  // Nuevo registro
  document.getElementById('btn-new-record').addEventListener('click', openNewRecordForm);
  document.getElementById('btn-close-modal').addEventListener('click', () => closeModal('modal-record-form'));
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

  // Detalle
  document.getElementById('btn-close-detail').addEventListener('click', () => closeModal('modal-detail'));

  // Click fuera de modales
  ['modal-record-form', 'modal-detail', 'modal-config'].forEach(id => {
    document.getElementById(id).addEventListener('click', (e) => {
      if (e.target.id === id) closeModal(id);
    });
  });

  // Sync manual
  document.getElementById('btn-sync')?.addEventListener('click', () => {
    if (cloud.isAvailable()) {
      syncToCloud();
    } else {
      showToast('Sin conexión o Supabase no configurado', 'warning');
    }
  });

  // Logout
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    app.isAdmin = false;
    showScreen('screen-login');
  });
}

// ═══════════════════════════════════════════════════════════
// INICIAR
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', initApp);
