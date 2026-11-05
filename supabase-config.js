// =========================================================
// CONFIGURACIÓN Y CLIENTE SUPABASE (supabase-config.js)
// Compartido entre cargas.html (Trabajadoras) e index.html (Verificador)
// =========================================================

// Puedes pegar aquí tus credenciales fijas antes de subirlo a GitHub Pages,
// o configurarlas desde el botón "⚙️ Configurar Supabase" en la pantalla.
const DEFAULT_SUPABASE_URL = 'https://wpopzwpfutjjymvecmax.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_aYeM_9GQ_PLgoSuChxAwPQ_p18NGWte';
const SUPABASE_TABLE = 'movimientos';

const LOCAL_STORAGE_MOVS_KEY = 'verificador_movimientos_local_v1';
const LOCAL_STORAGE_SB_URL_KEY = 'verificador_supabase_url';
const LOCAL_STORAGE_SB_KEY_KEY = 'verificador_supabase_anon_key';

function getSupabaseCredentials() {
  const url = (localStorage.getItem(LOCAL_STORAGE_SB_URL_KEY) || DEFAULT_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = (localStorage.getItem(LOCAL_STORAGE_SB_KEY_KEY) || DEFAULT_SUPABASE_ANON_KEY || '').trim();
  return { url, key, isConfigured: Boolean(url && key) };
}

function saveSupabaseCredentials(url, key) {
  localStorage.setItem(LOCAL_STORAGE_SB_URL_KEY, (url || '').trim().replace(/\/+$/, ''));
  localStorage.setItem(LOCAL_STORAGE_SB_KEY_KEY, (key || '').trim());
}

// Formatea fecha actual a "DD/MM" (ej: "04/11") y hora a "HH:MM" (ej: "20:45")
function getCurrentDateAndTime() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return {
    fechaDia: `${dd}/${mm}`,
    fechaCompleta: `${dd}/${mm}/${yyyy}`,
    hora: `${hh}:${min}`,
    iso: now.toISOString()
  };
}

// =========================================================
// OPERACIONES CRUD (SUPABASE REST API + FALLBACK LOCAL)
// =========================================================

// 1. Obtener movimientos (opcionalmente filtrados por fecha_dia y estado de borrado)
async function fetchMovimientosFromDB(fechaDiaFilter = null, includeDeleted = false) {
  const { url, key, isConfigured } = getSupabaseCredentials();

  if (isConfigured) {
    let endpoint = `${url}/rest/v1/${SUPABASE_TABLE}?select=*&order=id.desc`;
    if (!includeDeleted) {
      // Por defecto solo traer los no borrados (o donde borrado sea null/false)
      endpoint += `&or=(borrado.is.null,borrado.eq.false)`;
    }
    if (fechaDiaFilter && fechaDiaFilter !== 'all') {
      endpoint += `&fecha_dia=eq.${encodeURIComponent(fechaDiaFilter)}`;
    }
    const res = await fetch(endpoint, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      }
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Error Supabase (${res.status}): ${errText}`);
    }
    const data = await res.json();
    return { source: 'supabase', data };
  }

  // Modo Local (mientras no se haya configurado Supabase)
  const raw = localStorage.getItem(LOCAL_STORAGE_MOVS_KEY);
  let list = [];
  try {
    list = raw ? JSON.parse(raw) : [];
  } catch (e) {
    list = [];
  }
  if (!includeDeleted) {
    list = list.filter(item => !item.borrado);
  }
  if (fechaDiaFilter && fechaDiaFilter !== 'all') {
    list = list.filter(item => item.fecha_dia === fechaDiaFilter);
  }
  return { source: 'local', data: list };
}

// 2. Insertar nuevo movimiento (Carga o Retiro)
async function insertMovimientoInDB(payload) {
  const { url, key, isConfigured } = getSupabaseCredentials();
  const dt = getCurrentDateAndTime();

  const record = {
    tipo: payload.tipo === 'RETIRO' ? 'RETIRO' : 'DEPOSITO',
    usuario: String(payload.usuario || '').trim(),
    monto: Number(payload.monto) || 0,
    billetera: payload.tipo === 'RETIRO' ? String(payload.billetera || '').trim() : '',
    hora: payload.hora || dt.hora,
    fecha_dia: payload.fecha_dia || dt.fechaDia,
    turno: String(payload.turno || 'Turno Actual').trim(),
    verificado: false,
    borrado: false,
    editado_hora: ''
  };

  if (isConfigured) {
    const endpoint = `${url}/rest/v1/${SUPABASE_TABLE}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(record)
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`No se pudo guardar en Supabase: ${errText}`);
    }
    const inserted = await res.json();
    return { source: 'supabase', item: Array.isArray(inserted) ? inserted[0] : inserted };
  }

  // Fallback Local
  const raw = localStorage.getItem(LOCAL_STORAGE_MOVS_KEY);
  const list = raw ? JSON.parse(raw) : [];
  const localItem = {
    id: Date.now(),
    ...record,
    created_at: dt.iso
  };
  list.push(localItem);
  localStorage.setItem(LOCAL_STORAGE_MOVS_KEY, JSON.stringify(list));
  return { source: 'local', item: localItem };
}

// 3. Editar un movimiento existente por ID (registra editado_hora)
async function updateMovimientoInDB(id, changes) {
  const { url, key, isConfigured } = getSupabaseCredentials();
  const dt = getCurrentDateAndTime();

  const finalChanges = {
    ...changes,
    editado_hora: `${dt.hora} (${dt.fechaDia})`
  };

  if (isConfigured) {
    const endpoint = `${url}/rest/v1/${SUPABASE_TABLE}?id=eq.${encodeURIComponent(id)}`;
    const res = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(finalChanges)
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`No se pudo actualizar en Supabase: ${errText}`);
    }
    const updated = await res.json();
    return { source: 'supabase', item: Array.isArray(updated) ? updated[0] : updated };
  }

  // Fallback Local
  const raw = localStorage.getItem(LOCAL_STORAGE_MOVS_KEY);
  const list = raw ? JSON.parse(raw) : [];
  const idx = list.findIndex(x => String(x.id) === String(id));
  if (idx !== -1) {
    list[idx] = { ...list[idx], ...finalChanges };
    localStorage.setItem(LOCAL_STORAGE_MOVS_KEY, JSON.stringify(list));
    return { source: 'local', item: list[idx] };
  }
  throw new Error('Registro no encontrado');
}

// 4. Mandar a Papelera (soft delete: borrado = true)
async function softDeleteMovimientoInDB(id) {
  const dt = getCurrentDateAndTime();
  return updateMovimientoInDB(id, {
    borrado: true,
    editado_hora: `Borrado a las ${dt.hora} (${dt.fechaDia})`
  });
}

// 5. Restaurar desde Papelera
async function restoreMovimientoInDB(id) {
  const dt = getCurrentDateAndTime();
  return updateMovimientoInDB(id, {
    borrado: false,
    editado_hora: `Restaurado a las ${dt.hora} (${dt.fechaDia})`
  });
}

