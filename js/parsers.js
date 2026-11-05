// =========================================================
// PARSERS DE DATOS: PANEL, EXCEL Y GOOGLE SHEETS EN VIVO (parsers.js)
// =========================================================

// Patrones conocidos de textos de menú, filtros, encabezados, totales y pie de página de admin.celuapuestas.fans
function isKnownPanelNoiseLine(line) {
  const s = String(line || '').trim();
  if (!s) return true;
  const knownPatterns = [
    /^[a-z0-9_.-]+\s*\(\s*[-\d.,]+\s*\)$/i, // ej: naycelu543 (1.191.233 )
    /^(?:dashboard|usuarios|reportes|novedades|soporte|\s)+$/i,
    /^efectivo\s*\(dep[oó]sitos\s+y\s+retiros\)$/i,
    /^\/?\s*informes\s+financieros$/i,
    /^fecha\s+(?:desde|hasta)$/i,
    /^\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2})?$/, // fechas sueltas de los selectores "Fecha desde / Fecha hasta"
    /^(?:hrmin|hr|min)$/i,
    /^buscar\s+usuario$/i,
    /^solo\s+(?:directos|superiores|recibidas)(?:\s+solo\s+(?:directos|superiores|recibidas))*$/i,
    /^filtrando\s+desde\s+/i,
    /^(?:nro|fecha|operaci[oó]n|agente|destino|dep[oó]sito|retiro|saldo)(?:\s+(?:nro|fecha|operaci[oó]n|agente|destino|dep[oó]sito|retiro|saldo))*$/i,
    /^totales(?:\s+(?:dep[oó]sito|retiro|saldo)\s*:\s*[-\d.,]+)*$/i,
    /^(?:(?:dep[oó]sito|retiro|saldo)\s*:\s*[-\d.,]+\s*)+$/i,
    /^(?:««|«|»|»»|\d{1,3})(?:\s+(?:««|«|»|»»|\d{1,3}))*$/,
    /^(?:centro\s+de\s+ayuda|cont[aá]ctanos|\s)+$/i,
    /^legal$/i,
    /^(?:t[eé]rminos\s+y\s+condiciones|pol[ií]tica\s+de\s+privacidad|\s)+$/i,
    /^redes\s+sociales$/i,
    /^©\s*\d{4}.*derechos\s+reservados\.?$/i
  ];
  return knownPatterns.some(rx => rx.test(s));
}

function extractPanelMovementsAndDebug(raw) {
  if (!raw || !String(raw).trim()) {
    return {
      items: [],
      cleanLines: [],
      ignoredNoise: [],
      unknownLines: [],
      duplicatesRemoved: 0,
      internalReloadsIgnored: 0
    };
  }

  // 1. Quitar envoltorios de links Markdown [texto](https://...) por si se pegó con formato enriquecido
  let text = String(raw).replace(/\[([^\]]*)\]\(https?:\/\/[^\)]+\)/gi, '$1');

  // 2. Separar si quedaron dos registros pegados en la misma línea
  text = text.replace(/(\S)\s+([a-z0-9]{3,10}\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}\s+(?:DEPOSITO|DEPÓSITO|RETIRO))/gi, '$1\n$2');

  const rawRecords = [];

  // 3. Extraer todos los bloques de 8 campos (ya sea en 8 renglones por Ctrl+A, en 2 renglones o en 1 renglón con tabs)
  const recRegex8 = /(?:^|\s)([a-z0-9]{3,10})\s+(\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2})\s+((?:DEPOSITO|DEPÓSITO|RETIRO)(?:\s*\([^\)]*\))?)\s+(\S+)\s+(\S+)\s+([-\d.,]+)\s+([-\d.,]+)\s+([-\d.,]+)(?=\s|$)/gi;

  let remainder = text.replace(recRegex8, (full, id, fecha, operacionRaw, agente, destino, depStr, retStr, saldoStr) => {
    rawRecords.push({ id, fecha, operacionRaw, agente, destino, depStr, retStr, saldoStr });
    return '\n';
  });

  // 4. Fallback por si alguna fila se copió con 7 campos (sin columna Saldo al final)
  const recRegex7 = /(?:^|\s)([a-z0-9]{3,10})\s+(\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2})\s+((?:DEPOSITO|DEPÓSITO|RETIRO)(?:\s*\([^\)]*\))?)\s+(\S+)\s+(\S+)\s+([-\d.,]+)\s+([-\d.,]+)(?=\r?\n|$)/gi;

  remainder = remainder.replace(recRegex7, (full, id, fecha, operacionRaw, agente, destino, depStr, retStr) => {
    rawRecords.push({ id, fecha, operacionRaw, agente, destino, depStr, retStr, saldoStr: '0' });
    return '\n';
  });

  // 5. Clasificar las líneas sobrantes en "Basura conocida de la página" vs "Líneas desconocidas (Debug)"
  const remLines = remainder.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const ignoredNoise = [];
  const unknownLines = [];

  remLines.forEach(line => {
    if (isKnownPanelNoiseLine(line)) {
      ignoredNoise.push(line);
    } else {
      unknownLines.push(line);
    }
  });

  // 6. Construir objetos de movimiento, ignorando recargas internas al cajero y deduplicando si pegó 2 veces la misma página
  const items = [];
  const cleanLines = [];
  const seenKeys = new Set();
  let duplicatesRemoved = 0;
  let internalReloadsIgnored = 0;

  rawRecords.forEach((rec, idx) => {
    const dep = Math.abs(parseAmount(rec.depStr));
    const ret = Math.abs(parseAmount(rec.retStr));
    const saldo = parseAmount(rec.saldoStr);
    if (dep <= 0 && ret <= 0) return;

    const isRetiroOp = /RETIRO/i.test(rec.operacionRaw) || (ret > 0 && dep === 0);
    const tipo = isRetiroOp ? 'RETIRO' : 'DEPOSITO';
    const monto = tipo === 'RETIRO' ? ret : dep;

    // Ignorar recarga interna de fichas del administrador al cajero (ej: monaco0022 -> naycelu543)
    if (tipo === 'DEPOSITO' && normalizeUser(rec.destino) === 'naycelu543') {
      internalReloadsIgnored++;
      return;
    }

    // Deduplicar si el usuario pegó varias páginas y se repitió el mismo ID + fecha
    const dedupKey = `${rec.id.toLowerCase()}_${rec.fecha.trim()}_${monto}`;
    if (seenKeys.has(dedupKey)) {
      duplicatesRemoved++;
      return;
    }
    seenKeys.add(dedupKey);

    let playerUser = rec.destino;
    let agentUser = rec.agente;
    if (tipo === 'RETIRO' && normalizeUser(rec.destino) === 'naycelu543') {
      playerUser = rec.agente;
      agentUser = rec.destino;
    }

    const dt = parsePanelDateTime(rec.fecha);
    const fechaDia = extractNormalizedDay(rec.fecha) || 'Sin fecha';

    cleanLines.push(`${rec.id}\t${rec.fecha}\t${rec.operacionRaw}\t${rec.agente}\t${rec.destino}\t${rec.depStr}\t${rec.retStr}\t${rec.saldoStr}`);

    items.push({
      uid: `P_${idx}_${rec.id}`,
      id: rec.id,
      fecha: rec.fecha,
      fechaDia,
      timeStr: dt.timeStr,
      minutesOfDay: dt.minutesOfDay,
      timestamp: dt.timestamp,
      operacionRaw: rec.operacionRaw,
      tipo,
      agente: agentUser,
      usuarioOriginal: playerUser,
      usuarioNorm: normalizeUser(playerUser),
      deposito: dep,
      retiro: ret,
      monto,
      saldo
    });
  });

  return {
    items,
    cleanLines,
    ignoredNoise,
    unknownLines,
    duplicatesRemoved,
    internalReloadsIgnored
  };
}

