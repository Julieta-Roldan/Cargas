// =========================================================
// INTERFAZ DE USUARIO, DROPS, NAVEGACIÓN Y TABLA (ui.js)
// =========================================================

function toggleDropSection(sectionId) {
  const el = document.getElementById(sectionId);
  if (el) {
    el.classList.toggle('collapsed');
  }
}

function toggleDropdownMenu(menuId, event) {
  if (event) event.stopPropagation();
  const target = document.getElementById(menuId);
  const wasOpen = target && target.classList.contains('open');
  document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
  if (target && !wasOpen) {
    target.classList.add('open');
  }
}

document.addEventListener('click', () => {
  document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
});

function setExcelMode(mode) {
  AppState.excelMode = mode;
  const btnSb = document.getElementById('btnModeSupabase');
  if (btnSb) btnSb.classList.toggle('active', mode === 'supabase');
  document.getElementById('btnModeGsheet').classList.toggle('active', mode === 'gsheet');
  document.getElementById('btnModeFile').classList.toggle('active', mode === 'file');
  document.getElementById('btnModePaste').classList.toggle('active', mode === 'paste');

  const sbContainer = document.getElementById('excelSupabaseContainer');
  if (sbContainer) sbContainer.style.display = mode === 'supabase' ? 'block' : 'none';
  document.getElementById('excelGsheetContainer').style.display = mode === 'gsheet' ? 'block' : 'none';
  document.getElementById('excelFileContainer').style.display = mode === 'file' ? 'block' : 'none';
  document.getElementById('excelPasteContainer').style.display = mode === 'paste' ? 'block' : 'none';

  if (mode === 'supabase') {
    syncSupabaseMovimientos(false);
  } else if (mode === 'gsheet') {
    syncGoogleSheet(true);
  } else if (mode === 'paste') {
    parseExcelPaste();
    runComparison();
  } else if (AppState.currentWorkbook) {
    onSheetChange();
  }
}

function selectDayFilter(day) {
  AppState.selectedDay = day;
  AppState.userLockedDay = true;
  AppState.selectedShift = 'all';
  runComparison();
  showToast(day === 'all' ? '🗂️ Mostrando todos los días cargados' : `📅 Día seleccionado: ${day}`);
}

function selectShiftFilter(shift) {
  AppState.selectedShift = shift;
  renderDayAndShiftBars();
  updateSummaryStats();
  renderTable();
  showToast(shift === 'all' ? '👥 Mostrando todos los turnos del día' : `👥 Turno filtrado: ${shift}`);
}

function renderDayAndShiftBars() {
  const dayContainer = document.getElementById('dayButtonsContainer');
  const shiftContainer = document.getElementById('shiftButtonsContainer');
  const shiftRowWrap = document.getElementById('shiftSelectorRow');
  const activeDayBadge = document.getElementById('activeDayHeaderBadge');

  const days = getAvailableDays();
  const activeDay = getResolvedActiveDay();

  if (activeDayBadge) {
    activeDayBadge.textContent = activeDay === 'all' ? 'Todos los días' : `Día ${activeDay}`;
  }

  if (dayContainer) {
    if (days.length === 0) {
      dayContainer.innerHTML = `<span style="font-size: 0.82rem; color: var(--text-muted);">Sincroniza Google Sheets o pega datos del Panel para ver los días disponibles...</span>`;
    } else {
      const btns = [];
      days.forEach(d => {
        const eItems = AppState.excelItems.filter(e => e.fechaDia === d);
        const pItems = AppState.panelItems.filter(p => p.fechaDia === d);
        const isActive = activeDay === d;
        let rowRangeText = '';
        if (eItems.length > 0) {
          const sheetsInDay = [...new Set(eItems.map(e => e.sheetName).filter(Boolean))];
          if (sheetsInDay.length <= 1) {
            const minR = Math.min(...eItems.map(e => e.excelRowNumber));
            const maxR = Math.max(...eItems.map(e => e.excelRowNumber));
            const prefix = (AppState.currentWorkbook && AppState.currentWorkbook.SheetNames && AppState.currentWorkbook.SheetNames.length > 1 && sheetsInDay[0])
              ? `${sheetsInDay[0]}: ` : 'Filas ';
            rowRangeText = ` · ${prefix}#${minR}–#${maxR}`;
          } else {
            const parts = sheetsInDay.map(sn => {
              const sItems = eItems.filter(e => e.sheetName === sn);
              const minR = Math.min(...sItems.map(e => e.excelRowNumber));
              const maxR = Math.max(...sItems.map(e => e.excelRowNumber));
              return `${sn} (#${minR}–#${maxR})`;
            });
            rowRangeText = ` · ${parts.join(' + ')}`;
          }
        }
        btns.push(`
          <button
            class="day-pill-btn ${isActive ? 'active' : ''}"
            onclick="selectDayFilter('${escapeHtml(d)}')"
            title="Filtrar y comparar exclusivamente los registros del día ${escapeHtml(d)}"
          >
            <span class="day-pill-main">📅 ${escapeHtml(d)}</span>
            <span class="day-pill-sub">${eItems.length} Sheets · ${pItems.length} Panel${rowRangeText}</span>
          </button>
        `);
      });

      const totalE = AppState.excelItems.length;
      const totalP = AppState.panelItems.length;
      btns.push(`
        <button
          class="day-pill-btn ${activeDay === 'all' ? 'active' : ''}"
          onclick="selectDayFilter('all')"
          title="Ver todos los días juntos sin filtrar por fecha"
        >
          <span class="day-pill-main">🗂️ Todos los días</span>
          <span class="day-pill-sub">${totalE} Sheets · ${totalP} Panel</span>
        </button>
      `);

      dayContainer.innerHTML = btns.join('');
    }
  }

  if (shiftContainer && shiftRowWrap) {
    const activeExcel = getActiveExcelItems();
    const shiftsMap = new Map();
    activeExcel.forEach(e => {
      const t = e.turno || 'Sin turno';
      shiftsMap.set(t, (shiftsMap.get(t) || 0) + 1);
    });

    if (shiftsMap.size <= 1) {
      shiftRowWrap.style.display = 'none';
    } else {
      shiftRowWrap.style.display = 'flex';
      const sBtns = [];
      sBtns.push(`
        <button
          class="shift-pill-btn ${AppState.selectedShift === 'all' ? 'active' : ''}"
          onclick="selectShiftFilter('all')"
        >
          Todos los bloques (${activeExcel.length})
        </button>
      `);
      shiftsMap.forEach((count, shiftName) => {
        const isAct = AppState.selectedShift === shiftName;
        sBtns.push(`
          <button
            class="shift-pill-btn ${isAct ? 'active' : ''}"
            onclick="selectShiftFilter('${escapeHtml(shiftName)}')"
          >
            👥 ${escapeHtml(shiftName)} <span style="opacity:0.75;">(${count})</span>
          </button>
        `);
      });
      shiftContainer.innerHTML = sBtns.join('');
    }
  }
}

