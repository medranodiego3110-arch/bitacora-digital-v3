/**
 * db.js — Capa de datos híbrida para Bitácora Digital Construrike
 * 
 * IndexedDB: almacenamiento offline (siempre disponible)
 * Supabase: base de datos en la nube (cuando hay conexión)
 * 
 * Flujo:
 *   1. Registros siempre se guardan primero en IndexedDB
 *   2. Si hay conexión, se sincronizan a Supabase automáticamente
 *   3. Al cargar la app con conexión, se descargan registros de Supabase
 */

// ═══════════════════════════════════════════════════════════
// CONFIGURACIÓN DE SUPABASE
// ═══════════════════════════════════════════════════════════
// ⚠️ INSTRUCCIONES: Reemplaza estos valores con los de tu proyecto Supabase
// Los encuentras en: Supabase Dashboard → Settings → API

const SUPABASE_URL = 'https://bjnyjxdaeqobytzqjevj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqbnlqeGRhZXFvYnl0enFqZXZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2MDM1NjEsImV4cCI6MjA5MTE3OTU2MX0.FPxa6N-oTndsg0YUhaA4MLZT53W2c0FYcGn4p4Z0vmk';

// ═══════════════════════════════════════════════════════════

const DB_NAME = 'BitacoraDB';
const DB_VERSION = 3;
const STORE_RECORDS = 'registros';
const STORE_CONFIG = 'config';

let supabaseClient = null;
let supabaseReady = false;

// ─── Inicializar cliente Supabase ───
function initSupabase() {
  if (SUPABASE_URL === 'TU_SUPABASE_URL_AQUI' || SUPABASE_ANON_KEY === 'TU_ANON_KEY_AQUI') {
    console.warn('[DB] Supabase NO configurado — funcionando solo con almacenamiento local');
    supabaseReady = false;
    return;
  }

  try {
    if (typeof supabase !== 'undefined' && supabase.createClient) {
      supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      supabaseReady = true;
      console.log('[DB] Supabase inicializado correctamente');
    } else {
      console.warn('[DB] Librería Supabase no cargada — funcionando offline');
      supabaseReady = false;
    }
  } catch (err) {
    console.error('[DB] Error inicializando Supabase:', err);
    supabaseReady = false;
  }
}

// ═══════════════════════════════════════════════════════════
// IndexedDB — ALMACENAMIENTO LOCAL
// ═══════════════════════════════════════════════════════════

class LocalDB {
  constructor() {
    this.db = null;
  }

  open() {
    return new Promise((resolve, reject) => {
      if (this.db) { resolve(this.db); return; }

      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        // Store de registros
        if (!db.objectStoreNames.contains(STORE_RECORDS)) {
          const store = db.createObjectStore(STORE_RECORDS, { keyPath: 'localId', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('synced', 'synced', { unique: false });
          store.createIndex('cloudId', 'cloudId', { unique: false });
        }
        // Store de configuración
        if (!db.objectStoreNames.contains(STORE_CONFIG)) {
          db.createObjectStore(STORE_CONFIG, { keyPath: 'key' });
        }
      };

      req.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // ─── Registros ───

  addRecord(record) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_RECORDS, 'readwrite');
      const store = tx.objectStore(STORE_RECORDS);
      const req = store.add(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  getAllRecords() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_RECORDS, 'readonly');
      const req = tx.objectStore(STORE_RECORDS).getAll();
      req.onsuccess = () => {
        resolve(req.result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
      };
      req.onerror = () => reject(req.error);
    });
  }

  getRecord(localId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_RECORDS, 'readonly');
      const req = tx.objectStore(STORE_RECORDS).get(localId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  updateRecord(localId, data) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_RECORDS, 'readwrite');
      const store = tx.objectStore(STORE_RECORDS);
      const getReq = store.get(localId);
      getReq.onsuccess = () => {
        const updated = { ...getReq.result, ...data };
        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve(updated);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  deleteRecord(localId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_RECORDS, 'readwrite');
      const req = tx.objectStore(STORE_RECORDS).delete(localId);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  getPendingRecords() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_RECORDS, 'readonly');
      const idx = tx.objectStore(STORE_RECORDS).index('synced');
      const req = idx.getAll(false);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  countPending() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_RECORDS, 'readonly');
      const idx = tx.objectStore(STORE_RECORDS).index('synced');
      const req = idx.count(false);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // ─── Configuración ───

  setConfig(key, value) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_CONFIG, 'readwrite');
      const req = tx.objectStore(STORE_CONFIG).put({ key, value });
      req.onsuccess = () => resolve(value);
      req.onerror = () => reject(req.error);
    });
  }

  getConfig(key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_CONFIG, 'readonly');
      const req = tx.objectStore(STORE_CONFIG).get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error);
    });
  }
}

// ═══════════════════════════════════════════════════════════
// CLOUD — SUPABASE SYNC
// ═══════════════════════════════════════════════════════════