function updatePanelDebugUI(debugInfo, rawText) {
  AppState.lastPanelDebug = debugInfo;
  const bar = document.getElementById('panelDebugBar');
  const summaryText = document.getElementById('panelDebugSummaryText');
  const box = document.getElementById('panelDebugBox');
  const statsEl = document.getElementById('panelDebugStats');
  const unknownWrap = document.getElementById('panelDebugUnknownWrap');
  const unknownList = document.getElementById('panelDebugUnknownList');
  const btnDebug = document.getElementById('btnTogglePanelDebug');

  if (!rawText || !String(rawText).trim()) {
    if (bar) bar.style.display = 'none';
    if (statsEl) statsEl.textContent = 'Todavía no pegaste datos en el Panel.';
    if (unknownWrap) unknownWrap.style.display = 'none';
    if (btnDebug) {
      btnDebug.textContent = '🛠️ Debug';
      btnDebug.style.borderColor = '#a78bfa';
      btnDebug.style.color = '#c4b5fd';
    }
    return;
  }

  const { items, ignoredNoise, unknownLines, duplicatesRemoved, internalReloadsIgnored } = debugInfo;

  if (statsEl) {
    statsEl.innerHTML = `
      • <strong style="color:#34d399;">Movimientos útiles detectados:</strong> ${items.length}<br/>
      • <strong style="color:#38bdf8;">Basura de la página filtrada (menú/totales/pie):</strong> ${ignoredNoise.length} línea(s)<br/>
      • <strong style="color:#cbd5e1;">Duplicados entre páginas ignorados:</strong> ${duplicatesRemoved} · Recargas internas cajero: ${internalReloadsIgnored}<br/>
      • <strong style="color:${unknownLines.length > 0 ? '#fbbf24' : '#34d399'};">Líneas/palabras desconocidas:</strong> ${unknownLines.length}
    `;
  }

  if (unknownLines.length > 0) {
    if (bar) {
      bar.style.display = 'flex';
      bar.style.background = 'rgba(245, 158, 11, 0.16)';
      bar.style.border = '1px solid rgba(245, 158, 11, 0.5)';
      bar.style.color = '#fde68a';
    }
    if (summaryText) {
      summaryText.innerHTML = `⚠️ <strong>Alerta Debug:</strong> Quedaron <strong>${unknownLines.length}</strong> línea(s) o palabra(s) sin reconocer (${items.length} mov. leídos)`;
    }
    if (unknownWrap && unknownList) {
      unknownWrap.style.display = 'block';
      unknownList.textContent = unknownLines.map((l, i) => `[${i + 1}] ${l}`).join('\n');
    }
    if (box) box.style.display = 'block';
    if (btnDebug) {
      btnDebug.textContent = `⚠️ Debug (${unknownLines.length})`;
      btnDebug.style.borderColor = '#f59e0b';
      btnDebug.style.color = '#fde68a';
    }
  } else {
    if (unknownWrap) unknownWrap.style.display = 'none';
    if (btnDebug) {
      btnDebug.textContent = '🛠️ Debug (OK)';
      btnDebug.style.borderColor = '#34d399';
      btnDebug.style.color = '#6ee7b7';
    }
    if (ignoredNoise.length > 0 || duplicatesRemoved > 0) {
      if (bar) {
        bar.style.display = 'flex';
        bar.style.background = 'rgba(16, 185, 129, 0.12)';
        bar.style.border = '1px solid rgba(16, 185, 129, 0.35)';
        bar.style.color = '#6ee7b7';
      }
      if (summaryText) {
        summaryText.innerHTML = `✅ <strong>Limpieza automática OK:</strong> ${items.length} movimientos útiles (${ignoredNoise.length} líneas de página eliminadas${duplicatesRemoved > 0 ? ` · ${duplicatesRemoved} duplicados quitados` : ''})`;
      }
    } else if (bar) {
      bar.style.display = 'none';
    }
  }
}

