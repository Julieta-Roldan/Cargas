// =========================================================
// GENERADOR DE REPORTES PDF PROFESIONALES Y SIMPLES (pdf.js)
// =========================================================

function openPdfModal() {
  if (AppState.comparisonResults.length === 0) {
    showToast('⚠️ Primero carga o sincroniza datos para generar el PDF');
    return;
  }

  // Actualizar contadores en vivo dentro del modal de PDF
  updatePdfModalCounts();

  // Poner fecha actual por defecto si no tiene
  const dateInput = document.getElementById('pdfDateInput');
  if (dateInput && !dateInput.value) {
    const now = new Date();
    dateInput.value = now.toLocaleDateString('es-AR') + ' ' + now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }

  const shiftInput = document.getElementById('pdfShiftInput');
  if (shiftInput) {
    const activeDay = getResolvedActiveDay();
    const dayStr = activeDay === 'all' ? 'Todos los días' : `Día ${activeDay}`;
    const shiftStr = AppState.selectedShift === 'all' ? 'Todos los turnos' : AppState.selectedShift;
    shiftInput.value = `${dayStr} (${shiftStr})`;
  }

  document.getElementById('pdfModal').classList.add('open');
}

function closePdfModal() {
  document.getElementById('pdfModal').classList.remove('open');
}

function getFilteredForPdf() {
  const typeEl = document.getElementById('pdfTypeFilter');
  const typeVal = typeEl ? typeEl.value : 'auto';
  let activeType = typeVal;
  if (typeVal === 'auto') {
    activeType = getActiveTypeFilter();
  }
  return AppState.comparisonResults.filter(r => {
    if (activeType !== 'all' && r.tipo !== activeType) return false;
    if (AppState.selectedShift !== 'all') {
      if (!r.excel || r.excel.turno !== AppState.selectedShift) return false;
    }
    return true;
  });
}

function updatePdfModalCounts() {
  const list = getFilteredForPdf();
  const cOnlyPanel = list.filter(r => r.status === 'only_panel').length;
  // Para usuarios mal escritos filtramos aquellos donde el nombre normalizado es distinto
  const cBadNames = list.filter(r => r.status === 'similar' && r.panel && r.excel && r.panel.usuarioNorm !== r.excel.usuarioNorm).length;
  const cSumCharges = list.filter(r => r.status === 'similar' && r.panel && r.panel.combinedParts).length;
  const cDiff = list.filter(r => r.status === 'diff').length;
  const cOnlyExcel = list.filter(r => r.status === 'only_excel').length;
  const cMatched = list.filter(r => r.status === 'matched').length;

  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = `${val} caso(s)`;
  };

  setTxt('pdfCountOnlyPanel', cOnlyPanel);
  setTxt('pdfCountBadNames', cBadNames);
  setTxt('pdfCountSumCharges', cSumCharges);
  setTxt('pdfCountDiff', cDiff);
  setTxt('pdfCountOnlyExcel', cOnlyExcel);
  setTxt('pdfCountMatched', cMatched);
}

// Preajustes rápidos de qué tipo de PDF quiere generar
function selectPdfPreset(preset) {
  const chkSummary = document.getElementById('pdfChkSummary');
  const chkOnlyPanel = document.getElementById('pdfChkOnlyPanel');
  const chkBadNames = document.getElementById('pdfChkBadNames');
  const chkSumCharges = document.getElementById('pdfChkSumCharges');
  const chkDiff = document.getElementById('pdfChkDiff');
  const chkOnlyExcel = document.getElementById('pdfChkOnlyExcel');
  const chkMatched = document.getElementById('pdfChkMatched');
  const titleInput = document.getElementById('pdfTitleInput');

  // Desmarcar todo primero
  [chkSummary, chkOnlyPanel, chkBadNames, chkSumCharges, chkDiff, chkOnlyExcel, chkMatched].forEach(c => {
    if (c) c.checked = false;
  });

  if (preset === 'observations') {
    // Ideal para entregar a los trabajadores con todo lo que deben revisar/corregir
    chkSummary.checked = true;
    chkOnlyPanel.checked = true;
    chkBadNames.checked = true;
    chkDiff.checked = true;
    chkOnlyExcel.checked = true;
    if (titleInput) titleInput.value = 'Reporte de Observaciones y Correcciones (Panel vs Planilla)';
  } else if (preset === 'missing_excel') {
    // Solo cargas de fichas en el panel que no están en el excel
    chkSummary.checked = true;
    chkOnlyPanel.checked = true;
    if (titleInput) titleInput.value = 'Notificación: Cargas de Fichas Faltantes en Planilla';
  } else if (preset === 'bad_names') {
    // Solo nombres de usuarios mal escritos en el excel
    chkBadNames.checked = true;
    if (titleInput) titleInput.value = 'Notificación: Usuarios Mal Escritos en Planilla';
  } else if (preset === 'diffs') {
    // Diferencias de montos y faltantes de ambos lados
    chkSummary.checked = true;
    chkDiff.checked = true;
    chkOnlyPanel.checked = true;
    chkOnlyExcel.checked = true;
    if (titleInput) titleInput.value = 'Reporte de Diferencias de Dinero y Faltantes';
  } else if (preset === 'full') {
    // Reporte completo
    [chkSummary, chkOnlyPanel, chkBadNames, chkSumCharges, chkDiff, chkOnlyExcel, chkMatched].forEach(c => {
      if (c) c.checked = true;
    });
    if (titleInput) titleInput.value = 'Reporte Completo de Auditoría de Transferencias';
  }

  // Actualizar botón activo visualmente
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-preset') === preset);
  });
}

