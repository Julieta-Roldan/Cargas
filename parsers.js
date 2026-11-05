// =========================================================
// PARSERS DE DATOS: PANEL, EXCEL Y GOOGLE SHEETS EN VIVO (parsers.js)
// =========================================================

function parsePanelInput() {
  const panelInput = document.getElementById('panelInput');
  const raw = panelInput ? panelInput.value : '';
  // Si el usuario pegó dos tandas seguidas sin salto de línea entre ellas, separarlas automáticamente
  const normalizedRaw = raw.replace(/(\S)\s+([a-z0-9]{4}\t\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2})/gi, '$1\n$2');
  const rawLines = normalizedRaw.split(/\r?\n/);

  const mergedLines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line) continue;
    if (/^Nro\s+Fecha/i.test(line) || /^TOTALES/i.test(line)) continue;

    const startsNewRecord = /^[a-z0-9]{3,10}\s+\d{1,2}\/\d{1,2}\/\d{2,4}/i.test(line);
    if (startsNewRecord || mergedLines.length === 0) {
      mergedLines.push(line);
    } else {
      mergedLines[mergedLines.length - 1] += ' ' + line;
    }
  }

  const items = [];
  mergedLines.forEach((line, idx) => {
    let parts = line.split('\t').map(s => s.trim()).filter(Boolean);
    let id, fecha, operacionRaw, agente, destino, dep = 0, ret = 0, saldo = 0;
    let parsedOk = false;

    if (parts.length >= 6) {
      id = parts[0];
      fecha = parts[1];
      operacionRaw = parts[2];
      agente = parts[3];
      destino = parts[4];
      dep = Math.abs(parseAmount(parts[5]));
      ret = Math.abs(parseAmount(parts[6]));
      saldo = parts[7] ? parseAmount(parts[7]) : 0;
      parsedOk = (dep > 0 || ret > 0);
    } else {
      const regex = /^(\S+)\s+(\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2})\s+(.+?)\s+(\S+)\s+(\S+)\s+([-\d.,]+)\s+([-\d.,]+)(?:\s+([-\d.,]+))?$/;
      const match = line.match(regex);
      if (match) {
        [, id, fecha, operacionRaw, agente, destino, depStr, retStr, saldoStr] = match;
        dep = Math.abs(parseAmount(depStr));
        ret = Math.abs(parseAmount(retStr));
        saldo = parseAmount(saldoStr);
        parsedOk = (dep > 0 || ret > 0);
      }
    }

    if (parsedOk) {
      const isRetiroOp = /RETIRO/i.test(operacionRaw) || (ret > 0 && dep === 0);
      const tipo = isRetiroOp ? 'RETIRO' : 'DEPOSITO';
      const monto = tipo === 'RETIRO' ? ret : dep;

      // En el Panel:
      // - En DEPOSITO: Agente = naycelu543 (cajero) y Destino = Jugador (salvo recarga de stock monaco0022 -> naycelu543)
      // - En RETIRO: Agente (parts[3]) = Jugador que retira, y Destino (parts[4]) = naycelu543 (cajero)
      if (tipo === 'DEPOSITO' && normalizeUser(destino) === 'naycelu543') {
        // Es una recarga interna de fichas del administrador al cajero (ej: 3.000.000), no un cliente
        return;
      }

      let playerUser = destino;
      let agentUser = agente;
      if (tipo === 'RETIRO' && normalizeUser(destino) === 'naycelu543') {
        playerUser = agente;
        agentUser = destino;
      }

      const dt = parsePanelDateTime(fecha);
      const fechaDia = extractNormalizedDay(fecha) || 'Sin fecha';

      items.push({
        uid: `P_${idx}_${id}`,
        id,
        fecha,
        fechaDia,
        timeStr: dt.timeStr,
        minutesOfDay: dt.minutesOfDay,
        timestamp: dt.timestamp,
        operacionRaw,
        tipo,
        agente: agentUser,
        usuarioOriginal: playerUser,
        usuarioNorm: normalizeUser(playerUser),
        deposito: dep,
        retiro: ret,
        monto,
        saldo
      });
    }
  });

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

function populateSheetSelector() {
  if (!AppState.currentWorkbook) return;
  const names = AppState.currentWorkbook.SheetNames || [];
  if (names.length === 0) return;

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
    names.forEach(name => {
      const o1 = document.createElement('option');
      o1.value = name;
      o1.textContent = name;
      startSel.appendChild(o1);

      const o2 = document.createElement('option');
      o2.value = name;
      o2.textContent = name;
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

  if (startSel && names.length > 0) startSel.value = names[0];
  if (endSel && names.length > 0) endSel.value = names[names.length - 1];
  if (rStart) rStart.value = '';
  if (rEnd) rEnd.value = '';

  AppState.userSetSheetRange = false;
  onRangeOrSheetChange();
  showToast('🔄 Rango restablecido: leyendo todas las hojas y todas las filas');
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

  const startName = (startSel && startSel.value) ? startSel.value : names[0];
  const endName = (endSel && endSel.value) ? endSel.value : names[names.length - 1];

  AppState.sheetStartName = startName;
  AppState.sheetEndName = endName;

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