function togglePanelDebugBox() {
  const box = document.getElementById('panelDebugBox');
  if (!box) return;
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

function copyPanelDebugReport() {
  const dbg = AppState.lastPanelDebug;
  if (!dbg) {
    showToast('No hay datos de debug para copiar');
    return;
  }
  const report = [
    '=== REPORTE DEBUG PANEL ===',
    `Movimientos leídos: ${dbg.items.length}`,
    `Líneas de página filtradas: ${dbg.ignoredNoise.length}`,
    `Duplicados quitados: ${dbg.duplicatesRemoved}`,
    `Líneas NO reconocidas (${dbg.unknownLines.length}):`,
    ...(dbg.unknownLines.length > 0 ? dbg.unknownLines : ['(Ninguna - Todo reconocido correctamente)'])
  ].join('\n');

  navigator.clipboard.writeText(report).then(() => {
    showToast('📋 Reporte Debug copiado al portapapeles');
  });
}

function cleanPanelInputInPlace(showMsg = false) {
  const panelInput = document.getElementById('panelInput');
  if (!panelInput || !panelInput.value.trim()) return;

  const res = extractPanelMovementsAndDebug(panelInput.value);
  if (res.cleanLines.length > 0) {
    // Si quedó alguna línea desconocida, la conservamos al final para que el Debug la siga mostrando hasta que el usuario decida
    const extra = res.unknownLines.length > 0 ? '\n' + res.unknownLines.join('\n') : '';
    panelInput.value = res.cleanLines.join('\n') + extra;
    parsePanelInput();
    runComparison();
    if (showMsg) {
      showToast(`✨ Texto limpio: quedaron solo los ${res.items.length} movimientos útiles`);
    }
  } else if (showMsg) {
    showToast('⚠️ No se detectaron movimientos válidos para limpiar');
  }
}

function parsePanelInput() {
  const panelInput = document.getElementById('panelInput');
  const raw = panelInput ? panelInput.value : '';

  const res = extractPanelMovementsAndDebug(raw);
  const items = res.items;

  updatePanelDebugUI(res, raw);

  // Ordenar cronológicamente de 00:00 a 23:59
  items.sort((a, b) => a.timestamp - b.timestamp || a.minutesOfDay - b.minutesOfDay);

  AppState.panelItems = items;

  // Si el usuario acaba de pegar movimientos de un día específico y no bloqueó manualmente otro día, activar ese día
  const panelDays = [...new Set(items.map(i => i.fechaDia).filter(d => d && d !== 'Sin fecha'))];
  if (panelDays.length === 1 && !AppState.userLockedDay) {
    AppState.selectedDay = panelDays[0];
  }

  const badge = document.getElementById('panelCountBadge');
  if (badge) badge.textContent = `${items.length} movimiento(s)`;
  const pill = document.getElementById('pillPanelCount');
  if (pill) pill.textContent = items.length;
}

// Auto-limpiar en el acto cuando el usuario pega toda la página con Ctrl+V (dejando solo las filas útiles en la caja)
window.addEventListener('DOMContentLoaded', () => {
  const panelInput = document.getElementById('panelInput');
  if (panelInput) {
    panelInput.addEventListener('paste', () => {
      setTimeout(() => {
        const raw = panelInput.value;
        const res = extractPanelMovementsAndDebug(raw);
        if (res.items.length > 0 && (res.ignoredNoise.length > 0 || raw.split(/\r?\n/).length > res.items.length * 2)) {
          const extra = res.unknownLines.length > 0 ? '\n' + res.unknownLines.join('\n') : '';
          panelInput.value = res.cleanLines.join('\n') + extra;
          parsePanelInput();
          updatePanelDebugUI(res, raw); // Mantener el conteo de cuánta basura se acaba de filtrar en el aviso
          runComparison();
        }
      }, 30);
    });
  }
});

// =========================================================
// CONEXIÓN EN VIVO CON GOOGLE SHEETS
// =========================================================
function extractGoogleSheetId(url) {
  if (!url) return null;
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

function toggleSecondGsheetUrl() {
  const box = document.getElementById('secondGsheetUrlBox');
  if (!box) return;
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

function clearSecondGsheetUrl() {
  const inp = document.getElementById('gsheetUrlInput2');
  if (inp) inp.value = '';
  const box = document.getElementById('secondGsheetUrlBox');
  if (box) box.style.display = 'none';
  syncGoogleSheet(false);
}

async function syncGoogleSheet(silent = false) {
  const urlInput = document.getElementById('gsheetUrlInput');
  const url = urlInput ? urlInput.value.trim() : AppState.googleSheetUrl;
  AppState.googleSheetUrl = url;

  const urlInput2 = document.getElementById('gsheetUrlInput2');
  const url2 = urlInput2 ? urlInput2.value.trim() : '';
  AppState.googleSheetUrl2 = url2;

  const sheetId = extractGoogleSheetId(url);
  if (!sheetId) {
    showToast('⚠️ El link de Google Sheets no es válido');
    return;
  }

  const syncBtn = document.getElementById('btnSyncGsheet');
  const statusEl = document.getElementById('gsheetStatusText');
  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.innerHTML = '⏳ Sincronizando...';
  }
  if (statusEl) {
    statusEl.textContent = 'Conectando con Google Sheets en vivo...';
  }

  try {
    // Descargar el libro completo (.xlsx) directamente desde Google Sheets con cache-busting
    const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx&t=${Date.now()}`;
    const response = await fetch(exportUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    const mainWb = XLSX.read(data, { type: 'array' });

    // Si hay un 2do enlace de Google Sheets configurado, descargarlo y anexar sus hojas
    const sheetId2 = extractGoogleSheetId(url2);
    if (sheetId2 && sheetId2 !== sheetId) {
      try {
        const exportUrl2 = `https://docs.google.com/spreadsheets/d/${sheetId2}/export?format=xlsx&t=${Date.now()}`;
        const res2 = await fetch(exportUrl2);
        if (res2.ok) {
          const ab2 = await res2.arrayBuffer();
          const wb2 = XLSX.read(new Uint8Array(ab2), { type: 'array' });
          wb2.SheetNames.forEach(sName => {
            let targetName = `Link2 · ${sName}`;
            if (mainWb.SheetNames.includes(targetName)) {
              targetName = `Link2_${Date.now()} · ${sName}`;
            }
            mainWb.SheetNames.push(targetName);
            mainWb.Sheets[targetName] = wb2.Sheets[sName];
          });
        }
      } catch (e2) {
        console.warn('No se pudo cargar el 2do link de Google Sheets:', e2);
      }
    }

    AppState.currentWorkbook = mainWb;
    AppState.currentFileName = 'Control_GoogleSheets.xlsx';

    populateSheetSelector();
    onSheetChange();

    const now = new Date();
    const timeStr = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    AppState.lastSyncTime = timeStr;

    const totalSheets = mainWb.SheetNames.length;
    if (statusEl) {
      statusEl.innerHTML = `🟢 Conectado en vivo (${totalSheets} hoja${totalSheets > 1 ? 's' : ''}) · Actualizado: <strong>${timeStr}</strong> (${AppState.excelItems.length} mov.)`;
    }
    if (!silent) {
      showToast(`🔄 Google Sheets sincronizado (${AppState.excelItems.length} movimientos en ${totalSheets} hoja${totalSheets > 1 ? 's' : ''})`);
    }
  } catch (err) {
    // Fallback automático por JSONP si se abre desde un entorno sin CORS para fetch
    syncGoogleSheetViaJsonp(sheetId, silent);
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.innerHTML = '🔄 Sincronizar Ahora';
    }
  }
}

