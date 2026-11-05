// =========================================================
// ESTADO GLOBAL Y FUNCIONES UTILITARIAS (state.js)
// =========================================================

const DEFAULT_GSHEET_URL = 'https://docs.google.com/spreadsheets/d/1WQ6FCsFy0nG9srQ4nZFQGrX0gM7CI0SMqLuyKvFdCp4/edit?usp=sharing';

const AppState = {
  currentWorkbook: null,
  currentFileName: 'Control_GoogleSheets.xlsx',
  excelMode: 'gsheet', // 'gsheet' | 'file' | 'paste' | 'supabase'
  googleSheetUrl: DEFAULT_GSHEET_URL,
  googleSheetUrl2: '',
  autoSyncTimer: null,
  lastSyncTime: null,
  currentFilter: 'all',

  sheetStartName: '',    // Hoja inicial seleccionada
  sheetEndName: '',      // Hoja final seleccionada
  rowStartFilter: null,  // Fila inicial (null = desde fila 1)
  rowEndFilter: null,    // Fila final (null = hasta el final)
  timeStartFilter: '',   // Hora inicial ej "08:00"
  timeEndFilter: '',     // Hora final ej "16:00"
  userSetSheetRange: false,

  selectedDay: 'auto',   // 'auto' | 'all' | '03/11' | '04/11' ...
  selectedShift: 'all',  // 'all' | nombre del turno
  userLockedDay: false,  // true si el usuario eligió manualmente un día en la botonera

  panelItems: [],
  excelItems: [],
  comparisonResults: [],
  currentVisibleRows: [],

  selectedRowKey: null,
  expandedDrops: {}, // Filas con el "drop" inline abierto
  manualChecks: {},  // Mapa de verificaciones manuales (OK)
  isModalOpen: false
};

// Formatea la referencia de fila incluyendo el nombre de la pestaña si hay varias hojas
function formatExcelRowRef(e) {
  if (!e) return '—';
  const multiSheets = AppState.currentWorkbook && AppState.currentWorkbook.SheetNames && AppState.currentWorkbook.SheetNames.length > 1;
  if (e.sheetName && multiSheets) {
    return `${e.sheetName} · Fila #${e.excelRowNumber}`;
  }
  return `Fila #${e.excelRowNumber}`;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Normaliza un monto escrito como "30.000", "2000", "$ 10.000,00" o número puro
// Ignora fechas como "03/11" para no confundirlas con montos
function parseAmount(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  let str = String(val).trim();
  if (!str) return 0;
  // Si contiene barra "/" (ej: fecha "03/11" o "3/11/2026") o dos puntos ":" (hora "15:30"), NO es un monto
  if (str.includes('/') || str.includes(':')) return 0;

  str = str.replace(/[^0-9.,-]/g, '');
  if (!str) return 0;

  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(str)) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(str)) {
    str = str.replace(/,/g, '');
  } else {
    str = str.replace(/\./g, '').replace(',', '.');
  }
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

// Extrae y normaliza una fecha como "3/11/2026 15:34", "03/11" o "4/11" al formato "DD/MM" (ej: "03/11", "04/11")
function extractNormalizedDay(val) {
  if (!val) return null;
  const str = String(val).trim();
  const m = str.match(/(?:^|\s|[-|·])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s|[-|·]|$)/);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
    return `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}`;
  }
  return null;
}

// Devuelve la lista de días únicos disponibles en Google Sheets y Panel (ordenados)
function getAvailableDays() {
  const daysSet = new Set();
  AppState.excelItems.forEach(item => {
    if (item.fechaDia && item.fechaDia !== 'Sin fecha') daysSet.add(item.fechaDia);
  });
  AppState.panelItems.forEach(item => {
    if (item.fechaDia && item.fechaDia !== 'Sin fecha') daysSet.add(item.fechaDia);
  });
  return Array.from(daysSet);
}

// Determina qué día está activo actualmente
function getResolvedActiveDay() {
  const days = getAvailableDays();
  if (days.length === 0) return 'all';

  if (AppState.selectedDay !== 'auto') {
    if (AppState.selectedDay === 'all') return 'all';
    if (days.includes(AppState.selectedDay)) return AppState.selectedDay;
  }

  // Si hay datos pegados en el Panel de un día específico, priorizar ese día automáticamente
  const panelDays = [...new Set(AppState.panelItems.map(p => p.fechaDia).filter(d => d && d !== 'Sin fecha'))];
  if (panelDays.length === 1) {
    return panelDays[0];
  }

  // Si no hay datos en el Panel, seleccionar por defecto el último día cargado en la hoja (ej: el día más nuevo)
  return days[days.length - 1];
}

// Convierte "HH:MM" a minutos del día (0..1439) o null si vacío
function parseTimeStrToMinutes(tStr) {
  if (!tStr) return null;
  const m = String(tStr).trim().match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (isNaN(hh) || isNaN(mm)) return null;
  return hh * 60 + mm;
}

