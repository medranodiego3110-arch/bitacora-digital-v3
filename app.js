/**
 * app.js — Bitácora Digital Construrike v3
 * Professional version with Lucide icons
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

function refreshIcons() {
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════

async function initApp() {
  try {
    await localDB.open();
    initSupabase();
    setupEventListeners();
    setupConnectivity();
    updateOnlineIndicator();

    var pinHash = await localDB.getConfig('pinHash');

    // Si no hay PIN local, buscar en Supabase (otro dispositivo pudo haberlo creado)
    if (!pinHash && cloud.isAvailable()) {
      try {
        var cloudPin = await cloud.getConfig('pinHash');
        if (cloudPin) {
          pinHash = cloudPin;
          await localDB.setConfig('pinHash', cloudPin);
          console.log('[APP] PIN recuperado desde la nube');
        }
      } catch (err) {
        console.warn('[APP] No se pudo verificar PIN en la nube:', err);
      }
    }

    var savedSession = await localDB.getConfig('session');

    if (!pinHash) {
      showScreen('screen-setup');
    } else if (savedSession === 'admin') {
      app.isAdmin = true;
      await enterApp();
    } else {
      showScreen('screen-login');
    }
    refreshIcons();
  } catch (err) {
    console.error('[APP] Error init:', err);
    showToast('Error al inicializar', 'error');
  }
}

// ═══════════════════════════════════════════════════════════
// SCREENS
// ═══════════════════════════════════════════════════════════

function showScreen(id) {
  document.querySelectorAll('.app-screen').forEach(function(s) { s.classList.add('hidden'); });
  document.getElementById(id).classList.remove('hidden');
  refreshIcons();
}

async function enterApp() {
  await loadConfig();
  updateOnlineIndicator();
  await updatePendingBadge();
  await loadRecords();
  showScreen('screen-main');
  updateModeUI();
  if (navigator.onLine && app.isAdmin) setTimeout(function() { syncToCloud(); }, 2000);
}

function updateModeUI() {
  document.querySelectorAll('.admin-only').forEach(function(el) {
    el.classList[app.isAdmin ? 'remove' : 'add']('hidden');
  });
  document.getElementById('viewer-banner').classList[app.isAdmin ? 'add' : 'remove']('hidden');
  refreshIcons();
}

// ═══════════════════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════════════════

function openModal(id) {
  document.getElementById(id).classList.add('active');
  document.body.style.overflow = 'hidden';
  refreshIcons();
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  document.body.style.overflow = '';
  if (id === 'modal-record-form') stopCameraStream();
}

// ═══════════════════════════════════════════════════════════
// PIN
// ═══════════════════════════════════════════════════════════

async function setupPin() {
  var pin = document.getElementById('setup-pin').value.trim();
  var confirm = document.getElementById('setup-pin-confirm').value.trim();
  var error = document.getElementById('setup-error');

  if (pin.length < 4) { error.textContent = 'El PIN debe tener al menos 4 dígitos'; error.classList.remove('hidden'); return; }
  if (pin !== confirm) { error.textContent = 'Los PINs no coinciden'; error.classList.remove('hidden'); return; }

  try {
    var hash = await hashPin(pin);
    await localDB.setConfig('pinHash', hash);
    if (cloud.isAvailable()) await cloud.setConfig('pinHash', hash);
    error.classList.add('hidden');
    app.isAdmin = true;
    await localDB.setConfig('session', 'admin');
    showToast('PIN configurado', 'success');
    await enterApp();
  } catch (err) {
    error.textContent = 'Error al guardar PIN'; error.classList.remove('hidden');
  }
}

async function loginWithPin() {
  var pin = document.getElementById('login-pin').value.trim();
  var error = document.getElementById('login-error');
  if (!pin) { error.textContent = 'Ingresa el PIN'; error.classList.remove('hidden'); return; }

  try {
    var storedHash = await localDB.getConfig('pinHash');

    // Si no hay PIN local, intentar desde Supabase
    if (!storedHash && cloud.isAvailable()) {
      try {
        storedHash = await cloud.getConfig('pinHash');
        if (storedHash) await localDB.setConfig('pinHash', storedHash);
      } catch (_) {}
    }

    var inputHash = await hashPin(pin);
    if (inputHash === storedHash) {
      error.classList.add('hidden'); app.isAdmin = true;
      await localDB.setConfig('session', 'admin');
      showToast('Acceso administrativo', 'success');
      await enterApp();
    } else {
      error.textContent = 'PIN incorrecto'; error.classList.remove('hidden');
      document.getElementById('login-pin').value = '';
    }
  } catch (err) {
    error.textContent = 'Error de verificación'; error.classList.remove('hidden');
  }
}

async function enterAsViewer() {
  app.isAdmin = false;
  showToast('Modo solo lectura', 'info');
  await enterApp();
}

// ═══════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════

async function loadConfig() {
  try {
    var obra = null, residente = null;
    if (cloud.isAvailable()) { obra = await cloud.getConfig('obra'); residente = await cloud.getConfig('residente'); }
    if (!obra) obra = await localDB.getConfig('obra');
    if (!residente) residente = await localDB.getConfig('residente');
    app.config.obra = obra || ''; app.config.residente = residente || '';
    updateConfigBanner();
  } catch (err) { console.warn('[APP] Config error:', err); }
}

function updateConfigBanner() {
  var bo = document.getElementById('banner-obra');
  var br = document.getElementById('banner-residente');
  bo.textContent = app.config.obra || 'Sin obra configurada';
  br.textContent = app.config.residente || '';
}

function openConfig() {
  document.getElementById('config-obra').value = app.config.obra;
  document.getElementById('config-residente').value = app.config.residente;
  openModal('modal-config');
}

async function saveConfig() {
  try {
    var obra = document.getElementById('config-obra').value.trim();
    var residente = document.getElementById('config-residente').value.trim();
    await localDB.setConfig('obra', obra); await localDB.setConfig('residente', residente);
    if (cloud.isAvailable()) { await cloud.setConfig('obra', obra); await cloud.setConfig('residente', residente); }
    app.config.obra = obra; app.config.residente = residente;
    updateConfigBanner(); closeModal('modal-config');
    showToast('Configuración guardada', 'success');
  } catch (err) { showToast('Error al guardar', 'error'); }
}

// ═══════════════════════════════════════════════════════════
// FORM
// ═══════════════════════════════════════════════════════════

function openNewRecordForm() {
  if (!app.config.obra) { showToast('Configura la obra primero', 'warning'); openConfig(); return; }

  app.currentPhotos = []; app.currentGPS = null;
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
  document.getElementById('desc-counter').className = 'field-hint';
  document.getElementById('display-timestamp').textContent = formatDateTime(new Date(app.formTimestamp));
  getGPS();
  document.getElementById('btn-save-record').disabled = true;
  openModal('modal-record-form');
}

// ═══════════════════════════════════════════════════════════
// CAMERA
// ═══════════════════════════════════════════════════════════

async function capturePhoto() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { showToast('Cámara no soportada', 'error'); return; }

  var btn = document.getElementById('btn-take-photo');
  btn.disabled = true; btn.innerHTML = '<span class="animate-spin" style="display:inline-block">⟳</span> Abriendo cámara...';

  try {
    var stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } } });
    app.cameraStream = stream;
    var video = document.createElement('video');
    video.srcObject = stream; video.setAttribute('playsinline', ''); video.setAttribute('autoplay', '');
    await new Promise(function(r) { video.onloadedmetadata = function() { video.play(); r(); }; });
    await new Promise(function(r) { setTimeout(r, 400); });

    var canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    app.currentPhotos.push(canvas.toDataURL('image/jpeg', 0.7));
    stopCameraStream();
    renderPhotoStrip(); validateForm();
    showToast('Foto ' + app.currentPhotos.length + ' capturada', 'success');
  } catch (err) {
    stopCameraStream();
    showToast(err.name === 'NotAllowedError' ? 'Permiso de cámara denegado' : 'Error al acceder a la cámara', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="camera" class="icon"></i> Tomar Foto';
    refreshIcons();
  }
}

function stopCameraStream() {
  if (app.cameraStream) { app.cameraStream.getTracks().forEach(function(t) { t.stop(); }); app.cameraStream = null; }
}

function renderPhotoStrip() {
  var strip = document.getElementById('photos-strip');
  strip.innerHTML = app.currentPhotos.map(function(photo, i) {
    return '<div class="photo-thumb-wrap"><img src="' + photo + '" alt="Foto ' + (i+1) + '"><button type="button" class="photo-remove" onclick="removePhoto(' + i + ')">✕</button><span class="photo-num">' + (i+1) + '</span></div>';
  }).join('');
  updatePhotoCount();
}

function removePhoto(index) { app.currentPhotos.splice(index, 1); renderPhotoStrip(); validateForm(); }

function updatePhotoCount() {
  var el = document.getElementById('photo-count');
  var n = app.currentPhotos.length;
  el.textContent = n === 0 ? 'Sin fotos' : n + ' foto' + (n > 1 ? 's' : '');
  el.className = n > 0 ? 'photo-count has-photos' : 'photo-count';
}

// ═══════════════════════════════════════════════════════════
// GPS
// ═══════════════════════════════════════════════════════════

function getGPS() {
  var display = document.getElementById('display-gps');
  var status = document.getElementById('gps-status');
  if (!navigator.geolocation) { display.textContent = 'No soportado'; status.textContent = 'No disponible'; status.className = 'field-hint'; return; }
  display.textContent = 'Obteniendo...'; status.textContent = 'Localizando...'; status.className = 'field-hint warning animate-pulse';

  navigator.geolocation.getCurrentPosition(
    function(pos) {
      app.currentGPS = { lat: parseFloat(pos.coords.latitude.toFixed(6)), lng: parseFloat(pos.coords.longitude.toFixed(6)) };
      display.textContent = app.currentGPS.lat + ', ' + app.currentGPS.lng;
      status.textContent = 'GPS obtenido'; status.className = 'field-hint valid'; validateForm();
    },
    function(err) {
      app.currentGPS = null; display.textContent = 'Error'; status.className = 'field-hint';
      if (err.code === err.PERMISSION_DENIED) { status.textContent = 'Permiso denegado'; showToast('Activa ubicación en configuración', 'error'); }
      else if (err.code === err.POSITION_UNAVAILABLE) { status.textContent = 'No disponible'; }
      else { status.textContent = 'Tiempo agotado'; }
      validateForm();
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
  );
}

// ═══════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════

function validateForm() {
  var desc = document.getElementById('field-description').value.trim();
  var counter = document.getElementById('desc-counter');
  counter.textContent = desc.length + '/20 mín.';
  counter.className = desc.length >= 20 ? 'field-hint valid' : 'field-hint warning';
  var valid = app.currentPhotos.length > 0 && app.currentGPS !== null && desc.length >= 20;
  document.getElementById('btn-save-record').disabled = !valid;
  return valid;
}

// ═══════════════════════════════════════════════════════════
// SAVE RECORD
// ═══════════════════════════════════════════════════════════

async function saveRecord() {
  if (!validateForm()) return;
  var btn = document.getElementById('btn-save-record');
  btn.disabled = true; btn.innerHTML = '<span class="animate-spin" style="display:inline-block">⟳</span> Guardando...';

  try {
    var record = {
      timestamp: app.formTimestamp, photos: [].concat(app.currentPhotos), photoUrls: [],
      gps: { lat: app.currentGPS.lat, lng: app.currentGPS.lng },
      obra: app.config.obra, residente: app.config.residente,
      description: document.getElementById('field-description').value.trim(),
      clima: document.getElementById('field-clima').value,
      conectividad: document.getElementById('field-conectividad').value,
      personal: parseInt(document.getElementById('field-personal').value) || null,
      volumenes: parseFloat(document.getElementById('field-volumenes').value) || null,
      maquinaria: document.getElementById('field-maquinaria').value.trim() || null,
      tipo: document.getElementById('field-tipo').value,
      synced: false, cloudId: null
    };

    var localId = await localDB.addRecord(record);
    if (cloud.isAvailable()) {
      try {
        var photoUrls = await cloud.uploadPhotos(record.photos, record.timestamp);
        var cloudId = await cloud.saveRecord(record, photoUrls);
        if (cloudId) await localDB.updateRecord(localId, { synced: true, cloudId: cloudId, photoUrls: photoUrls });
      } catch (syncErr) { console.warn('[APP] Sync falló:', syncErr); }
    }
    closeModal('modal-record-form');
    await loadRecords(); await updatePendingBadge();
    showToast('Registro guardado', 'success');
  } catch (err) {
    console.error('[APP] Error:', err); showToast('Error al guardar', 'error');
  } finally {
    btn.innerHTML = '<i data-lucide="check-circle" class="icon"></i> Guardar Registro';
    btn.disabled = false; refreshIcons();
  }
}

// ═══════════════════════════════════════════════════════════
// SYNC
// ═══════════════════════════════════════════════════════════

async function syncToCloud() {
  if (app.syncInProgress || !cloud.isAvailable()) return;
  app.syncInProgress = true;
  try {
    var synced = await cloud.syncPending(localDB);
    if (synced > 0) {
      showToast(synced + ' registro' + (synced > 1 ? 's' : '') + ' sincronizado' + (synced > 1 ? 's' : ''), 'success');
      await loadRecords(); await updatePendingBadge();
    }
  } catch (err) { console.error('[APP] Sync error:', err); }
  finally { app.syncInProgress = false; }
}

// ═══════════════════════════════════════════════════════════
// LOAD RECORDS
// ═══════════════════════════════════════════════════════════

async function loadRecords() {
  try {
    var records = await localDB.getAllRecords();
    if (cloud.isAvailable()) {
      try {
        var cloudRecords = await cloud.fetchAllRecords();
        var localCloudIds = new Set(records.filter(function(r) { return r.cloudId; }).map(function(r) { return r.cloudId; }));
        cloudRecords.forEach(function(cr) { if (!localCloudIds.has(cr.cloudId)) records.push(cr); });
      } catch(_) {}
    }
    records.sort(function(a,b) { return new Date(b.timestamp) - new Date(a.timestamp); });
    app.records = records;

    var filtered = records.slice();
    var filterDate = document.getElementById('filter-date').value;
    if (filterDate) filtered = filtered.filter(function(r) { return r.timestamp.startsWith(filterDate); });
    var search = document.getElementById('filter-search').value.trim().toLowerCase();
    if (search) filtered = filtered.filter(function(r) {
      return r.description.toLowerCase().includes(search) || r.tipo.toLowerCase().includes(search) || (r.maquinaria && r.maquinaria.toLowerCase().includes(search));
    });

    document.getElementById('record-count').textContent = filtered.length + ' registro' + (filtered.length !== 1 ? 's' : '');
    var container = document.getElementById('records-list');
    var empty = document.getElementById('empty-state');

    if (filtered.length === 0) { container.innerHTML = ''; empty.classList.remove('hidden'); refreshIcons(); return; }
    empty.classList.add('hidden');
    container.innerHTML = filtered.map(renderCard).join('');
    container.querySelectorAll('[data-local-id]').forEach(function(card) {
      card.addEventListener('click', function() {
        openDetail(card.dataset.localId ? parseInt(card.dataset.localId) : null, card.dataset.cloudId ? parseInt(card.dataset.cloudId) : null);
      });
    });
    refreshIcons();
  } catch (err) { console.error('[APP] Load error:', err); }
}

function renderCard(r) {
  var date = formatDateTime(new Date(r.timestamp));
  var desc = r.description.length > 65 ? r.description.substring(0, 65) + '…' : r.description;
  var photoSrc = getFirstPhoto(r);
  var pCount = getPhotoCount(r);
  var tipoClass = { 'Normal':'tipo-normal','Incidencia':'tipo-incidencia','Hito':'tipo-hito' }[r.tipo] || 'tipo-normal';
  var sClass = r.synced ? 'status-synced' : 'status-pending';
  var sIcon = r.synced ? 'cloud' : 'hard-drive';
  var sText = r.synced ? 'Sincronizado' : 'Local';

  return '<div data-local-id="' + (r.localId||'') + '" data-cloud-id="' + (r.cloudId||'') + '" class="record-card">' +
    '<div class="record-thumb">' +
    (photoSrc ? '<img src="'+photoSrc+'" alt="" loading="lazy">' : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#475569"><i data-lucide="camera" style="width:24px;height:24px"></i></div>') +
    (pCount > 1 ? '<span class="photo-badge">'+pCount+'</span>' : '') +
    '</div><div class="record-info">' +
    '<div class="record-header"><span class="record-date"><i data-lucide="clock" style="width:11px;height:11px"></i> '+date+'</span><span class="tipo-badge '+tipoClass+'">'+r.tipo+'</span></div>' +
    '<p class="record-desc">'+escapeHTML(desc)+'</p>' +
    '<div class="record-meta">' +
    '<span class="record-meta-item">'+(r.clima||'')+'</span>' +
    (r.personal ? '<span class="record-meta-item"><i data-lucide="users" style="width:11px;height:11px"></i> '+r.personal+'</span>' : '') +
    '<span class="status-badge '+sClass+'"><i data-lucide="'+sIcon+'" style="width:10px;height:10px"></i> '+sText+'</span>' +
    '</div></div></div>';
}

function getFirstPhoto(r) { return (r.photoUrls && r.photoUrls.length) ? r.photoUrls[0] : (r.photos && r.photos.length) ? r.photos[0] : null; }
function getPhotoCount(r) { return (r.photoUrls && r.photoUrls.length) ? r.photoUrls.length : (r.photos && r.photos.length) ? r.photos.length : 0; }

// ═══════════════════════════════════════════════════════════
// DETAIL
// ═══════════════════════════════════════════════════════════

async function openDetail(localId, cloudId) {
  var record = null;
  if (localId) record = await localDB.getRecord(localId);
  if (!record && cloudId) record = app.records.find(function(r) { return r.cloudId === cloudId; });
  if (!record) return;

  var mapsUrl = 'https://maps.google.com/?q=' + record.gps.lat + ',' + record.gps.lng;
  var photos = (record.photoUrls && record.photoUrls.length) ? record.photoUrls : (record.photos || []);
  var gallery = document.getElementById('detail-gallery');

  gallery.innerHTML = photos.length > 0
    ? photos.map(function(src, i) { return '<img src="'+src+'" alt="Foto '+(i+1)+'" class="detail-photo" loading="lazy">'; }).join('')
    : '<div style="width:100%;height:180px;background:#1e293b;border-radius:14px;display:flex;align-items:center;justify-content:center;color:#475569;font-size:14px">Sin fotos</div>';

  document.getElementById('detail-timestamp').textContent = formatDateTime(new Date(record.timestamp));
  document.getElementById('detail-gps').innerHTML = '<a href="'+mapsUrl+'" target="_blank" rel="noopener" style="color:#60a5fa">'+record.gps.lat+', '+record.gps.lng+' →</a>';
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
    ? '<span style="color:#6ee7b7">Sincronizado en la nube</span>'
    : '<span style="color:#fcd34d">Guardado localmente</span>';
  openModal('modal-detail');
}

// ═══════════════════════════════════════════════════════════
// EXPORT CSV
// ═══════════════════════════════════════════════════════════

async function exportToCSV() {
  var records = app.records;
  if (!records.length) { showToast('No hay registros', 'warning'); return; }
  var h = ['ID','Fecha','Lat','Lng','Obra','Residente','Descripción','Clima','Conectividad','Personal','Vol_m3','Maquinaria','Tipo','Fotos','Estado'];
  var rows = records.map(function(r) {
    return [r.cloudId||r.localId||'', r.timestamp, r.gps.lat, r.gps.lng,
      '"'+(r.obra||'').replace(/"/g,'""')+'"', '"'+(r.residente||'').replace(/"/g,'""')+'"',
      '"'+r.description.replace(/"/g,'""')+'"', r.clima||'', r.conectividad||'',
      r.personal||'', r.volumenes||'', '"'+(r.maquinaria||'').replace(/"/g,'""')+'"',
      r.tipo, getPhotoCount(r), r.synced?'Sincronizado':'Local'];
  });
  var csv = '\uFEFF' + [h.join(',')].concat(rows.map(function(r){return r.join(',')})).join('\n');
  downloadBlob(new Blob([csv], {type:'text/csv;charset=utf-8;'}), 'Bitacora_'+new Date().toISOString().slice(0,10)+'.csv');
  showToast('CSV exportado: ' + records.length + ' registros', 'success');
}

// ═══════════════════════════════════════════════════════════
// EXPORT PDF
// ═══════════════════════════════════════════════════════════

async function exportToPDF() {
  var records = app.records;
  if (!records.length) { showToast('No hay registros', 'warning'); return; }
  if (typeof window.jspdf === 'undefined') {
    showToast('Cargando PDF...', 'info');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  }
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF('p','mm','letter');
  var pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight(), m = 15, y = m;

  doc.setFillColor(15,23,42); doc.rect(0,0,pw,38,'F');
  doc.setFillColor(37,99,235); doc.rect(0,35,pw,3,'F');
  doc.setTextColor(255,255,255); doc.setFontSize(20); doc.setFont('helvetica','bold');
  doc.text('Bitácora Digital', m, 16);
  doc.setFontSize(10); doc.setFont('helvetica','normal');
  doc.text((app.config.obra||'Construrike') + ' — ' + (app.config.residente||''), m, 24);
  doc.setFontSize(8);
  doc.text('Generado: '+new Date().toLocaleString('es-MX')+' | '+records.length+' registros', m, 32);
  y = 45;

  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    if (y + 75 > ph - m) { doc.addPage(); y = m; }
    if (i > 0) { doc.setDrawColor(200); doc.line(m,y,pw-m,y); y += 4; }
    doc.setTextColor(37,99,235); doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.text('#'+(r.cloudId||r.localId||(i+1))+' — '+r.tipo, m, y); y += 6;
    doc.setTextColor(80,80,80); doc.setFontSize(9); doc.setFont('helvetica','normal');
    doc.text('Fecha: '+formatDateTime(new Date(r.timestamp)), m, y); y += 4.5;
    doc.text('GPS: '+r.gps.lat+', '+r.gps.lng, m, y); y += 4.5;
    doc.text('Clima: '+(r.clima||'—')+' | Conectividad: '+(r.conectividad||'—')+' | Personal: '+(r.personal||'—'), m, y); y += 4.5;
    if (r.volumenes) { doc.text('Volúmenes: '+r.volumenes+' m³', m, y); y += 4.5; }
    if (r.maquinaria) { doc.text('Maquinaria: '+r.maquinaria, m, y); y += 4.5; }
    doc.setTextColor(30,30,30);
    var lines = doc.splitTextToSize(r.description, pw-2*m);
    doc.text(lines, m, y); y += lines.length*4+2;
    var photos = (r.photoUrls&&r.photoUrls.length)?r.photoUrls:(r.photos||[]);
    if (photos.length && y+35<ph-m) {
      for (var p=0;p<Math.min(photos.length,3);p++) { try{doc.addImage(photos[p],'JPEG',m+(p*43),y,40,30);}catch(e){} }
      y += 35;
    }
    y += 3;
  }
  var tp = doc.internal.getNumberOfPages();
  for (var pg=1;pg<=tp;pg++) { doc.setPage(pg); doc.setFontSize(7); doc.setTextColor(150); doc.text('Bitácora Digital Construrike — Pág '+pg+'/'+tp,pw/2,ph-6,{align:'center'}); }
  doc.save('Bitacora_'+new Date().toISOString().slice(0,10)+'.pdf');
  showToast('PDF exportado: '+records.length+' registros', 'success');
}

// ═══════════════════════════════════════════════════════════
// CONNECTIVITY
// ═══════════════════════════════════════════════════════════

function setupConnectivity() {
  window.addEventListener('online', function() { app.isOnline=true; updateOnlineIndicator(); showToast('Conexión restaurada','success'); if(app.isAdmin) syncToCloud(); });
  window.addEventListener('offline', function() { app.isOnline=false; updateOnlineIndicator(); showToast('Sin conexión — guardado local activo','warning'); });
}

function updateOnlineIndicator() {
  var dot=document.getElementById('online-dot'), text=document.getElementById('online-text'), ind=document.getElementById('online-indicator');
  if (app.isOnline) { dot.className='indicator-dot online'; text.textContent='Online'; ind.className='connectivity-badge online'; }
  else { dot.className='indicator-dot offline'; text.textContent='Offline'; ind.className='connectivity-badge offline'; }
}

async function updatePendingBadge() {
  try { var c=await localDB.countPending(); var b=document.getElementById('pending-badge'); if(c>0){b.textContent=c;b.classList.remove('hidden');}else{b.classList.add('hidden');} } catch(_){}
}

// ═══════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════

function formatDateTime(d) { return d.toLocaleString('es-MX',{year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}); }
function escapeHTML(s) { var d=document.createElement('div'); d.appendChild(document.createTextNode(s)); return d.innerHTML; }
function debounce(fn,ms) { var t; return function(){var a=arguments;clearTimeout(t);t=setTimeout(function(){fn.apply(null,a);},ms);}; }
function downloadBlob(b,n) { var u=URL.createObjectURL(b),a=document.createElement('a'); a.href=u;a.download=n; document.body.appendChild(a);a.click(); document.body.removeChild(a); URL.revokeObjectURL(u); }
function loadScript(s) { return new Promise(function(r,e){ var sc=document.createElement('script'); sc.src=s; sc.onload=r; sc.onerror=e; document.head.appendChild(sc); }); }

// ═══════════════════════════════════════════════════════════
// TOASTS
// ═══════════════════════════════════════════════════════════

function showToast(msg, type) {
  type = type || 'info';
  var c = document.getElementById('toast-container');
  var cls = {success:'toast-success',warning:'toast-warning',error:'toast-error',info:'toast-info'};
  var t = document.createElement('div');
  t.className = 'toast-item ' + cls[type];
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(function(){ t.classList.add('toast-exit'); setTimeout(function(){t.remove();},300); }, type==='error'?5000:3000);
}

// ═══════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════════════

function setupEventListeners() {
  document.getElementById('btn-setup-pin').addEventListener('click', setupPin);
  document.getElementById('setup-pin-confirm').addEventListener('keydown', function(e){if(e.key==='Enter')setupPin();});
  document.getElementById('btn-login-pin').addEventListener('click', loginWithPin);
  document.getElementById('btn-enter-viewer').addEventListener('click', enterAsViewer);
  document.getElementById('login-pin').addEventListener('keydown', function(e){if(e.key==='Enter')loginWithPin();});
  var cfgBtn=document.getElementById('btn-open-config'); if(cfgBtn) cfgBtn.addEventListener('click', openConfig);
  document.getElementById('btn-save-config').addEventListener('click', saveConfig);
  document.getElementById('btn-new-record').addEventListener('click', openNewRecordForm);
  document.getElementById('btn-take-photo').addEventListener('click', capturePhoto);
  document.getElementById('btn-save-record').addEventListener('click', saveRecord);
  document.getElementById('field-description').addEventListener('input', validateForm);
  document.getElementById('btn-export-csv').addEventListener('click', exportToCSV);
  document.getElementById('btn-export-pdf').addEventListener('click', exportToPDF);
  document.getElementById('filter-date').addEventListener('change', loadRecords);
  document.getElementById('filter-search').addEventListener('input', debounce(loadRecords, 300));

  document.querySelectorAll('[data-close]').forEach(function(btn) {
    btn.addEventListener('click', function() { closeModal(btn.getAttribute('data-close')); });
  });
  document.querySelectorAll('.modal-overlay').forEach(function(o) {
    o.addEventListener('click', function(e) { if(e.target===o) closeModal(o.id); });
  });

  var syncBtn=document.getElementById('btn-sync');
  if(syncBtn) syncBtn.addEventListener('click', function(){ cloud.isAvailable()?syncToCloud():showToast('Sin conexión o Supabase no configurado','warning'); });
  var logoutBtn=document.getElementById('btn-logout');
  if(logoutBtn) logoutBtn.addEventListener('click', function(){ app.isAdmin=false; localDB.setConfig('session',''); showScreen('screen-login'); });
}

document.addEventListener('DOMContentLoaded', initApp);