function syncGoogleSheetViaJsonp(sheetId, silent) {
  const statusEl = document.getElementById('gsheetStatusText');
  window.__onGvizLoaded = function(json) {
    if (!json || !json.table || !json.table.rows) {
      if (statusEl) statusEl.textContent = '❌ No se pudo leer la hoja. Verifica que esté pública.';
      return;
    }
    const rows = json.table.rows.map(r => {
      if (!r || !r.c) return [];
      return r.c.map(cell => {
        if (!cell) return '';
        return cell.f !== undefined && cell.f !== null ? String(cell.f) : (cell.v ?? '');
      });
    });

    // Construir un workbook compatible para poder exportar también
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Hoja 1');
    AppState.currentWorkbook = wb;
    AppState.currentFileName = 'Control_GoogleSheets.xlsx';

    populateSheetSelector();
    onSheetChange();

    const timeStr = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (statusEl) {
      statusEl.innerHTML = `🟢 Conectado en vivo · Última actualización: <strong>${timeStr}</strong> (${AppState.excelItems.length} movimientos)`;
    }
    if (!silent) {
      showToast(`🔄 Google Sheets sincronizado (${AppState.excelItems.length} movimientos)`);
    }
  };

  const oldScript = document.getElementById('gvizJsonpScript');
  if (oldScript) oldScript.remove();
  const s = document.createElement('script');
  s.id = 'gvizJsonpScript';
  s.src = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?headers=0&tqx=responseHandler:__onGvizLoaded&t=${Date.now()}`;
  document.body.appendChild(s);
}

function toggleAutoSync(enabled) {
  if (AppState.autoSyncTimer) {
    clearInterval(AppState.autoSyncTimer);
    AppState.autoSyncTimer = null;
  }
  if (enabled) {
    syncGoogleSheet(true);
    AppState.autoSyncTimer = setInterval(() => {
      if (AppState.excelMode === 'gsheet') {
        syncGoogleSheet(true);
      }
    }, 30000);
    showToast('⏱️ Auto-sincronización activada (cada 30 seg)');
  } else {
    showToast('⏸️ Auto-sincronización desactivada');
  }
}

function openGoogleSheetInTab() {
  const urlInput = document.getElementById('gsheetUrlInput');
  const url = urlInput ? urlInput.value.trim() : AppState.googleSheetUrl;
  if (url) window.open(url, '_blank');
}

function populateTimeAndRowSelectors(items = []) {
  const tStart = document.getElementById('timeStartSelect');
  const tEnd = document.getElementById('timeEndSelect');
  const rowList = document.getElementById('excelRowSuggestions');

  // Construir lista de horarios cada 30 min + horarios exactos presentes en la planilla
  const timeSet = new Set();
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, '0');
    timeSet.add(`${hh}:00`);
    timeSet.add(`${hh}:30`);
  }
  timeSet.add('23:59');

  items.forEach(it => {
    if (it.hora && /^\d{1,2}:\d{2}$/.test(it.hora.trim())) {
      const parts = it.hora.trim().split(':');
      timeSet.add(`${ parts[0].padStart(2, '0') }:${ parts[1] }`);
    }
  });

  const sortedTimes = Array.from(timeSet).sort();

  if (tStart) {
    const prevS = AppState.timeStartFilter || tStart.value || '';
    tStart.innerHTML = `<option value="">00:00 (Inicio)</option>` +
      sortedTimes.map(t => `<option value="${t}">${t} hs</option>`).join('');
    tStart.value = prevS;
  }

  if (tEnd) {
    const prevE = AppState.timeEndFilter || tEnd.value || '';
    tEnd.innerHTML = `<option value="">23:59 (Final)</option>` +
      sortedTimes.map(t => `<option value="${t}">${t} hs</option>`).join('');
    tEnd.value = prevE;
  }

  if (rowList) {
    const rowOpts = [];
    const seenRows = new Set();
    const addRowOpt = (num, label) => {
      if (!num || seenRows.has(num)) return;
      seenRows.add(num);
      rowOpts.push(`<option value="${num}">${escapeHtml(label)}</option>`);
    };

    addRowOpt(1, 'Fila #1 (Inicio de hoja)');
    // Agregar filas donde empieza cada día o turno
    let lastShiftKey = '';
    items.forEach(it => {
      const key = `${it.sheetName || ''} - ${it.fechaDia || ''} · ${it.turno || ''}`;
      if (key !== lastShiftKey && it.excelRowNumber) {
        lastShiftKey = key;
        addRowOpt(it.excelRowNumber, `Fila #${it.excelRowNumber} (${key})`);
      }
    });

    // Agregar saltos cada 100 filas como guía rápida
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].forEach(n => {
      addRowOpt(n, `Fila #${n}`);
    });

    if (items.length > 0) {
      const lastIt = items[items.length - 1];
      addRowOpt(lastIt.excelRowNumber, `Fila #${lastIt.excelRowNumber} (Última con datos)`);
    }

    rowList.innerHTML = rowOpts.join('');
  }
}

