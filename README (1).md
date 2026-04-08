# Bitácora Digital — Construrike v3

Aplicación web (PWA) para registro digital de bitácora de obra. Funciona offline, sincroniza con Supabase, múltiples fotos por registro, y acceso por PIN para el residente.

## Características

- **Múltiples fotos** por registro
- **GPS + Timestamp** automáticos
- **PIN administrativo** — solo el residente crea/edita registros
- **Modo visitante** — cualquiera puede ver y descargar
- **Offline-first** — funciona sin señal, sincroniza cuando hay conexión
- **Supabase** — base de datos real en la nube con almacenamiento de fotos
- **Exportar** — CSV y PDF con fotos incluidas
- **Campos**: clima, conectividad, personal, volúmenes, maquinaria, tipo de evento

---

## Configuración paso a paso

### 1. Crear cuenta en Supabase (gratis)

1. Ve a [supabase.com](https://supabase.com) y crea una cuenta
2. Click en **"New Project"**
3. Nombre: `bitacora-construrike` (o el que quieras)
4. Password de la base de datos: genera uno y **guárdalo**
5. Región: **South America (São Paulo)** (más cercano a México)
6. Click **"Create new project"** y espera ~2 minutos

### 2. Crear las tablas (SQL)

1. En tu proyecto Supabase, ve al menú lateral → **SQL Editor**
2. Click en **"New query"**
3. Copia y pega **TODO** el siguiente código:

```sql
-- ════════════════════════════════════════════════
-- TABLAS PARA BITÁCORA DIGITAL
-- ════════════════════════════════════════════════

-- Tabla de registros
CREATE TABLE registros (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  timestamp TEXT NOT NULL,
  gps_lat NUMERIC(10,6) NOT NULL,
  gps_lng NUMERIC(10,6) NOT NULL,
  obra TEXT NOT NULL DEFAULT '',
  residente TEXT DEFAULT '',
  description TEXT NOT NULL,
  clima TEXT DEFAULT '',
  conectividad TEXT DEFAULT '',
  personal INTEGER,
  volumenes NUMERIC(10,2),
  maquinaria TEXT DEFAULT '',
  tipo TEXT DEFAULT 'Normal',
  fotos TEXT[] DEFAULT '{}'
);

-- Tabla de configuración
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- ════════════════════════════════════════════════
-- PERMISOS (Row Level Security)
-- ════════════════════════════════════════════════

ALTER TABLE registros ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lectura pública" ON registros FOR SELECT USING (true);
CREATE POLICY "Inserción pública" ON registros FOR INSERT WITH CHECK (true);
CREATE POLICY "Actualización pública" ON registros FOR UPDATE USING (true);

ALTER TABLE config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lectura config" ON config FOR SELECT USING (true);
CREATE POLICY "Escritura config" ON config FOR INSERT WITH CHECK (true);
CREATE POLICY "Actualización config" ON config FOR UPDATE USING (true);
```

4. Click en **"Run"** (botón verde)
5. Debe decir "Success. No rows returned" — eso es correcto

### 3. Crear el bucket de fotos

1. Ve al menú lateral → **Storage**
2. Click en **"New bucket"**
3. Nombre: `fotos`
4. **IMPORTANTE**: Activa **"Public bucket"** (el toggle)
5. Click **"Create bucket"**
6. Ahora haz click en el bucket `fotos` → **Policies** → **New Policy**
7. Selecciona **"For full customization"**
8. Policy name: `Acceso público fotos`
9. Allowed operations: marca **SELECT** e **INSERT**
10. Target roles: deja en `public`
11. En USING expression pon: `true`
12. En WITH CHECK expression pon: `true`
13. **Save**

### 4. Obtener las credenciales

1. Ve al menú lateral → **Settings** → **API**
2. Copia **Project URL** (algo como `https://abcdefg.supabase.co`)
3. Copia **anon public** key (empieza con `eyJ...`)

### 5. Configurar la app

1. Abre el archivo `db.js`
2. En las líneas 10-11, reemplaza:

```javascript
const SUPABASE_URL = 'https://TU-URL.supabase.co';      // ← pega tu URL aquí
const SUPABASE_ANON_KEY = 'eyJ...tu-anon-key-aqui...';   // ← pega tu key aquí
```

### 6. Subir a GitHub Pages

1. Sube los 7 archivos al repositorio de GitHub (raíz, sin carpetas)
2. Settings → Pages → Branch: main, / (root) → Save
3. Espera ~1 minuto y accede a tu URL

### 7. Primer uso

1. La app te pedirá crear un **PIN** (4+ dígitos)
2. Con ese PIN puedes crear y editar registros
3. Sin PIN: cualquiera puede **ver** y **descargar** los registros como PDF o CSV
4. Configura el nombre de la obra y residente en ⚙️

---

## Archivos

```
index.html      → UI completa
manifest.json   → Configuración PWA
sw.js           → Service Worker (offline)
app.js          → Lógica de la aplicación
db.js           → IndexedDB + Supabase (configurar URL aquí)
styles.css      → Estilos
README.md       → Este archivo
```

## Sin Supabase

Si no configuras Supabase, la app funciona al 100% con almacenamiento local (IndexedDB). Los datos solo estarán en el dispositivo del usuario y no se sincronizarán a la nube. Toda la funcionalidad (fotos, GPS, exportación, PIN) sigue funcionando.

## Créditos

Proyecto Lean Six Sigma Green Belt  
Universidad Tecmilenio · Chihuahua, México