function generatePdfDocument() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast('❌ La librería PDF aún se está cargando. Intenta en 2 segundos.');
    return;
  }

  const list = getFilteredForPdf().slice().sort((a, b) => (a.sortMinutes ?? 0) - (b.sortMinutes ?? 0));

  const incSummary = document.getElementById('pdfChkSummary').checked;
  const incOnlyPanel = document.getElementById('pdfChkOnlyPanel').checked;
  const incBadNames = document.getElementById('pdfChkBadNames').checked;
  const incSumCharges = document.getElementById('pdfChkSumCharges').checked;
  const incDiff = document.getElementById('pdfChkDiff').checked;
  const incOnlyExcel = document.getElementById('pdfChkOnlyExcel').checked;
  const incMatched = document.getElementById('pdfChkMatched').checked;

  if (!incSummary && !incOnlyPanel && !incBadNames && !incSumCharges && !incDiff && !incOnlyExcel && !incMatched) {
    showToast('⚠️ Selecciona al menos una opción para incluir en el PDF');
    return;
  }

  const title = (document.getElementById('pdfTitleInput').value || 'Reporte de Control de Transferencias').trim();
  const workerOrShift = (document.getElementById('pdfShiftInput').value || '').trim();
  const dateStr = (document.getElementById('pdfDateInput').value || new Date().toLocaleDateString('es-AR')).trim();
  const customNote = (document.getElementById('pdfNoteInput').value || '').trim();

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 16;

  // =========================================================
  // ENCABEZADO SIMPLE, LIMPIO Y FORMAL
  // =========================================================
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(20, 30, 45);
  doc.text(title, 14, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(90, 100, 115);
  const metaParts = [`Fecha de emisión: ${dateStr}`];
  if (workerOrShift) metaParts.push(`Turno / Responsable: ${workerOrShift}`);
  doc.text(metaParts.join('   |   '), 14, y);
  y += 4;

  // Línea separadora sobria
  doc.setDrawColor(200, 208, 218);
  doc.setLineWidth(0.4);
  doc.line(14, y, pageWidth - 14, y);
  y += 6;

  // Nota / Observación inicial si el usuario escribió alguna
  if (customNote) {
    doc.setFillColor(246, 248, 250);
    doc.setDrawColor(210, 218, 226);
    const splitNote = doc.splitTextToSize(`Nota: ${customNote}`, pageWidth - 34);
    const boxH = splitNote.length * 4.5 + 5;
    doc.roundedRect(14, y, pageWidth - 28, boxH, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(40, 50, 65);
    doc.text(splitNote, 17, y + 4.5);
    y += boxH + 6;
  }

  // Filtrar grupos de datos
  const rowsOnlyPanel = list.filter(r => r.status === 'only_panel');
  const rowsBadNames = list.filter(r => r.status === 'similar' && r.panel && r.excel && r.panel.usuarioNorm !== r.excel.usuarioNorm);
  const rowsSumCharges = list.filter(r => r.status === 'similar' && r.panel && r.panel.combinedParts);
  const rowsDiff = list.filter(r => r.status === 'diff');
  const rowsOnlyExcel = list.filter(r => r.status === 'only_excel');
  const rowsMatched = list.filter(r => r.status === 'matched');

  let sectionNumber = 1;

  // =========================================================
  // SECCIÓN: RESUMEN GENERAL Y TOTALES
  // =========================================================
  if (incSummary) {
    const totPanelDep = AppState.panelItems.filter(i => i.tipo === 'DEPOSITO').reduce((acc, i) => acc + i.monto, 0);
    const totExcelDep = AppState.excelItems.filter(i => i.tipo === 'DEPOSITO').reduce((acc, i) => acc + i.monto, 0);
    const diffDep = totPanelDep - totExcelDep;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(25, 35, 50);
    doc.text(`${sectionNumber}. Resumen de Control`, 14, y);
    sectionNumber++;
    y += 3;

    doc.autoTable({
      startY: y,
      margin: { left: 14, right: 14 },
      theme: 'grid',
      headStyles: { fillColor: [45, 60, 82], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8.5, textColor: [30, 40, 50] },
      head: [['Concepto Evaluado', 'Cantidad / Monto', 'Detalle']],
      body: [
        ['Total Depósitos en Panel Administrativo', formatMoney(totPanelDep), `${AppState.panelItems.filter(i => i.tipo === 'DEPOSITO').length} cargas en panel`],
        ['Total Cargas en Planilla (Excel / Sheets)', formatMoney(totExcelDep), `${AppState.excelItems.filter(i => i.tipo === 'DEPOSITO').length} cargas en planilla`],
        ['Diferencia en Cargas (Panel - Planilla)', (diffDep > 0 ? '+' : '') + formatMoney(diffDep), diffDep === 0 ? 'Totales cuadrados' : 'Revisar diferencias detalladas abajo'],
        ['Cargas en Panel NO anotadas en Planilla', `${rowsOnlyPanel.length} movimiento(s)`, rowsOnlyPanel.length > 0 ? 'Falta registrar en el Excel' : 'Sin faltantes'],
        ['Usuarios mal escritos en Planilla', `${rowsBadNames.length} caso(s)`, rowsBadNames.length > 0 ? 'Errores de tipeo / abreviaturas' : 'Todos bien escritos'],
        ['Movimientos con monto diferente', `${rowsDiff.length} caso(s)`, rowsDiff.length > 0 ? 'El monto anotado no coincide con el panel' : 'Sin diferencias de monto'],
        ['Anotados en Planilla pero NO en Panel', `${rowsOnlyExcel.length} movimiento(s)`, rowsOnlyExcel.length > 0 ? 'No figuran en el panel pegado' : 'Sin sobrantes']
      ]
    });

    y = doc.lastAutoTable.finalY + 8;
  }

  // Helper para agregar título de sección controlando salto de página
  function addSectionHeader(titleText, subtitleText) {
    if (y > 265) {
      doc.addPage();
      y = 16;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(25, 35, 50);
    doc.text(`${sectionNumber}. ${titleText}`, 14, y);
    sectionNumber++;
    y += 4.5;

    if (subtitleText) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(95, 105, 120);
      doc.text(subtitleText, 14, y);
      y += 2.5;
    }
  }

  // =========================================================
  // SECCIÓN: CARGAS EN PANEL QUE NO ESTÁN EN EL EXCEL
  // =========================================================
  if (incOnlyPanel) {
    addSectionHeader(
      `Cargas/Movimientos en el Panel que NO están en el Excel (${rowsOnlyPanel.length})`,
      'Estos movimientos fueron realizados en el Panel Administrativo pero no figuran anotados en la planilla.'
    );

    if (rowsOnlyPanel.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(100, 110, 120);
      doc.text('No se detectaron cargas faltantes en la planilla.', 14, y + 3);
      y += 10;
    } else {
      const totalMissingMoney = rowsOnlyPanel.reduce((acc, r) => acc + (r.panel ? r.panel.monto : 0), 0);
      const bodyRows = rowsOnlyPanel.map((r, i) => [
        i + 1,
        r.panel.timeStr || r.panel.fecha,
        r.tipo === 'RETIRO' ? 'Retiro' : 'Carga',
        r.panel.usuarioOriginal,
        formatMoney(r.panel.monto),
        r.panel.id,
        r.panel.agente
      ]);

      bodyRows.push([
        '',
        '',
        '',
        'TOTAL NO REGISTRADO:',
        formatMoney(totalMissingMoney),
        '',
        ''
      ]);

      doc.autoTable({
        startY: y,
        margin: { left: 14, right: 14 },
        theme: 'grid',
        headStyles: { fillColor: [55, 65, 81], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8.5, textColor: [30, 35, 45] },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        columnStyles: {
          0: { cellWidth: 10, halign: 'center' },
          1: { cellWidth: 22 },
          2: { cellWidth: 18 },
          4: { halign: 'right', fontStyle: 'bold' }
        },
        head: [['#', 'Hora Panel', 'Tipo', 'Usuario en Panel (Destino)', 'Monto Panel', 'ID Panel', 'Agente']],
        body: bodyRows,
        didParseCell: function(data) {
          if (data.row.index === bodyRows.length - 1 && data.section === 'body') {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fillColor = [238, 242, 246];
          }
        }
      });
      y = doc.lastAutoTable.finalY + 8;
    }
  }

  // =========================================================
  // SECCIÓN: NOMBRES DE USUARIO MAL ESCRITOS EN EL EXCEL
  // =========================================================
  if (incBadNames) {
    addSectionHeader(
      `Usuarios mal escritos o abreviados en la Planilla (${rowsBadNames.length})`,
      'El monto coincide, pero el nombre de usuario fue escrito distinto en el Excel respecto al usuario real del Panel.'
    );

    if (rowsBadNames.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(100, 110, 120);
      doc.text('No se detectaron errores de escritura en los nombres de usuario.', 14, y + 3);
      y += 10;
    } else {
      const bodyRows = rowsBadNames.map((r, i) => [
        i + 1,
        formatExcelRowRef(r.excel),
        r.panel.timeStr || r.excel.hora || '—',
        r.excel.usuarioOriginal,
        r.panel.usuarioOriginal,
        formatMoney(r.excel.monto)
      ]);

      doc.autoTable({
        startY: y,
        margin: { left: 14, right: 14 },
        theme: 'grid',
        headStyles: { fillColor: [55, 65, 81], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8.5, textColor: [30, 35, 45] },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        columnStyles: {
          0: { cellWidth: 10, halign: 'center' },
          1: { cellWidth: 22 },
          2: { cellWidth: 20 },
          4: { fontStyle: 'bold' },
          5: { halign: 'right' }
        },
        head: [['#', 'Fila Planilla', 'Horario', 'Cómo lo escribieron (Excel)', 'Usuario Correcto (Panel)', 'Monto']],
        body: bodyRows
      });
      y = doc.lastAutoTable.finalY + 8;
    }
  }

  // =========================================================
  // SECCIÓN: DIFERENCIAS DE MONTO (MISMO USUARIO, DISTINTO VALOR)
  // =========================================================
  if (incDiff) {
    addSectionHeader(
      `Movimientos con Diferencia de Monto (${rowsDiff.length})`,
      'El usuario figura en ambos lados, pero el monto anotado en la planilla no coincide con el monto del Panel.'
    );

    if (rowsDiff.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(100, 110, 120);
      doc.text('No se detectaron diferencias de monto.', 14, y + 3);
      y += 10;
    } else {
      const bodyRows = rowsDiff.map((r, i) => {
        const diff = r.panel.monto - r.excel.monto;
        return [
          i + 1,
          formatExcelRowRef(r.excel),
          r.panel.timeStr || '—',
          r.excel.usuarioOriginal,
          formatMoney(r.panel.monto),
          formatMoney(r.excel.monto),
          (diff > 0 ? '+' : '') + formatMoney(diff)
        ];
      });

      doc.autoTable({
        startY: y,
        margin: { left: 14, right: 14 },
        theme: 'grid',
        headStyles: { fillColor: [55, 65, 81], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8.5, textColor: [30, 35, 45] },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        columnStyles: {
          0: { cellWidth: 10, halign: 'center' },
          4: { halign: 'right' },
          5: { halign: 'right' },
          6: { halign: 'right', fontStyle: 'bold' }
        },
        head: [['#', 'Fila Planilla', 'Horario', 'Usuario', 'Monto en Panel', 'Monto en Excel', 'Diferencia']],
        body: bodyRows
      });
      y = doc.lastAutoTable.finalY + 8;
    }
  }

  // =========================================================
  // SECCIÓN: ANOTADOS EN EL EXCEL PERO QUE NO ESTÁN EN EL PANEL
  // =========================================================
  if (incOnlyExcel) {
    addSectionHeader(
      `Anotados en la Planilla que NO figuran en el Panel (${rowsOnlyExcel.length})`,
      'Movimientos registrados por los trabajadores en el Excel que no aparecen en el listado del Panel.'
    );

    if (rowsOnlyExcel.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(100, 110, 120);
      doc.text('No hay movimientos sobrantes en la planilla.', 14, y + 3);
      y += 10;
    } else {
      const totalExtraExcel = rowsOnlyExcel.reduce((acc, r) => acc + (r.excel ? r.excel.monto : 0), 0);
      const bodyRows = rowsOnlyExcel.map((r, i) => [
        i + 1,
        formatExcelRowRef(r.excel),
        r.tipo === 'RETIRO' ? 'Retiro' : 'Carga',
        r.excel.usuarioOriginal,
        formatMoney(r.excel.monto),
        r.excel.hora || '—',
        r.excel.billetera || '—'
      ]);

      bodyRows.push([
        '',
        '',
        '',
        'TOTAL EN PLANILLA SIN PANEL:',
        formatMoney(totalExtraExcel),
        '',
        ''
      ]);

      doc.autoTable({
        startY: y,
        margin: { left: 14, right: 14 },
        theme: 'grid',
        headStyles: { fillColor: [55, 65, 81], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8.5, textColor: [30, 35, 45] },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        columnStyles: {
          0: { cellWidth: 10, halign: 'center' },
          4: { halign: 'right', fontStyle: 'bold' }
        },
        head: [['#', 'Fila Planilla', 'Tipo', 'Usuario Anotado', 'Monto Anotado', 'Hora Excel', 'Billetera']],
        body: bodyRows,
        didParseCell: function(data) {
          if (data.row.index === bodyRows.length - 1 && data.section === 'body') {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fillColor = [238, 242, 246];
          }
        }
      });
      y = doc.lastAutoTable.finalY + 8;
    }
  }

  // =========================================================
  // SECCIÓN: CARGAS DIVIDIDAS / SUMADAS
  // =========================================================
  if (incSumCharges && rowsSumCharges.length > 0) {
    addSectionHeader(
      `Cargas divididas en Panel anotadas juntas en Planilla (${rowsSumCharges.length})`,
      'El usuario recibió 2 cargas seguidas en el Panel que fueron anotadas en una sola fila del Excel.'
    );

    const bodyRows = rowsSumCharges.map((r, i) => [
      i + 1,
      formatExcelRowRef(r.excel),
      r.panel.timeStr || '—',
      `${r.excel.usuarioOriginal} (${r.panel.usuarioOriginal})`,
      r.panel.combinedParts,
      formatMoney(r.excel.monto)
    ]);

    doc.autoTable({
      startY: y,
      margin: { left: 14, right: 14 },
      theme: 'grid',
      headStyles: { fillColor: [55, 65, 81], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8.5, textColor: [30, 35, 45] },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      head: [['#', 'Fila Planilla', 'Horario', 'Usuario', 'Cargas en Panel', 'Total en Excel']],
      body: bodyRows
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // =========================================================
  // SECCIÓN: COINCIDENCIAS EXACTAS (OPCIONAL)
  // =========================================================
  if (incMatched) {
    addSectionHeader(
      `Movimientos Correctos / Coincidencias Exactas (${rowsMatched.length})`,
      'Movimientos que coinciden tanto en nombre de usuario como en monto.'
    );

    if (rowsMatched.length > 0) {
      const bodyRows = rowsMatched.map((r, i) => [
        i + 1,
        formatExcelRowRef(r.excel),
        r.panel.timeStr || '—',
        r.tipo === 'RETIRO' ? 'Retiro' : 'Carga',
        r.excel.usuarioOriginal,
        formatMoney(r.excel.monto),
        r.panel.id,
        AppState.manualChecks[r.key] ? 'OK' : ''
      ]);

      doc.autoTable({
        startY: y,
        margin: { left: 14, right: 14 },
        theme: 'grid',
        headStyles: { fillColor: [55, 65, 81], textColor: 255, fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8, textColor: [30, 35, 45] },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        columnStyles: {
          0: { cellWidth: 10, halign: 'center' },
          5: { halign: 'right' },
          7: { halign: 'center', fontStyle: 'bold' }
        },
        head: [['#', 'Fila', 'Hora', 'Tipo', 'Usuario', 'Monto', 'ID Panel', 'Verif.']],
        body: bodyRows
      });
      y = doc.lastAutoTable.finalY + 8;
    }
  }

  // Numeración de páginas al pie de cada hoja
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(130, 138, 150);
    doc.text(
      `Página ${p} de ${pageCount}   ·   Control de Transferencias (Panel vs Planilla)`,
      pageWidth / 2,
      290,
      { align: 'center' }
    );
  }

  const safeDate = new Date().toISOString().slice(0, 10);
  const fileName = `Reporte_Control_${safeDate}.pdf`;
  doc.save(fileName);
  closePdfModal();
  showToast(`📄 PDF generado y descargado: ${fileName}`);
}