function populateSheetSelector() {
  populateTimeAndRowSelectors(AppState.excelItems || []);
  if (!AppState.currentWorkbook) return;
  const names = AppState.currentWorkbook.SheetNames || [];
  if (names.length === 0) return;

  const wrap = document.getElementById('sheetSelectorWrap');
  if (wrap) wrap.style.display = 'none';

  const sheetSelect = document.getElementById('sheetSelect');
  const startSel = document.getElementById('sheetStartSelect');
  const endSel = document.getElementById('sheetEndSelect');

  if (sheetSelect) {
    const prevVal = sheetSelect.value;
    sheetSelect.innerHTML = '';
    names.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sheetSelect.appendChild(opt);
    });
    if (prevVal && names.includes(prevVal)) sheetSelect.value = prevVal;
  }

  if (startSel && endSel) {
    const prevStart = AppState.sheetStartName || startSel.value;
    const prevEnd = AppState.sheetEndName || endSel.value;

    startSel.innerHTML = '';
    endSel.innerHTML = '';
    names.forEach((name, idx) => {
      const sheetObj = AppState.currentWorkbook.Sheets[name];
      const rowsArr = sheetObj ? XLSX.utils.sheet_to_json(sheetObj, { header: 1, defval: '', raw: false }) : [];
      const rowCountLabel = rowsArr.length > 0 ? ` (${rowsArr.length} filas)` : '';

      const o1 = document.createElement('option');
      o1.value = name;
      o1.textContent = `${idx + 1}. ${name}${rowCountLabel}`;
      startSel.appendChild(o1);

      const o2 = document.createElement('option');
      o2.value = name;
      o2.textContent = `${idx + 1}. ${name}${rowCountLabel}`;
      endSel.appendChild(o2);
    });

    if (AppState.userSetSheetRange && prevStart && names.includes(prevStart) && prevEnd && names.includes(prevEnd)) {
      startSel.value = prevStart;
      endSel.value = prevEnd;
    } else {
      // Por defecto: seleccionar desde la primera hoja hasta la última hoja para unir todas las hojas
      startSel.value = names[0];
      endSel.value = names[names.length - 1];
      AppState.sheetStartName = names[0];
      AppState.sheetEndName = names[names.length - 1];
    }
  }

  renderQuickSheetButtons();

  const fileLabel = document.getElementById('fileNameLabel');
  if (fileLabel) fileLabel.textContent = AppState.currentFileName;
  const metaBar = document.getElementById('excelMetaBar');
  if (metaBar) metaBar.style.display = 'flex';
}

function renderQuickSheetButtons() {
  const wrap = document.getElementById('quickSheetButtons');
  if (!wrap || !AppState.currentWorkbook) return;
  const names = AppState.currentWorkbook.SheetNames || [];
  if (names.length <= 1) {
    wrap.innerHTML = `<span class="mini-pill">1 pestaña (${escapeHtml(names[0] || 'Hoja 1')})</span>`;
    return;
  }

  const startSel = document.getElementById('sheetStartSelect');
  const endSel = document.getElementById('sheetEndSelect');
  const currStart = startSel ? startSel.value : names[0];
  const currEnd = endSel ? endSel.value : names[names.length - 1];
  const isAllSelected = (currStart === names[0] && currEnd === names[names.length - 1]);

  const btns = [];
  btns.push(`
    <button
      type="button"
      class="tab-btn ${isAllSelected ? 'active' : ''}"
      onclick="selectQuickSheetRange('${escapeHtml(names[0])}', '${escapeHtml(names[names.length - 1])}', true)"
      style="padding: 3px 9px; font-size: 0.74rem;"
      title="Leer y unir todas las pestañas de la planilla al mismo tiempo"
    >
      📚 Todas las Hojas (${names.length})
    </button>
  `);

  names.forEach(n => {
    const isSingle = (currStart === n && currEnd === n);
    btns.push(`
      <button
        type="button"
        class="tab-btn ${isSingle ? 'active' : ''}"
        onclick="selectQuickSheetRange('${escapeHtml(n)}', '${escapeHtml(n)}', false)"
        style="padding: 3px 9px; font-size: 0.74rem;"
        title="Leer únicamente la pestaña ${escapeHtml(n)}"
      >
        📄 Solo ${escapeHtml(n)}
      </button>
    `);
  });

  wrap.innerHTML = btns.join('');
}

