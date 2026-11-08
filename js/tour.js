// =========================================================
// PRODUCT TOUR INTERACTIVO Y CENTRO DE AYUDA (tour.js)
// =========================================================

const TOUR_STEPS = [
  {
    targetId: 'stepCardPanel',
    badge: 'Paso 1 de 6',
    title: '1. Pega los movimientos del Panel',
    text: 'Copia las filas directamente desde tu Panel Administrativo y pégalas aquí. El sistema reconoce automáticamente el ID, la fecha/hora, el usuario, depósitos, retiros y saldos.'
  },
  {
    targetId: 'stepCardExcel',
    badge: 'Paso 2 de 6',
    title: '2. Planilla de las Trabajadoras (Supabase o Google Sheets)',
    text: 'Acá podés elegir de dónde traer los datos: desde la base en la nube de Supabase (lo que cargan las chicas en cargas.html) o desde tu enlace en vivo de Google Sheets.'
  },
  {
    targetId: 'btnSyncSupabase',
    badge: 'Paso 3 de 6',
    title: '3. Traer Cargas Ahora (Supabase)',
    text: 'Con este botón traes al instante todos los depósitos y premios que las operadoras acaban de anotar en cargas.html desde sus celulares o computadoras.'
  },
  {
    targetId: 'statsSection',
    badge: 'Paso 4 de 6',
    title: '4. Filtra por Estado en 1 Clic',
    text: 'Haz clic en cualquiera de estas tarjetas para ver solo las Coincidencias Exactas, Nombres Similares (errores de tipeo), Montos Diferentes, o lo que falta en la planilla o en el Panel.'
  },
  {
    targetId: 'tableSection',
    badge: 'Paso 5 de 6',
    title: '5. Navega con Flechas y Doble Clic',
    text: 'Haz 1 clic en una fila y usa las flechas ↑ y ↓ para subir y bajar. Presiona FLECHA DERECHA (→) o ESPACIO para marcar "OK", el botón ▼ para ver todos los datos, o haz DOBLE CLIC para comparar.'
  },
  {
    targetId: 'exportDropdownWrap',
    badge: 'Paso 6 de 6',
    title: '6. Copia la columna OK o Descarga',
    text: 'Desde este menú desplegable ("Acciones OK y Exportar") puedes marcar todas las coincidencias como OK, copiar la columna "ok" o generar reportes PDF listos para entregar.'
  }
];

let currentTourStep = -1;

function startProductTour() {
  closeHelpModal();
  const dropInputs = document.getElementById('dropInputs');
  if (dropInputs && dropInputs.classList.contains('collapsed')) {
    dropInputs.classList.remove('collapsed');
  }
  currentTourStep = 0;
  showTourStep(currentTourStep);
}

function showTourStep(idx) {
  clearTourHighlights();
  const tooltip = document.getElementById('tourTooltip');
  if (idx < 0 || idx >= TOUR_STEPS.length) {
    endProductTour();
    return;
  }

  const step = TOUR_STEPS[idx];

  // Si el paso es el botón de Supabase, asegurarse de activar la pestaña de Supabase para que sea visible
  if (step.targetId === 'btnSyncSupabase') {
    setExcelMode('supabase');
  }

  const target = document.getElementById(step.targetId);
  if (!target) {
    endProductTour();
    return;
  }

  target.classList.add('tour-highlight');
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });

  document.getElementById('tourBadge').textContent = step.badge;
  document.getElementById('tourTitle').textContent = step.title;
  document.getElementById('tourText').textContent = step.text;
  document.getElementById('tourPrevBtn').style.display = idx === 0 ? 'none' : 'inline-flex';
  document.getElementById('tourNextBtn').textContent = idx === TOUR_STEPS.length - 1 ? '✅ Finalizar Tour' : 'Siguiente →';

  tooltip.classList.add('active');
  positionTourTooltip(target, tooltip);
}

function positionTourTooltip(target, tooltip) {
  setTimeout(() => {
    const rect = target.getBoundingClientRect();
    const ttRect = tooltip.getBoundingClientRect();
    let top = rect.bottom + 14;
    let left = rect.left + (rect.width / 2) - (ttRect.width / 2);

    if (top + ttRect.height > window.innerHeight - 16) {
      top = Math.max(16, rect.top - ttRect.height - 14);
    }
    left = Math.max(16, Math.min(window.innerWidth - ttRect.width - 16, left));

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }, 120);
}

function nextTourStep() {
  currentTourStep++;
  if (currentTourStep >= TOUR_STEPS.length) {
    endProductTour();
    showToast('🎉 ¡Tour completado! Ya puedes verificar tus transferencias');
  } else {
    showTourStep(currentTourStep);
  }
}

function prevTourStep() {
  if (currentTourStep > 0) {
    currentTourStep--;
    showTourStep(currentTourStep);
  }
}

function clearTourHighlights() {
  document.querySelectorAll('.tour-highlight').forEach(el => el.classList.remove('tour-highlight'));
}

function endProductTour() {
  currentTourStep = -1;
  clearTourHighlights();
  const tooltip = document.getElementById('tourTooltip');
  if (tooltip) tooltip.classList.remove('active');
}

function openHelpModal() {
  document.getElementById('helpModal').classList.add('open');
}

function closeHelpModal() {
  document.getElementById('helpModal').classList.remove('open');
}

// =========================================================
// INICIALIZACIÓN DE EVENTOS AL CARGAR LA PÁGINA
// =========================================================
document.addEventListener('DOMContentLoaded', () => {
  const panelInput = document.getElementById('panelInput');
  const excelPasteInput = document.getElementById('excelPasteInput');
  const excelFileInput = document.getElementById('excelFileInput');
  const dropzone = document.getElementById('dropzone');

  // El procesamiento del panel ahora se hace con el botón '⚡ Procesar y Comparar' para evitar que la página se congele al pegar
  // panelInput.addEventListener('input', () => { ... });

  excelPasteInput.addEventListener('input', () => {
    if (AppState.excelMode === 'paste') {
      parseExcelPaste();
      runComparison();
    }
  });

  excelFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleExcelFile(e.target.files[0]);
    }
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleExcelFile(e.dataTransfer.files[0]);
    }
  });

  // Conectar y sincronizar automáticamente la hoja de Google Sheets al abrir la app
  syncGoogleSheet(true);

  // Atajo para salir del tour con Escape si está activo
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentTourStep !== -1) {
      endProductTour();
    }
  });
});