const cloud = {

  isAvailable() {
    return supabaseReady && navigator.onLine;
  },

  /** Sube fotos a Supabase Storage, retorna array de URLs públicas */
  async uploadPhotos(photos, recordTimestamp) {
    if (!this.isAvailable() || !photos || photos.length === 0) return [];

    const urls = [];
    const timestamp = new Date(recordTimestamp).getTime();

    for (let i = 0; i < photos.length; i++) {
      try {
        // Convertir base64 a blob
        const base64 = photos[i];
        const byteString = atob(base64.split(',')[1]);
        const mimeType = base64.split(',')[0].match(/:(.*?);/)[1];
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let j = 0; j < byteString.length; j++) {
          ia[j] = byteString.charCodeAt(j);
        }
        const blob = new Blob([ab], { type: mimeType });

        const fileName = `${timestamp}_${i}_${Math.random().toString(36).substr(2, 6)}.jpg`;
        const filePath = `registros/${fileName}`;

        const { data, error } = await supabaseClient.storage
          .from('fotos')
          .upload(filePath, blob, { contentType: 'image/jpeg', upsert: false });

        if (error) {
          console.error('[CLOUD] Error subiendo foto:', error);
          continue;
        }

        // Obtener URL pública
        const { data: urlData } = supabaseClient.storage
          .from('fotos')
          .getPublicUrl(filePath);

        if (urlData && urlData.publicUrl) {
          urls.push(urlData.publicUrl);
        }
      } catch (err) {
        console.error('[CLOUD] Error procesando foto:', err);
      }
    }

    return urls;
  },

  /** Guarda un registro en Supabase (tabla registros) */
  async saveRecord(record, photoUrls) {
    if (!this.isAvailable()) return null;

    try {
      const row = {
        timestamp: record.timestamp,
        gps_lat: record.gps.lat,
        gps_lng: record.gps.lng,
        obra: record.obra || '',
        residente: record.residente || '',
        description: record.description,
        clima: record.clima || '',
        conectividad: record.conectividad || '',
        personal: record.personal,
        volumenes: record.volumenes,
        maquinaria: record.maquinaria || '',
        tipo: record.tipo || 'Normal',
        fotos: photoUrls || []
      };

      const { data, error } = await supabaseClient
        .from('registros')
        .insert(row)
        .select()
        .single();

      if (error) {
        console.error('[CLOUD] Error guardando registro:', error);
        return null;
      }

      console.log('[CLOUD] Registro guardado, id:', data.id);
      return data.id;
    } catch (err) {
      console.error('[CLOUD] Error:', err);
      return null;
    }
  },

  /** Descarga todos los registros desde Supabase */
  async fetchAllRecords() {
    if (!this.isAvailable()) return [];

    try {
      const { data, error } = await supabaseClient
        .from('registros')
        .select('*')
        .order('timestamp', { ascending: false });

      if (error) {
        console.error('[CLOUD] Error descargando registros:', error);
        return [];
      }

      // Mapear a formato local
      return (data || []).map(r => ({
        cloudId: r.id,
        timestamp: r.timestamp,
        gps: { lat: parseFloat(r.gps_lat), lng: parseFloat(r.gps_lng) },
        obra: r.obra,
        residente: r.residente,
        description: r.description,
        clima: r.clima,
        conectividad: r.conectividad,
        personal: r.personal,
        volumenes: r.volumenes ? parseFloat(r.volumenes) : null,
        maquinaria: r.maquinaria,
        tipo: r.tipo,
        photos: r.fotos || [],
        synced: true
      }));
    } catch (err) {
      console.error('[CLOUD] Error:', err);
      return [];
    }
  },

  /** Guarda/lee configuración en Supabase */
  async setConfig(key, value) {
    if (!this.isAvailable()) return;
    try {
      await supabaseClient.from('config').upsert({ key, value }, { onConflict: 'key' });
    } catch (err) {
      console.error('[CLOUD] Error guardando config:', err);
    }
  },

  async getConfig(key) {
    if (!this.isAvailable()) return null;
    try {
      const { data } = await supabaseClient.from('config').select('value').eq('key', key).single();
      return data ? data.value : null;
    } catch (err) {
      return null;
    }
  },

  /** Sincroniza registros pendientes de IndexedDB a Supabase */
  async syncPending(localDB) {
    if (!this.isAvailable()) return 0;

    try {
      const pending = await localDB.getPendingRecords();
      if (pending.length === 0) return 0;

      let synced = 0;

      for (const record of pending) {
        try {
          // Subir fotos
          const photoUrls = await this.uploadPhotos(record.photos, record.timestamp);

          // Guardar registro
          const cloudId = await this.saveRecord(record, photoUrls);

          if (cloudId) {
            await localDB.updateRecord(record.localId, {
              synced: true,
              cloudId: cloudId,
              photoUrls: photoUrls
            });
            synced++;
          }
        } catch (err) {
          console.warn('[CLOUD] Error sincronizando registro:', record.localId, err);
        }
      }

      return synced;
    } catch (err) {
      console.error('[CLOUD] Error en sync:', err);
      return 0;
    }
  }
};

// ═══════════════════════════════════════════════════════════
// HASH PARA PIN (SHA-256)
// ═══════════════════════════════════════════════════════════

async function hashPin(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + '_bitacora_salt_construrike');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ═══════════════════════════════════════════════════════════
// INSTANCIA GLOBAL
// ═══════════════════════════════════════════════════════════

const localDB = new LocalDB();