function selectQuickSheetRange(startName, endName, isAll) {
  const startSel = document.getElementById('sheetStartSelect');
  const endSel = document.getElementById('sheetEndSelect');
  if (startSel) startSel.value = startName;
  if (endSel) endSel.value = endName;
  AppState.sheetStartName = startName;
  AppState.sheetEndName = endName;
  AppState.userSetSheetRange = true;
  onRangeOrSheetChange();
  showToast(isAll ? '📚 Usando todas las hojas unificadas' : `📄 Filtrado solo a: ${startName}`);
}

function resetSheetAndRowRange() {
  if (!AppState.currentWorkbook) return;
  const names = AppState.currentWorkbook.SheetNames || [];
  const startSel = document.getElementById('sheetStartSelect');
  const endSel = document.getElementById('sheetEndSelect');
  const rStart = document.getElementById('rowStartInput');
  const rEnd = document.getElementById('rowEndInput');
  const tStart = document.getElementById('timeStartSelect');
  const tEnd = document.getElementById('timeEndSelect');

  if (startSel && names.length > 0) startSel.value = names[0];
  if (endSel && names.length > 0) endSel.value = names[names.length - 1];
  if (rStart) rStart.value = '';
  if (rEnd) rEnd.value = '';
  if (tStart) tStart.value = '';
  if (tEnd) tEnd.value = '';

  AppState.timeStartFilter = '';
  AppState.timeEndFilter = '';
  AppState.userSetSheetRange = false;
  onRangeOrSheetChange();
  showToast('🔄 Rango restablecido: leyendo todas las hojas, filas y horarios');
}

// =========================================================
// PARSER DE ARCHIVO EXCEL LOCAL (.xlsx / .csv) Y RANGOS
// =========================================================
function handleExcelFile(file) {
  AppState.currentFileName = file.name;
  document.getElementById('dropzoneTitle').textContent = `Archivo cargado: ${file.name}`;

  const reader = new FileReader();
  reader.onload = function(e) {
    const data = new Uint8Array(e.target.result);
    AppState.currentWorkbook = XLSX.read(data, { type: 'array' });
    AppState.userSetSheetRange = false;
    populateSheetSelector();
    onSheetChange();
    showToast(`📊 Excel "${file.name}" cargado correctamente`);
  };
  reader.readAsArrayBuffer(file);
}

function onRangeOrSheetChange() {
  AppState.userSetSheetRange = true;
  onSheetChange();
}