function isMinutesWithinRange(mins, minStart, maxEnd) {
  if (minStart === null && maxEnd === null) return true;
  if (mins === null || mins === undefined || isNaN(mins)) return true;
  const s = minStart !== null ? minStart : 0;
  const e = maxEnd !== null ? maxEnd : 1439;
  if (s <= e) {
    return mins >= s && mins <= e;
  } else {
    // Rango nocturno que cruza medianoche (ej: 22:00 a 06:00)
    return mins >= s || mins <= e;
  }
}

// Obtiene los movimientos del Panel filtrados por el día activo y horario
function getActivePanelItems() {
  const activeDay = getResolvedActiveDay();
  const minT = parseTimeStrToMinutes(AppState.timeStartFilter);
  const maxT = parseTimeStrToMinutes(AppState.timeEndFilter);
  const base = activeDay === 'all'
    ? AppState.panelItems
    : AppState.panelItems.filter(p => p.fechaDia === activeDay || p.fechaDia === 'Sin fecha');
  if (minT === null && maxT === null) return base;
  return base.filter(p => isMinutesWithinRange(p.minutesOfDay, minT, maxT));
}

// Obtiene los movimientos de Google Sheets/Excel filtrados por el día activo y horario
function getActiveExcelItems() {
  const activeDay = getResolvedActiveDay();
  const minT = parseTimeStrToMinutes(AppState.timeStartFilter);
  const maxT = parseTimeStrToMinutes(AppState.timeEndFilter);
  const base = activeDay === 'all'
    ? AppState.excelItems
    : AppState.excelItems.filter(e => e.fechaDia === activeDay || e.fechaDia === 'Sin fecha');
  if (minT === null && maxT === null) return base;
  return base.filter(e => {
    const mins = e.hora ? parseTimeStrToMinutes(e.hora) : null;
    return isMinutesWithinRange(mins, minT, maxT);
  });
}

function formatMoney(num) {
  if (num === null || num === undefined || isNaN(num)) return '—';
  return '$ ' + Number(num).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

function normalizeUser(u) {
  if (!u) return '';
  return String(u)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

// Esqueleto fonético/de letras para detectar cuando el trabajador abrevia o comete un error de tipeo
function userSkeleton(u) {
  let s = normalizeUser(u);
  s = s.replace(/[._-]/g, '');
  s = s.replace(/(.)\1+/g, '$1');
  return s;
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function userSimilarity(u1, u2) {
  const n1 = normalizeUser(u1);
  const n2 = normalizeUser(u2);
  if (!n1 || !n2) return 0;
  if (n1 === n2) return 1.0;

  const s1 = userSkeleton(u1);
  const s2 = userSkeleton(u2);
  if (s1 === s2 && s1.length >= 4) return 0.96;

  const alpha1 = s1.replace(/[0-9]/g, '');
  const alpha2 = s2.replace(/[0-9]/g, '');
  if (alpha1 === alpha2 && alpha1.length >= 4) return 0.94;

  if (alpha1.length >= 5 && alpha2.length >= 5) {
    if (alpha1.startsWith(alpha2) || alpha2.startsWith(alpha1)) {
      return 0.91;
    }
  }

  const dist = levenshtein(s1, s2);
  const maxLen = Math.max(s1.length, s2.length);
  const ratio = maxLen > 0 ? 1 - dist / maxLen : 0;

  const distAlpha = levenshtein(alpha1, alpha2);
  const maxAlpha = Math.max(alpha1.length, alpha2.length);
  const ratioAlpha = maxAlpha >= 4 ? 1 - distAlpha / maxAlpha : 0;

  return Math.max(ratio, ratioAlpha * 0.95);
}

// Convierte fecha "3/11/2026 15:34" a minutos del día y timestamp
function parsePanelDateTime(fechaStr) {
  if (!fechaStr) return { minutesOfDay: 0, timestamp: 0, timeStr: '' };
  const m = String(fechaStr).trim().match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/);
  if (!m) return { minutesOfDay: 0, timestamp: 0, timeStr: fechaStr };
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  const hour = parseInt(m[4], 10);
  const min = parseInt(m[5], 10);
  const minutesOfDay = hour * 60 + min;
  const timestamp = new Date(year, month, day, hour, min).getTime();
  const timeStr = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  return { minutesOfDay, timestamp, timeStr };
}

// Formatea la columna Hora del Excel (convierte decimales de Excel como 0.010416666 a "00:15")
function formatExcelTime(rawVal) {
  if (rawVal === null || rawVal === undefined || rawVal === '') return { timeStr: '', minutesOfDay: null };
  if (typeof rawVal === 'number' || (/^0\.\d+$/.test(String(rawVal).trim()))) {
    const num = parseFloat(rawVal);
    if (!isNaN(num) && num >= 0 && num < 1) {
      const totalMins = Math.round(num * 24 * 60);
      const h = Math.floor(totalMins / 60) % 24;
      const m = totalMins % 60;
      return {
        timeStr: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
        minutesOfDay: h * 60 + m
      };
    }
  }
  const str = String(rawVal).trim();
  const match = str.match(/(\d{1,2}):(\d{2})/);
  if (match) {
    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    return {
      timeStr: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      minutesOfDay: h * 60 + m
    };
  }
  return { timeStr: str, minutesOfDay: null };
}