function getActiveTypeFilter() {
  const val = document.getElementById('typeFilter').value;
  if (val === 'auto') {
    const activeP = getActivePanelItems();
    const hasDep = activeP.some(i => i.tipo === 'DEPOSITO');
    const hasRet = activeP.some(i => i.tipo === 'RETIRO');
    if (hasDep && !hasRet) return 'DEPOSITO';
    if (hasRet && !hasDep) return 'RETIRO';
    return 'all';
  }
  return val;
}

function updateSummaryStats() {
  const activeType = getActiveTypeFilter();
  const baseList = AppState.comparisonResults.filter(r => {
    if (activeType !== 'all' && r.tipo !== activeType) return false;
    if (AppState.selectedShift !== 'all') {
      if (!r.excel || r.excel.turno !== AppState.selectedShift) return false;
    }
    return true;
  });

  const countAll = baseList.length;
  const countMatched = baseList.filter(r => r.status === 'matched').length;
  const countSimilar = baseList.filter(r => r.status === 'similar').length;
  const countDiff = baseList.filter(r => r.status === 'diff').length;
  const countOnlyPanel = baseList.filter(r => r.status === 'only_panel').length;
  const countOnlyExcel = baseList.filter(r => r.status === 'only_excel').length;

  document.getElementById('stat-all').textContent = countAll;
  document.getElementById('stat-matched').textContent = countMatched;
  document.getElementById('stat-similar').textContent = countSimilar;
  document.getElementById('stat-diff').textContent = countDiff;
  document.getElementById('stat-only-panel').textContent = countOnlyPanel;
  document.getElementById('stat-only-excel').textContent = countOnlyExcel;

  const activePanel = getActivePanelItems();
  const activeExcel = getActiveExcelItems().filter(e => AppState.selectedShift === 'all' || e.turno === AppState.selectedShift);

  const totPanelDep = activePanel.filter(i => i.tipo === 'DEPOSITO').reduce((acc, i) => acc + i.monto, 0);
  const totExcelDep = activeExcel.filter(i => i.tipo === 'DEPOSITO').reduce((acc, i) => acc + i.monto, 0);
  const totPanelRet = activePanel.filter(i => i.tipo === 'RETIRO').reduce((acc, i) => acc + i.monto, 0);
  const totExcelRet = activeExcel.filter(i => i.tipo === 'RETIRO').reduce((acc, i) => acc + i.monto, 0);

  document.getElementById('totPanelDep').textContent = formatMoney(totPanelDep);
  document.getElementById('totExcelDep').textContent = formatMoney(totExcelDep);
  const diffDep = totPanelDep - totExcelDep;
  const diffEl = document.getElementById('totDiffDep');
  diffEl.textContent = (diffDep > 0 ? '+' : '') + formatMoney(diffDep);
  diffEl.style.color = diffDep === 0 ? 'var(--success)' : 'var(--warning)';

  document.getElementById('totPanelRet').textContent = formatMoney(totPanelRet);
  document.getElementById('totExcelRet').textContent = formatMoney(totExcelRet);
}

function setFilter(filter) {
  AppState.currentFilter = filter;
  ['all', 'matched', 'similar', 'diff', 'only_panel', 'only_excel'].forEach(f => {
    const el = document.getElementById(`card-${f}`);
    if (el) el.classList.toggle('active', f === filter);
  });
  renderTable();
}

function toggleCheck(key, checked, event) {
  if (event) {
    event.stopPropagation();
    if (event.target && typeof event.target.blur === 'function') {
      event.target.blur();
    }
  }
  AppState.selectedRowKey = key;
  AppState.manualChecks[key] = checked;
  renderTable();
  if (AppState.isModalOpen && AppState.selectedRowKey === key) {
    renderComparisonModalContent();
  }
}

function toggleSelectedCheck() {
  if (!AppState.selectedRowKey) return;
  AppState.manualChecks[AppState.selectedRowKey] = !AppState.manualChecks[AppState.selectedRowKey];
  renderTable();
  if (AppState.isModalOpen) {
    renderComparisonModalContent();
  }
}

function toggleInlineDrop(key, event) {
  if (event) event.stopPropagation();
  AppState.expandedDrops[key] = !AppState.expandedDrops[key];
  renderTable();
}

function expandAllInlineDrops(openState) {
  AppState.currentVisibleRows.forEach(r => {
    AppState.expandedDrops[r.key] = openState;
  });
  renderTable();
  showToast(openState ? '📂 Detalles desplegados en todas las filas' : '📁 Detalles contraídos');
}

function checkAllMatched() {
  let count = 0;
  AppState.comparisonResults.forEach(r => {
    if (r.status === 'matched' || r.status === 'similar') {
      AppState.manualChecks[r.key] = true;
      count++;
    }
  });
  renderTable();
  showToast(`✅ Se marcaron ${count} coincidencias con OK`);
}

function uncheckAll() {
  AppState.manualChecks = {};
  renderTable();
  showToast('🔄 Se desmarcaron todos los checks OK');
}