function onSheetChange() {
  if (!AppState.currentWorkbook) return;
  const names = AppState.currentWorkbook.SheetNames || [];
  if (names.length === 0) return;

  const startSel = document.getElementById('sheetStartSelect');
  const endSel = document.getElementById('sheetEndSelect');
  const rStartEl = document.getElementById('rowStartInput');
  const rEndEl = document.getElementById('rowEndInput');
  const tStartEl = document.getElementById('timeStartSelect');
  const tEndEl = document.getElementById('timeEndSelect');

  const startName = (startSel && startSel.value) ? startSel.value : names[0];
  const endName = (endSel && endSel.value) ? endSel.value : names[names.length - 1];

  AppState.sheetStartName = startName;
  AppState.sheetEndName = endName;
  AppState.timeStartFilter = tStartEl ? tStartEl.value : '';
  AppState.timeEndFilter = tEndEl ? tEndEl.value : '';

  const rawStartRow = rStartEl && rStartEl.value ? parseInt(rStartEl.value, 10) : null;
  const rawEndRow = rEndEl && rEndEl.value ? parseInt(rEndEl.value, 10) : null;

  const minRowFilter = (rawStartRow && !isNaN(rawStartRow) && rawStartRow >= 1) ? rawStartRow : 1;
  const maxRowFilter = (rawEndRow && !isNaN(rawEndRow) && rawEndRow >= 1) ? rawEndRow : Infinity;

  AppState.rowStartFilter = minRowFilter > 1 ? minRowFilter : null;
  AppState.rowEndFilter = maxRowFilter !== Infinity ? maxRowFilter : null;

  renderQuickSheetButtons();

  const idxA = Math.max(0, names.indexOf(startName));
  const idxB = Math.max(0, names.indexOf(endName));
  const minSheetIdx = Math.min(idxA, idxB);
  const maxSheetIdx = Math.max(idxA, idxB);

  const combinedParsed = [];
  let carryDate = 'Sin fecha';
  let carryShift = 'Turno Inicial';

  // Recorremos desde la primera hoja hasta maxSheetIdx para conservar la continuidad de Fecha y Turno
  for (let sIdx = 0; sIdx <= maxSheetIdx; sIdx++) {
    const sName = names[sIdx];
    const sheet = AppState.currentWorkbook.Sheets[sName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

    const includeSheet = (sIdx >= minSheetIdx && sIdx <= maxSheetIdx);
    const sheetMinRow = (sIdx === minSheetIdx) ? minRowFilter : 1;
    const sheetMaxRow = (sIdx === maxSheetIdx) ? maxRowFilter : Infinity;

    const res = extractItemsFromSheetRows(rows, {
      sheetName: sName,
      sheetIndex: sIdx,
      initialDate: carryDate,
      initialShift: carryShift,
      includeInOutput: includeSheet,
      minRowNum: sheetMinRow,
      maxRowNum: sheetMaxRow
    });

    carryDate = res.lastDate;
    carryShift = res.lastShift;
    if (includeSheet && res.items.length > 0) {
      combinedParsed.push(...res.items);
    }
  }

  AppState.excelItems = combinedParsed;
  populateTimeAndRowSelectors(combinedParsed);

  // Actualizar resumen visual del rango configurado en la cabecera plegable
  const summaryEl = document.getElementById('quickRangeSummary');
  if (summaryEl) {
    if (minSheetIdx === 0 && maxSheetIdx === names.length - 1 && minRowFilter === 1 && maxRowFilter === Infinity && !AppState.timeStartFilter && !AppState.timeEndFilter) {
      summaryEl.textContent = `Todas las hojas (${names.length})`;
    } else {
      const sheetTxt = (startName === endName) ? startName : `${startName} ➔ ${endName}`;
      const rowTxt = (minRowFilter > 1 || maxRowFilter !== Infinity) ? ` · Filas #${minRowFilter}–#${maxRowFilter === Infinity ? 'Fin' : maxRowFilter}` : '';
      const timeTxt = (AppState.timeStartFilter || AppState.timeEndFilter) ? ` · ${AppState.timeStartFilter || '00:00'} a ${AppState.timeEndFilter || '23:59'}` : '';
      summaryEl.textContent = `${sheetTxt}${rowTxt}${timeTxt}`;
    }
  }

  const badge = document.getElementById('excelCountBadge');
  if (badge) badge.textContent = `${combinedParsed.length} movimiento(s) válido(s)`;
  const pill = document.getElementById('pillExcelCount');
  if (pill) pill.textContent = combinedParsed.length;

  runComparison();
}

function parseExcelPaste() {
  const el = document.getElementById('excelPasteInput');
  const raw = el ? el.value : '';
  const rows = raw.split(/\r?\n/).map(line => line.split('\t'));
  parseExcelRowsArray(rows);
}

function parseExcelRowsArray(rows) {
  if (!rows || rows.length === 0) {
    AppState.excelItems = [];
    document.getElementById('excelCountBadge').textContent = '0 registros';
    document.getElementById('pillExcelCount').textContent = '0';
    return;
  }

  const res = extractItemsFromSheetRows(rows, {
    sheetName: 'Hoja 1',
    sheetIndex: 0,
    initialDate: 'Sin fecha',
    initialShift: 'Turno Inicial',
    includeInOutput: true,
    minRowNum: 1,
    maxRowNum: Infinity
  });

  AppState.excelItems = res.items;
  const badge = document.getElementById('excelCountBadge');
  if (badge) badge.textContent = `${res.items.length} movimiento(s) válido(s)`;
  const pill = document.getElementById('pillExcelCount');
  if (pill) pill.textContent = res.items.length;
}

function extractItemsFromSheetRows(rows, opts = {}) {
  const sheetName = opts.sheetName || 'Hoja 1';
  const sheetIndex = opts.sheetIndex || 0;
  let currentDate = opts.initialDate || 'Sin fecha';
  let currentShift = opts.initialShift || 'Turno Inicial';
  const includeInOutput = opts.includeInOutput !== false;
  const minRowNum = opts.minRowNum || 1;
  const maxRowNum = opts.maxRowNum || Infinity;

  if (!rows || rows.length === 0) {
    return { items: [], lastDate: currentDate, lastShift: currentShift };
  }

  let colUsuario = 0;
  let colCarga = 1;
  let colRetiro = 2;
  let colHora = 3;
  let colBilletera = 4;
  let colOk = 5;
  let startRow = 0;

  for (let r = 0; r < Math.min(5, rows.length); r++) {
    const rowStr = rows[r].map(c => String(c).trim().toLowerCase());
    const uIdx = rowStr.findIndex(c => c.includes('usuario') || c.includes('cliente') || c.includes('destino'));
    const cIdx = rowStr.findIndex(c => c.includes('carga') || c.includes('deposito') || c.includes('depósito'));
    if (uIdx !== -1 && cIdx !== -1) {
      colUsuario = uIdx;
      colCarga = cIdx;
      const rIdx = rowStr.findIndex(c => c.includes('retiro'));
      const hIdx = rowStr.findIndex(c => c.includes('hora') || c.includes('fecha'));
      const bIdx = rowStr.findIndex(c => c.includes('billetera') || c.includes('banco'));
      const oIdx = rowStr.findIndex(c => c === 'ok' || c.includes('verif') || c.includes('estado'));

      if (rIdx !== -1) colRetiro = rIdx;
      if (hIdx !== -1) colHora = hIdx;
      if (bIdx !== -1) colBilletera = bIdx;
      if (oIdx !== -1) colOk = oIdx;
      startRow = r + 1;
      break;
    }
  }

  // Si aún no venía fecha arrastrada de una hoja anterior, pre-escanear las primeras 25 filas
  if (currentDate === 'Sin fecha') {
    for (let r = startRow; r < Math.min(startRow + 25, rows.length); r++) {
      const row = rows[r];
      if (!row) continue;
      for (let c = 0; c < 4; c++) {
        const d = extractNormalizedDay(row[c]);
        if (d) {
          currentDate = d;
          break;
        }
      }
      if (currentDate !== 'Sin fecha') break;
    }
  }

  const parsed = [];

  for (let r = startRow; r < rows.length; r++) {
    const excelRowNumber = r + 1;
    if (excelRowNumber > maxRowNum) break;

    const row = rows[r];
    if (!row || row.length === 0) continue;

    const rawUser = String(row[colUsuario] ?? '').trim();
    const rawCarga = row[colCarga];
    const rawRetiro = row[colRetiro];
    const rawHora = row[colHora];
    const rawBilletera = String(row[colBilletera] ?? '').trim();
    const rawOk = String(row[colOk] ?? '').trim();

    if (!rawUser && !rawCarga && !rawRetiro) continue;

    const carga = Math.abs(parseAmount(rawCarga));
    const retiro = Math.abs(parseAmount(rawRetiro));

    // Si no tiene monto válido de Carga ni de Retiro, es una fila separadora de Fecha o Turno
    if (carga <= 0 && retiro <= 0) {
      const cells = [rawUser, rawCarga, rawRetiro, rawHora].map(x => String(x ?? '').trim()).filter(Boolean);
      for (const cellText of cells) {
        const detectedDay = extractNormalizedDay(cellText);
        if (detectedDay) {
          currentDate = detectedDay;
          break;
        }
      }
      const shiftLabel = cells.join(' · ');
      if (shiftLabel) currentShift = shiftLabel;
      continue;
    }

    if (!rawUser) continue;

    // Si la fila está antes del inicio solicitado o la hoja solo se escaneó por continuidad de fecha/turno, no agregar
    if (!includeInOutput || excelRowNumber < minRowNum) continue;

    const tipo = retiro > 0 && carga === 0 ? 'RETIRO' : 'DEPOSITO';
    const monto = tipo === 'RETIRO' ? retiro : carga;

    let timeCellVal = rawHora;
    if ((!timeCellVal || String(timeCellVal).trim() === '') && tipo === 'DEPOSITO' && rawRetiro && String(rawRetiro).includes(':')) {
      timeCellVal = rawRetiro;
    }
    const formattedTime = formatExcelTime(timeCellVal);

    const uid = `E_${sheetName}_row_${excelRowNumber}_${normalizeUser(rawUser)}_${monto}`;
    if (['ok', 'si', 'sí', '✓', '1', 'x'].includes(rawOk.toLowerCase())) {
      if (AppState.manualChecks[uid] === undefined) {
        AppState.manualChecks[uid] = true;
      }
    }

    parsed.push({
      uid,
      sheetName,
      sheetIndex,
      excelRowNumber,
      rowIndex0: r,
      colOkIndex: colOk,
      fechaDia: currentDate,
      turno: currentShift,
      usuarioOriginal: rawUser,
      usuarioNorm: normalizeUser(rawUser),
      carga,
      retiro,
      tipo,
      monto,
      hora: formattedTime.timeStr,
      minutesOfDay: formattedTime.minutesOfDay,
      billetera: rawBilletera,
      okOriginal: rawOk
    });
  }

  return { items: parsed, lastDate: currentDate, lastShift: currentShift };
}

// =========================================================
// SINCRONIZACIÓN CON SUPABASE / CARGAS.HTML
// =========================================================
function syncActiveWorkerSource(silent = false) {
  if (AppState.excelMode === 'supabase') {
    syncSupabaseMovimientos(silent);
  } else {
    syncGoogleSheet(silent);
  }
}

async function syncSupabaseMovimientos(silent = false) {
  const statusEl = document.getElementById('supabaseVerifierStatus');
  if (statusEl) statusEl.textContent = '⏳ Trayendo movimientos de trabajadoras...';

  try {
    const res = await fetchMovimientosFromDB('all');
    const list = res.data || [];

    const parsed = list.map((m, idx) => {
      const isRetiro = m.tipo === 'RETIRO';
      const monto = Number(m.monto) || 0;
      const carga = isRetiro ? 0 : monto;
      const retiro = isRetiro ? monto : 0;
      const formattedTime = formatExcelTime(m.hora || '');
      const rowNum = m.id || (idx + 1);
      const rawUser = String(m.usuario || '').trim();
      const uid = `SB_row_${rowNum}_${normalizeUser(rawUser)}_${monto}`;

      if (m.verificado && AppState.manualChecks[uid] === undefined) {
        AppState.manualChecks[uid] = true;
      }

      return {
        uid,
        excelRowNumber: rowNum,
        rowIndex0: idx,
        colOkIndex: 5,
        fechaDia: m.fecha_dia || 'Sin fecha',
        turno: m.turno || 'Turno Actual',
        usuarioOriginal: rawUser,
        usuarioNorm: normalizeUser(rawUser),
        carga,
        retiro,
        tipo: isRetiro ? 'RETIRO' : 'DEPOSITO',
        monto,
        hora: formattedTime.timeStr,
        minutesOfDay: formattedTime.minutesOfDay,
        billetera: m.billetera || '',
        okOriginal: m.verificado ? 'ok' : ''
      };
    });

    AppState.excelItems = parsed;
    const badge = document.getElementById('excelCountBadge');
    if (badge) badge.textContent = `${parsed.length} movimiento(s) válido(s)`;
    const pill = document.getElementById('pillExcelCount');
    if (pill) pill.textContent = parsed.length;

    runComparison();

    const timeStr = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (statusEl) {
      const originLabel = res.source === 'supabase' ? '🟢 Conectado a Supabase' : '🟡 Leído desde Memoria Local';
      statusEl.innerHTML = `${originLabel} · Actualizado: <strong>${timeStr}</strong> (${parsed.length} movimientos)`;
    }
    if (!silent) {
      showToast(`☁️ Datos de trabajadoras sincronizados (${parsed.length} movimientos)`);
    }
  } catch (err) {
    if (statusEl) {
      statusEl.innerHTML = `<span style="color:#f87171;">❌ Error al sincronizar: ${escapeHtml(err.message)}</span>`;
    }
  }
}