// =========================================================
// CORREGIR NOMBRE DE USUARIO DESDE LA FILA SELECCIONADA (FLECHA IZQUIERDA ←)
// =========================================================
async function quickFixSelectedUserName() {
  const row = AppState.comparisonResults.find(r => r.key === AppState.selectedRowKey);
  if (!row) {
    showToast('⚠️ Seleccioná una fila primero con un clic o con las flechas');
    return;
  }

  // Obtener el nombre sugerido (del panel si existe, o el actual de sheets)
  const currentExcelUser = row.excel ? String(row.excel.usuarioOriginal || '').trim() : '';
  const suggestedName = row.panel ? String(row.panel.usuarioOriginal || '').trim() : currentExcelUser;

  if (!currentExcelUser) {
    showToast('⚠️ Esta fila no proviene de las cargas de las trabajadoras');
    return;
  }

  const promptMsg = (suggestedName && suggestedName.toLowerCase() !== currentExcelUser.toLowerCase())
    ? `✏️ Corregir nombre mal tipeado en Supabase:\n\nNombre anotado por la trabajadora: "${currentExcelUser}"\nNombre real en el Panel: "${suggestedName}"\n\n¿A qué nombre querés corregirlo para todas las cargas anteriores y futuras sugerencias?:`
    : `✏️ Editar nombre de usuario en Supabase:\n\nUsuario actual: "${currentExcelUser}"\n\nIngresá el nombre corregido:`;

  const newName = prompt(promptMsg, suggestedName || currentExcelUser);
  if (!newName || newName.trim() === '' || newName.trim() === currentExcelUser) {
    return;
  }

  const corrected = newName.trim();
  const { url, key, isConfigured } = getSupabaseCredentials();

  if (!isConfigured) {
    alert('Supabase no está configurado');
    return;
  }

  try {
    showToast(`Actualizando "${currentExcelUser}" a "${corrected}" en Supabase...`);

    const res = await fetch(`${url}/rest/v1/movimientos?usuario=eq.${encodeURIComponent(currentExcelUser)}`, {
      method: 'PATCH',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ usuario: corrected })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText);
    }

    showToast(`✅ "${currentExcelUser}" corregido a "${corrected}"`);

    // Actualizar en memoria local inmediatamente para refrescar la tabla al instante
    AppState.excelItems.forEach(it => {
      if (it.usuarioOriginal === currentExcelUser) {
        it.usuarioOriginal = corrected;
        it.usuarioNorm = normalizeUser(corrected);
      }
    });

    // Re-ejecutar comparación y volver a seleccionar
    runComparison();
    if (AppState.selectedRowKey) {
      selectRow(AppState.selectedRowKey, false);
    }

    // Refrescar en segundo plano los datos desde Supabase
    if (typeof syncSupabaseMovimientos === 'function') {
      syncSupabaseMovimientos(true);
    }
  } catch (err) {
    alert('Error al corregir usuario en Supabase: ' + err.message);
  }
}

// =========================================================
// ATAJOS DE TECLADO GLOBALES EN EL PANEL (FLECHAS, ESPACIO, ENTER, ETC)
// =========================================================
window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('keydown', (e) => {
    // Si la pantalla de login con +991 está activa y aún no se logueó, no interferir
    if (!sessionStorage.getItem('admin_logged_in_user')) return;

    // Si el foco está en un campo de texto donde se escribe, no interceptar las flechas
    const activeEl = document.activeElement;
    const activeTag = activeEl ? activeEl.tagName.toLowerCase() : '';
    const isTextInput = activeTag === 'textarea' ||
                        (activeTag === 'input' && activeEl.type !== 'checkbox' && activeEl.type !== 'radio' && activeEl.type !== 'button') ||
                        activeTag === 'select';
    if (isTextInput) {
      return;
    }

    // Flecha Arriba: Subir fila
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(-1);
      return;
    }

    // Flecha Abajo: Bajar fila
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSelection(1);
      return;
    }

    // Flecha Derecha o Espacio: Marcar/Desmarcar OK
    if (e.key === 'ArrowRight' || e.key === ' ') {
      e.preventDefault();
      toggleSelectedCheck();
      return;
    }

    // Flecha Izquierda: Editar / Corregir nombre de usuario en Supabase
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      quickFixSelectedUserName();
      return;
    }

    // Enter: Abrir modal de comparación si no está abierto
    if (e.key === 'Enter') {
      if (!AppState.isModalOpen) {
        e.preventDefault();
        openComparisonModalForSelected();
      }
      return;
    }

    // Escape: Cerrar modal si está abierto
    if (e.key === 'Escape') {
      if (AppState.isModalOpen) {
        e.preventDefault();
        closeComparisonModal();
      }
    }
  });
});

// =========================================================
// NAVEGACIÓN DE FILAS (1 CLIC, FLECHAS ARRIBA/ABAJO, DOBLE CLIC)
// =========================================================
function selectRow(key, scrollIntoView = false) {
  AppState.selectedRowKey = key;
  const trs = document.querySelectorAll('#resultsBody tr[data-key]');
  trs.forEach(tr => {
    const isSel = tr.getAttribute('data-key') === key;
    tr.classList.toggle('row-selected', isSel);
    if (isSel && scrollIntoView) {
      tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
  updateFloatingNav();
  if (AppState.isModalOpen) {
    renderComparisonModalContent();
  }
}

function moveSelection(delta) {
  const rows = AppState.currentVisibleRows;
  if (rows.length === 0) return;
  let idx = rows.findIndex(r => r.key === AppState.selectedRowKey);
  if (idx === -1) {
    idx = delta > 0 ? 0 : rows.length - 1;
  } else {
    idx = Math.max(0, Math.min(rows.length - 1, idx + delta));
  }
  selectRow(rows[idx].key, true);
}

function updateFloatingNav() {
  const nav = document.getElementById('floatingNav');
  const rows = AppState.currentVisibleRows;
  if (rows.length === 0) {
    nav.style.display = 'none';
    return;
  }
  nav.style.display = 'flex';
  const idx = rows.findIndex(r => r.key === AppState.selectedRowKey);
  const posText = idx !== -1
    ? `Movimiento ${idx + 1} de ${rows.length}`
    : `${rows.length} movimientos`;
  document.getElementById('navPosLabel').textContent = posText;
}

function onRowClick(key, event) {
  if (event && event.target && (event.target.type === 'checkbox' || event.target.closest('.btn-row-drop'))) return;
  selectRow(key, false);
}

function onRowDblClick(key, event) {
  if (event && event.target && (event.target.type === 'checkbox' || event.target.closest('.btn-row-drop'))) return;
  selectRow(key, false);
  openComparisonModalForSelected();
}

function openComparisonModalForSelected() {
  if (!AppState.selectedRowKey && AppState.currentVisibleRows.length > 0) {
    AppState.selectedRowKey = AppState.currentVisibleRows[0].key;
  }
  if (!AppState.selectedRowKey) {
    showToast('⚠️ Primero carga datos para comparar');
    return;
  }
  AppState.isModalOpen = true;
  document.getElementById('compareModal').classList.add('open');
  renderComparisonModalContent();
}

function closeComparisonModal() {
  AppState.isModalOpen = false;
  document.getElementById('compareModal').classList.remove('open');
}

function onBackdropClick(e, modalId) {
  if (e.target && e.target.id === modalId) {
    if (modalId === 'compareModal') closeComparisonModal();
    if (modalId === 'helpModal') closeHelpModal();
    if (modalId === 'pdfModal' && typeof closePdfModal === 'function') closePdfModal();
  }
}

function getStatusBadgeHtml(row) {
  if (row.status === 'matched') {
    return '<span class="status-pill pill-matched">✅ Coincide Exacto</span>';
  } else if (row.status === 'similar') {
    const label = row.matchNote ? escapeHtml(row.matchNote) : 'Nombre Similar';
    return `<span class="status-pill pill-similar">🔤 ${label}</span>`;
  } else if (row.status === 'diff') {
    return '<span class="status-pill pill-diff">⚠️ Monto Distinto</span>';
  } else if (row.status === 'only_panel') {
    return '<span class="status-pill pill-only-panel">🚨 Falta en Excel</span>';
  } else {
    return '<span class="status-pill pill-only-excel">🟣 Falta en Panel</span>';
  }
}

function renderComparisonModalContent() {
  const row = AppState.comparisonResults.find(r => r.key === AppState.selectedRowKey);
  if (!row) return;

  document.getElementById('modalStatusBadge').innerHTML = getStatusBadgeHtml(row);
  const isChecked = !!AppState.manualChecks[row.key];
  const okBtn = document.getElementById('modalToggleOkBtn');
  okBtn.textContent = isChecked ? '✅ Marcado como OK (Clic para quitar)' : '☑️ Marcar como OK (Espacio)';
  okBtn.className = isChecked ? 'btn btn-primary' : 'btn btn-success';

  const p = row.panel;
  const e = row.excel;

  let diffHtml = '—';
  if (p && e) {
    const diff = p.monto - e.monto;
    if (Math.abs(diff) < 0.01) {
      diffHtml = '<span style="color: var(--success); font-weight: 700;">$ 0 (Montos idénticos)</span>';
    } else {
      diffHtml = `<span style="color: var(--warning); font-weight: 700;">${diff > 0 ? '+' : ''}${formatMoney(diff)}</span>`;
    }
  }

  let userSimHtml = '';
  if (p && e) {
    const simPct = Math.round(userSimilarity(p.usuarioOriginal, e.usuarioOriginal) * 100);
    userSimHtml = p.usuarioNorm === e.usuarioNorm
      ? `<span style="color: var(--success);">Idéntico (100%)</span>`
      : `<span style="color: var(--info);">Similitud del ${simPct}% (${escapeHtml(e.usuarioOriginal)} ↔ ${escapeHtml(p.usuarioOriginal)})</span>`;
  } else if (p) {
    userSimHtml = `<span style="color: var(--danger);">No figura en el Excel</span>`;
  } else {
    userSimHtml = `<span style="color: var(--purple);">No figura en lo pegado del Panel</span>`;
  }

  let neighborsHtml = '';
  if (e) {
    const idxE = AppState.excelItems.findIndex(item => item.uid === e.uid);
    const start = Math.max(0, idxE - 2);
    const end = Math.min(AppState.excelItems.length - 1, idxE + 2);
    const slice = AppState.excelItems.slice(start, end + 1);

    neighborsHtml = `
      <div class="neighbors-box">
        <h4>📍 Ubicación exacta en Google Sheets / Excel (Filas cercanas a ${escapeHtml(formatExcelRowRef(e))})</h4>
        ${slice.map(item => {
          const isCurr = item.uid === e.uid;
          const isItemOk = !!AppState.manualChecks[item.uid];
          return `
            <div class="neighbor-row ${isCurr ? 'current' : ''}">
              <span class="mono">${isCurr ? '👉 ' : ''}${escapeHtml(formatExcelRowRef(item))}</span>
              <span>${escapeHtml(item.usuarioOriginal)}</span>
              <span class="amount">${formatMoney(item.monto)}</span>
              <span style="font-size: 0.78rem; color: var(--text-muted);">${item.tipo}</span>
              <span style="text-align: right; color: var(--success); font-weight: 700;">${isItemOk ? 'OK ✓' : ''}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  document.getElementById('modalBodyContent').innerHTML = `
    <div class="verdict-banner">
      <div>
        <div style="font-size: 0.78rem; color: var(--text-muted); text-transform: uppercase;">Comparación de Usuario</div>
        <div style="font-size: 0.98rem; font-weight: 600;">${userSimHtml}</div>
      </div>
      <div>
        <div style="font-size: 0.78rem; color: var(--text-muted); text-transform: uppercase;">Diferencia de Dinero</div>
        <div style="font-size: 0.98rem;">${diffHtml}</div>
      </div>
      <div>
        <div style="font-size: 0.78rem; color: var(--text-muted); text-transform: uppercase;">Verificación Manual</div>
        <div style="font-size: 0.98rem; font-weight: 700; color: ${isChecked ? 'var(--success)' : 'var(--text-muted)'};">
          ${isChecked ? '✅ VERIFICADO (OK)' : '⏳ Pendiente de marcar'}
        </div>
      </div>
      ${e ? `
      <div>
        <div style="font-size: 0.78rem; color: var(--text-muted); text-transform: uppercase;">Corregir Nombre (←)</div>
        <button class="btn btn-outline" onclick="quickFixSelectedUserName()" style="padding: 4px 10px; font-size: 0.76rem; border-color: #818cf8; color: #a5b4fc; margin-top: 2px;">
          ✏️ Corregir en Supabase
        </button>
      </div>` : ''}
    </div>

    <div class="compare-grid">
      <!-- COLUMNA PANEL -->
      <div class="compare-panel">
        <h3>
          <span>🖥️ Panel Administrativo</span>
          ${p ? `<span class="type-badge ${p.tipo === 'RETIRO' ? 'type-retiro' : 'type-deposito'}">${p.tipo}</span>` : ''}
        </h3>
        ${p ? `
          <div class="field-row">
            <span class="field-label">Usuario (Destino)</span>
            <span class="field-value mono" style="font-size: 1.05rem; color: #60a5fa;">${escapeHtml(p.usuarioOriginal)}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Depósito en Panel</span>
            <span class="field-value mono" style="color: var(--success);">${formatMoney(p.deposito)}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Retiro en Panel</span>
            <span class="field-value mono" style="color: #fb923c;">${formatMoney(p.retiro)}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Saldo en Panel</span>
            <span class="field-value mono">${formatMoney(p.saldo)}</span>
          </div>
          ${p.combinedParts ? `
          <div class="field-row">
            <span class="field-label">Detalle Suma</span>
            <span class="field-value mono" style="color: var(--info);">${escapeHtml(p.combinedParts)}</span>
          </div>` : ''}
          <div class="field-row">
            <span class="field-label">Fecha y Hora Completa</span>
            <span class="field-value mono">${escapeHtml(p.fecha)}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Nro / ID Operación</span>
            <span class="field-value mono">${escapeHtml(p.id)}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Agente</span>
            <span class="field-value mono">${escapeHtml(p.agente)}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Operación Original</span>
            <span class="field-value" style="font-size: 0.82rem; color: var(--text-muted);">${escapeHtml(p.operacionRaw)}</span>
          </div>
        ` : `
          <div class="empty-state" style="padding: 30px 10px;">
            ❌ Este movimiento no aparece en los datos pegados del Panel Administrativo.
          </div>
        `}
      </div>

      <!-- COLUMNA EXCEL -->
      <div class="compare-panel">
        <h3>
          <span>📊 Google Sheets / Excel</span>
          ${e ? `<span class="mono" style="color: #fbbf24;">${escapeHtml(formatExcelRowRef(e))}</span>` : ''}
        </h3>
        ${e ? `
          <div class="field-row">
            <span class="field-label">Usuario Anotado</span>
            <span class="field-value mono" style="font-size: 1.05rem; color: #c084fc;">${escapeHtml(e.usuarioOriginal)}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Columna Carga</span>
            <span class="field-value mono" style="color: var(--success);">${formatMoney(e.carga)}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Columna Retiro</span>
            <span class="field-value mono" style="color: #fb923c;">${formatMoney(e.retiro)}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Hoja y Fila Excel</span>
            <span class="field-value mono">${escapeHtml(formatExcelRowRef(e))}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Turno Detectado</span>
            <span class="field-value" style="color: #93c5fd;">${escapeHtml(e.turno || '—')}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Columna Hora</span>
            <span class="field-value mono">${escapeHtml(e.hora || '—')}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Columna Billetera</span>
            <span class="field-value">${escapeHtml(e.billetera || '—')}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Columna 'ok'</span>
            <span class="field-value mono" style="color: ${isChecked ? 'var(--success)' : 'var(--text-muted)'};">
              ${isChecked ? 'ok' : (e.okOriginal || '(vacío)')}
            </span>
          </div>
        ` : `
          <div class="empty-state" style="padding: 30px 10px;">
            🚨 El trabajador NO registró esta operación en la hoja de Google Sheets / Excel.
          </div>
        `}
      </div>
    </div>

    ${neighborsHtml}
  `;
}

// =========================================================
// RENDERIZADO DE LA TABLA PRINCIPAL + DROPS POR FILA
// =========================================================
function renderTable() {
  updateSummaryStats();
  const tbody = document.getElementById('resultsBody');
  const search = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  const activeType = getActiveTypeFilter();
  const sortOrder = document.getElementById('sortOrderSelect').value;
  const hideChecked = document.getElementById('hideCheckedToggle').checked;

  const filtered = AppState.comparisonResults.filter(row => {
    if (AppState.currentFilter !== 'all' && row.status !== AppState.currentFilter) return false;
    if (activeType !== 'all' && row.tipo !== activeType) return false;
    if (AppState.selectedShift !== 'all') {
      if (!row.excel || row.excel.turno !== AppState.selectedShift) return false;
    }
    const isChecked = !!AppState.manualChecks[row.key];
    if (hideChecked && isChecked) return false;

    if (search) {
      const userP = row.panel ? row.panel.usuarioOriginal.toLowerCase() : '';
      const userE = row.excel ? row.excel.usuarioOriginal.toLowerCase() : '';
      const idP = row.panel ? row.panel.id.toLowerCase() : '';
      const agP = row.panel ? row.panel.agente.toLowerCase() : '';
      const billE = row.excel ? (row.excel.billetera || '').toLowerCase() : '';
      const turnoE = row.excel ? (row.excel.turno || '').toLowerCase() : '';
      const diaE = row.excel ? (row.excel.fechaDia || '').toLowerCase() : '';
      const mP = row.panel ? String(row.panel.monto) : '';
      const mE = row.excel ? String(row.excel.monto) : '';
      const fila = row.excel ? `fila #${row.excel.excelRowNumber}` : '';
      return (
        userP.includes(search) ||
        userE.includes(search) ||
        idP.includes(search) ||
        agP.includes(search) ||
        billE.includes(search) ||
        turnoE.includes(search) ||
        diaE.includes(search) ||
        mP.includes(search) ||
        mE.includes(search) ||
        fila.includes(search)
      );
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (sortOrder === 'panel_order' || !sortOrder) {
      const orderA = a.panelOrder ?? 999999;
      const orderB = b.panelOrder ?? 999999;
      if (Math.abs(orderA - orderB) > 0.00001) return orderA - orderB;
      // Si coinciden en el orden estimado: el del Panel siempre va primero
      if (a.panel && !b.panel) return -1;
      if (!a.panel && b.panel) return 1;
      return (a.excel?.excelRowNumber ?? 0) - (b.excel?.excelRowNumber ?? 0);
    }
    if (sortOrder === 'time_asc') {
      return (a.sortMinutes ?? 0) - (b.sortMinutes ?? 0) ||
             (a.panel && !b.panel ? -1 : (!a.panel && b.panel ? 1 : 0)) ||
             ((a.excel?.sheetIndex ?? 0) - (b.excel?.sheetIndex ?? 0)) ||
             ((a.excel?.excelRowNumber ?? 9999) - (b.excel?.excelRowNumber ?? 9999));
    }
    if (sortOrder === 'time_desc') {
      return (b.sortMinutes ?? 0) - (a.sortMinutes ?? 0) ||
             (a.panel && !b.panel ? -1 : (!a.panel && b.panel ? 1 : 0)) ||
             ((b.excel?.sheetIndex ?? 0) - (a.excel?.sheetIndex ?? 0)) ||
             ((b.excel?.excelRowNumber ?? 0) - (a.excel?.excelRowNumber ?? 0));
    }
    if (sortOrder === 'excel_row') {
      const rA = a.excel ? (a.excel.sheetIndex || 0) * 100000 + a.excel.excelRowNumber : 9999999 + (a.sortMinutes ?? 0);
      const rB = b.excel ? (b.excel.sheetIndex || 0) * 100000 + b.excel.excelRowNumber : 9999999 + (b.sortMinutes ?? 0);
      return rA - rB;
    }
    if (sortOrder === 'status') {
      const priority = { only_panel: 1, only_excel: 2, diff: 3, similar: 4, matched: 5 };
      return (priority[a.status] - priority[b.status]) || ((a.panelOrder ?? 0) - (b.panelOrder ?? 0));
    }
    return 0;
  });

  AppState.currentVisibleRows = filtered;

  if (filtered.length > 0 && (!AppState.selectedRowKey || !filtered.some(r => r.key === AppState.selectedRowKey))) {
    AppState.selectedRowKey = filtered[0].key;
  } else if (filtered.length === 0) {
    AppState.selectedRowKey = null;
  }

  updateFloatingNav();

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="empty-state">
          No hay movimientos para mostrar con los filtros actuales.
        </td>
      </tr>
    `;
    return;
  }

  const htmlRows = [];

  filtered.forEach(row => {
    const isChecked = !!AppState.manualChecks[row.key];
    const isSelected = row.key === AppState.selectedRowKey;
    const isDropOpen = !!AppState.expandedDrops[row.key];
    let rowClass = '';
    let statusBadge = '';

    if (row.status === 'matched') {
      rowClass = 'row-matched';
      statusBadge = '<span class="status-pill pill-matched">✅ Coincide</span>';
    } else if (row.status === 'similar') {
      rowClass = 'row-similar';
      const label = row.matchNote ? escapeHtml(row.matchNote) : 'Nombre Similar';
      statusBadge = `<span class="status-pill pill-similar">🔤 ${label}</span>`;
    } else if (row.status === 'diff') {
      rowClass = 'row-diff';
      statusBadge = '<span class="status-pill pill-diff">⚠️ Monto Distinto</span>';
    } else if (row.status === 'only_panel') {
      rowClass = 'row-only-panel';
      statusBadge = '<span class="status-pill pill-only-panel">🚨 Falta en Excel</span>';
    } else if (row.status === 'only_excel') {
      rowClass = 'row-only-excel';
      statusBadge = '<span class="status-pill pill-only-excel">🟣 Falta en Panel</span>';
    }

    if (isChecked) rowClass += ' row-checked';
    if (isSelected) rowClass += ' row-selected';

    const typeBadge = row.tipo === 'RETIRO'
      ? '<span class="type-badge type-retiro">Retiro</span>'
      : '<span class="type-badge type-deposito">Carga</span>';

    const isRetiroRow = row.tipo === 'RETIRO';
    const userClass = isRetiroRow ? 'user-highlight user-highlight-retiro' : 'user-highlight';

    let userDisplay = '';
    if (row.panel && row.excel) {
      if (row.panel.usuarioNorm === row.excel.usuarioNorm) {
        userDisplay = `<span class="${userClass}">${escapeHtml(row.panel.usuarioOriginal || row.excel.usuarioOriginal)}</span>`;
      } else {
        userDisplay = `
          <div class="user-pair">
            <div><span class="${userClass}">${escapeHtml(row.panel.usuarioOriginal)}</span> <span class="user-sub">(Panel)</span></div>
            <div class="user-panel-tag">↔ Sheets: <span class="mono">${escapeHtml(row.excel.usuarioOriginal)}</span></div>
          </div>
        `;
      }
    } else if (row.panel) {
      userDisplay = `<span class="${userClass}">${escapeHtml(row.panel.usuarioOriginal)}</span> <span class="user-sub">(Solo Panel)</span>`;
    } else {
      userDisplay = `<span class="${userClass}">${escapeHtml(row.excel.usuarioOriginal)}</span> <span class="user-sub">(Solo Sheets)</span>`;
    }

    const montoPanel = row.panel ? formatMoney(row.panel.monto) : '—';
    const montoExcel = row.excel ? formatMoney(row.excel.monto) : '—';

    let diffText = '—';
    if (row.panel && row.excel) {
      const d = row.panel.monto - row.excel.monto;
      diffText = d === 0 ? '$ 0' : (d > 0 ? `+${formatMoney(d)}` : formatMoney(d));
    }

    const horarioText = row.panel
      ? `<strong>${escapeHtml(row.panel.timeStr)}</strong>`
      : (row.excel && row.excel.hora ? `<strong>${escapeHtml(row.excel.hora)}</strong>` : '<span class="user-sub">Sin hora</span>');

    const infoPanel = row.panel
      ? `<span class="mono">${escapeHtml(row.panel.id)}</span>${row.excel && row.excel.billetera ? ` · ${escapeHtml(row.excel.billetera)}` : ''}`
      : (row.excel && row.excel.billetera ? `<span class="user-sub">${escapeHtml(row.excel.billetera)}</span>` : '—');

    htmlRows.push(`
      <tr
        class="${rowClass}"
        data-key="${escapeHtml(row.key)}"
        onclick="onRowClick('${escapeHtml(row.key)}', event)"
        ondblclick="onRowDblClick('${escapeHtml(row.key)}', event)"
        title="1 Clic: Seleccionar | Doble Clic: Ver Fila y Comparar"
      >
        <!-- VISTA MÓVIL EN 2 COLUMNAS (EXACTA AL DIBUJO) -->
        <td colspan="10" class="mobile-only-cell">
          <div class="mobile-row-wrapper">
            <div class="mobile-row-main">
              <!-- COLUMNA IZQUIERDA: USUARIO + HORARIO -->
              <div class="mobile-col-left">
                <div class="mobile-user-title">${userDisplay}</div>
                <div class="mobile-sub-line">
                  <span class="mobile-time-badge">${horarioText}</span>
                  ${typeBadge}
                  ${statusBadge}
                </div>
              </div>

              <!-- COLUMNA DERECHA: PANEL MONTO + ANOTADO SUPABASE MONTO -->
              <div class="mobile-col-right">
                <div class="mobile-amount-line">
                  <span class="mobile-amount-label">Panel:</span>
                  <strong class="mobile-amount-val">${montoPanel}</strong>
                </div>
                <div class="mobile-amount-line">
                  <span class="mobile-amount-label">Anotado:</span>
                  <strong class="mobile-amount-val">${montoExcel}</strong>
                </div>
              </div>
            </div>

            <!-- ACCIÓN RÁPIDA: CHECKBOX OK Y DESPLEGABLE -->
            <div class="mobile-row-meta" onclick="event.stopPropagation()">
              <input
                type="checkbox"
                class="ok-checkbox mobile-touch-checkbox"
                ${isChecked ? 'checked' : ''}
                onchange="toggleCheck('${escapeHtml(row.key)}', this.checked, event)"
              />
              <button
                type="button"
                class="btn-row-drop ${isDropOpen ? 'open' : ''}"
                onclick="toggleInlineDrop('${escapeHtml(row.key)}', event)"
                title="Desplegar datos"
              >
                ${isDropOpen ? '▲' : '▼'}
              </button>
            </div>
          </div>
        </td>

        <!-- VISTA ESCRITORIO (10 COLUMNAS) -->
        <td class="desktop-col" style="text-align: center;">
          <input
            type="checkbox"
            class="ok-checkbox"
            ${isChecked ? 'checked' : ''}
            onchange="toggleCheck('${escapeHtml(row.key)}', this.checked, event)"
          />
        </td>
        <td class="desktop-col" style="text-align: center;">
          <button
            class="btn-row-drop ${isDropOpen ? 'open' : ''}"
            onclick="toggleInlineDrop('${escapeHtml(row.key)}', event)"
            title="Desplegar todos los datos de Panel y Excel aquí mismo"
          >
            ${isDropOpen ? '▲' : '▼'}
          </button>
        </td>
        <td class="desktop-col mono" style="white-space: nowrap; font-size: 0.92rem;">${horarioText}</td>
        <td class="desktop-col cell-user">${userDisplay}</td>
        <td class="desktop-col amount amount-highlight">${montoPanel}</td>
        <td class="desktop-col amount amount-highlight">${montoExcel}</td>
        <td class="desktop-col">${statusBadge}</td>
        <td class="desktop-col">${typeBadge}</td>
        <td class="desktop-col amount">${diffText}</td>
        <td class="desktop-col" style="font-size: 0.81rem; color: var(--text-muted); white-space: nowrap;">${infoPanel}</td>
      </tr>
    `);

    if (isDropOpen) {
      const p = row.panel;
      const e = row.excel;
      htmlRows.push(`
        <tr class="inline-drop-row">
          <td colspan="10">
            <div class="inline-drop-grid">
              <div class="inline-drop-card">
                <h5>🖥️ Datos Completos del Panel Administrativo</h5>
                ${p ? `
                  <div class="inline-kv"><span>Nro / ID:</span> <strong class="mono">${escapeHtml(p.id)}</strong></div>
                  <div class="inline-kv"><span>Fecha y Hora:</span> <strong class="mono">${escapeHtml(p.fecha)}</strong></div>
                  <div class="inline-kv"><span>Operación:</span> <strong>${escapeHtml(p.operacionRaw)}</strong></div>
                  <div class="inline-kv"><span>Agente:</span> <strong class="mono">${escapeHtml(p.agente)}</strong></div>
                  <div class="inline-kv"><span>Destino (Usuario):</span> <strong class="mono" style="color:#60a5fa;">${escapeHtml(p.usuarioOriginal)}</strong></div>
                  <div class="inline-kv"><span>Depósito / Retiro / Saldo:</span> <strong class="mono">${formatMoney(p.deposito)} / ${formatMoney(p.retiro)} / Saldo: ${formatMoney(p.saldo)}</strong></div>
                ` : '<div style="color:var(--text-muted);">No figura en los datos pegados del Panel.</div>'}
              </div>
              <div class="inline-drop-card">
                <h5>📊 Datos Completos de Google Sheets / Excel</h5>
                ${e ? `
                  <div class="inline-kv"><span>Fila en Google Sheets:</span> <strong class="mono" style="color:#fbbf24;">${escapeHtml(formatExcelRowRef(e))} (${escapeHtml(e.fechaDia || '')} · ${escapeHtml(e.turno || '')})</strong></div>
                  <div class="inline-kv"><span>Usuario anotado:</span> <strong class="mono" style="color:#c084fc;">${escapeHtml(e.usuarioOriginal)}</strong></div>
                  <div class="inline-kv"><span>Carga / Retiro:</span> <strong class="mono">${formatMoney(e.carga)} / ${formatMoney(e.retiro)}</strong></div>
                  <div class="inline-kv"><span>Hora en Excel:</span> <strong class="mono">${escapeHtml(e.hora || '—')}</strong></div>
                  <div class="inline-kv"><span>Billetera:</span> <strong>${escapeHtml(e.billetera || '—')}</strong></div>
                  <div class="inline-kv"><span>Estado OK:</span> <strong style="color:${isChecked ? 'var(--success)' : 'var(--text-muted)'};">${isChecked ? 'OK ✓' : 'Pendiente'}</strong></div>
                ` : '<div style="color:var(--text-muted);">No fue registrado en la hoja de Google Sheets / Excel.</div>'}
              </div>
            </div>
          </td>
        </tr>
      `);
    }
  });

  tbody.innerHTML = htmlRows.join('');
}

// =========================================================
// EXPORTACIÓN Y COPIADO DE COLUMNA 'OK'
// =========================================================
function copyOkColumn() {
  const activeExcel = getActiveExcelItems();
  if (activeExcel.length === 0) {
    showToast('⚠️ Primero sincroniza o carga la hoja de Excel');
    return;
  }
  const activeDay = getResolvedActiveDay();
  const maxRow = Math.max(...activeExcel.map(e => e.excelRowNumber));
  const minRow = Math.min(...activeExcel.map(e => e.excelRowNumber));
  const byRow = {};
  activeExcel.forEach(item => {
    byRow[item.excelRowNumber] = AppState.manualChecks[item.uid] ? 'ok' : '';
  });

  const lines = [];
  for (let r = minRow; r <= maxRow; r++) {
    lines.push(byRow[r] !== undefined ? byRow[r] : '');
  }

  const dayLabel = activeDay === 'all' ? 'todos los días' : `día ${activeDay}`;
  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    showToast(`📋 Columna 'ok' (${dayLabel}) copiada: pegar desde Fila #${minRow} hasta #${maxRow}`);
  });
}

function exportUpdatedExcel() {
  if (AppState.currentWorkbook && (AppState.excelMode === 'file' || AppState.excelMode === 'gsheet')) {
    const sheetsByName = {};
    (AppState.currentWorkbook.SheetNames || []).forEach(sn => {
      const s = AppState.currentWorkbook.Sheets[sn];
      if (s) {
        sheetsByName[sn] = XLSX.utils.sheet_to_json(s, { header: 1, defval: '', raw: false });
      }
    });

    AppState.excelItems.forEach(item => {
      const sn = item.sheetName || AppState.currentWorkbook.SheetNames[0];
      const rows = sheetsByName[sn];
      if (!rows) return;
      const rIdx = item.rowIndex0;
      const cIdx = item.colOkIndex;
      if (!rows[rIdx]) rows[rIdx] = [];
      rows[rIdx][cIdx] = AppState.manualChecks[item.uid] ? 'ok' : '';
    });

    Object.keys(sheetsByName).forEach(sn => {
      AppState.currentWorkbook.Sheets[sn] = XLSX.utils.aoa_to_sheet(sheetsByName[sn]);
    });

    const missingInExcel = AppState.comparisonResults.filter(r => r.status === 'only_panel');

    if (missingInExcel.length > 0) {
      const missingRows = [
        ['Horario', 'ID Panel', 'Fecha Completa', 'Operación', 'Tipo', 'Agente', 'Usuario (Destino)', 'Depósito', 'Retiro', 'Saldo', 'Observación']
      ];
      missingInExcel.forEach(m => {
        missingRows.push([
          m.panel.timeStr,
          m.panel.id,
          m.panel.fecha,
          m.panel.operacionRaw,
          m.panel.tipo,
          m.panel.agente,
          m.panel.usuarioOriginal,
          m.panel.deposito,
          m.panel.retiro,
          m.panel.saldo,
          'Falta registrar en el Excel'
        ]);
      });
      const wsMissing = XLSX.utils.aoa_to_sheet(missingRows);
      const repName = 'Faltantes_en_Excel';
      AppState.currentWorkbook.Sheets[repName] = wsMissing;
      if (!AppState.currentWorkbook.SheetNames.includes(repName)) {
        AppState.currentWorkbook.SheetNames.push(repName);
      }
    }

    const outName = AppState.currentFileName.replace(/(\.xlsx|\.xls|\.csv)$/i, '') + '_verificado.xlsx';
    XLSX.writeFile(AppState.currentWorkbook, outName);
    showToast(`📥 Archivo descargado: ${outName}`);
  } else {
    if (AppState.comparisonResults.length === 0) {
      showToast('⚠️ No hay datos para exportar');
      return;
    }
    const wb = XLSX.utils.book_new();
    const data = [
      ['OK', 'Horario', 'Fila Excel', 'Estado', 'Tipo', 'Usuario Excel', 'Usuario Panel', 'Monto Panel', 'Monto Excel', 'Diferencia', 'Billetera Excel', 'ID Panel', 'Agente', 'Saldo Panel']
    ];
    AppState.comparisonResults.forEach(r => {
      const statusMap = {
        matched: 'COINCIDE EXACTO',
        similar: 'COINCIDE (USUARIO SIMILAR / SUMA)',
        diff: 'MONTO DIFERENTE',
        only_panel: 'FALTA EN EXCEL',
        only_excel: 'FALTA EN PANEL'
      };
      data.push([
        AppState.manualChecks[r.key] ? 'ok' : '',
        r.panel ? r.panel.timeStr : (r.excel ? r.excel.hora : ''),
        r.excel ? r.excel.excelRowNumber : '',
        statusMap[r.status],
        r.tipo,
        r.excel ? r.excel.usuarioOriginal : '',
        r.panel ? r.panel.usuarioOriginal : '',
        r.panel ? r.panel.monto : '',
        r.excel ? r.excel.monto : '',
        (r.panel && r.excel) ? (r.panel.monto - r.excel.monto) : '',
        r.excel ? r.excel.billetera : '',
        r.panel ? r.panel.id : '',
        r.panel ? r.panel.agente : '',
        r.panel ? r.panel.saldo : ''
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Verificacion');
    XLSX.writeFile(wb, 'reporte_verificacion.xlsx');
    showToast('📥 Reporte descargado: reporte_verificacion.xlsx');
  }
}

function loadDemoData() {
  const dropInputs = document.getElementById('dropInputs');
  if (dropInputs && dropInputs.classList.contains('collapsed')) {
    dropInputs.classList.remove('collapsed');
  }

  document.getElementById('panelInput').value = [
    '1ufz\t3/11/2026 15:34\tDEPOSITO (Solicitado por 29722092)\tnaycelu543\tespindolaliliana1\t2000 \t0 \t2000 \t',
    'b3ni\t3/11/2026 15:30\tDEPOSITO (Solicitado por 29722092)\tnaycelu543\trominaweigel2\t5000 \t0 \t5000 \t',
    'tjx3\t3/11/2026 15:30\tDEPOSITO (Solicitado por 29722092)\tnaycelu543\troxanabt091\t30.000 \t0 \t30.000 \t',
    '0umm\t3/11/2026 0:05\tDEPOSITO (Solicitado por 29722092)\tnaycelu543\tbetty.yumm\t3000 \t0 \t3000 \t',
    'q1ks\t3/11/2026 0:05\tDEPOSITO (Solicitado por 29722092)\tnaycelu543\tbetty.yumm\t500 \t0 \t3500 \t',
    'rg7t\t3/11/2026 0:02\tDEPOSITO (Solicitado por 29722092)\tnaycelu543\trromeronadia\t5000 \t0 \t5000 \t',
    'xcsb\t3/11/2026 0:01\tDEPOSITO (Solicitado por 29722092)\tnaycelu543\tferfranguella0\t9000 \t0 \t9000 \t'
  ].join('\n');

  parsePanelInput();
  if (AppState.excelMode === 'gsheet') {
    syncGoogleSheet(false);
  } else {
    runComparison();
  }
}

function clearAll() {
  document.getElementById('panelInput').value = '';
  document.getElementById('excelPasteInput').value = '';
  document.getElementById('excelFileInput').value = '';
  AppState.panelItems = [];
  AppState.comparisonResults = [];
  AppState.currentVisibleRows = [];
  AppState.selectedRowKey = null;
  AppState.expandedDrops = {};
  AppState.manualChecks = {};
  closeComparisonModal();
  document.getElementById('panelCountBadge').textContent = '0 movimientos';
  document.getElementById('pillPanelCount').textContent = '0';
  runComparison();
  showToast('🗑️ Datos del Panel limpiados');
}
