// =========================================================
// MOTOR DE COMPARACIÓN INTELIGENTE (matcher.js)
// =========================================================

function sameDayOrUnknown(pItem, eItem) {
  if (!pItem || !eItem) return true;
  if (!pItem.fechaDia || !eItem.fechaDia || pItem.fechaDia === 'Sin fecha' || eItem.fechaDia === 'Sin fecha') return true;
  return pItem.fechaDia === eItem.fechaDia;
}

// Calcula el horario estimado (en minutos del día 0..1439) para cada fila de Excel usando las horas anotadas como anclas
function precalculateExcelEstimatedMinutes(excelItems) {
  const byDay = {};
  excelItems.forEach(item => {
    const d = item.fechaDia || 'Sin fecha';
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(item);
  });

  Object.values(byDay).forEach(dayItems => {
    const n = dayItems.length;
    if (n === 0) return;

    const anchors = [];
    let maxSeenMins = 0;

    dayItems.forEach((item, idx) => {
      if (item.minutesOfDay !== null && item.minutesOfDay !== undefined) {
        let mins = item.minutesOfDay;
        // Si ya pasamos las 18:00 (1080 min) y el trabajador escribió "11:17" en vez de "23:17"
        if (maxSeenMins >= 1080 && mins >= 60 && mins < 720) {
          mins += 720;
        }
        // Evitar que un horario mal tipeado desordene toda la curva
        if (mins >= maxSeenMins - 90) {
          if (mins > maxSeenMins) maxSeenMins = mins;
          anchors.push({ idx, mins });
        }
      }
    });

    if (anchors.length === 0) {
      dayItems.forEach((item, idx) => {
        item.estMinutes = Math.round((idx / Math.max(1, n - 1)) * 1439);
      });
      return;
    }

    const fullAnchors = [];
    if (anchors[0].idx > 0) {
      fullAnchors.push({ idx: 0, mins: Math.max(0, anchors[0].mins - Math.min(anchors[0].mins, anchors[0].idx * 0.5)) });
    }
    anchors.forEach(a => fullAnchors.push(a));
    const lastA = anchors[anchors.length - 1];
    if (lastA.idx < n - 1) {
      fullAnchors.push({ idx: n - 1, mins: Math.min(1439, Math.max(lastA.mins + 30, 1439)) });
    }

    dayItems.forEach((item, idx) => {
      if (item.minutesOfDay !== null && item.minutesOfDay !== undefined) {
        let mins = item.minutesOfDay;
        if (idx > n * 0.65 && mins >= 60 && mins < 720 && lastA.mins >= 1080) {
          mins += 720;
        }
        item.estMinutes = mins;
        return;
      }
      let prev = fullAnchors[0];
      let next = fullAnchors[fullAnchors.length - 1];
      for (let k = 0; k < fullAnchors.length; k++) {
        if (fullAnchors[k].idx <= idx) prev = fullAnchors[k];
        if (fullAnchors[k].idx >= idx) {
          next = fullAnchors[k];
          break;
        }
      }
      if (prev.idx === next.idx) {
        item.estMinutes = prev.mins;
      } else {
        const ratio = (idx - prev.idx) / (next.idx - prev.idx);
        item.estMinutes = Math.round(prev.mins + ratio * (next.mins - prev.mins));
      }
    });
  });
}

function getTimeDiffMinutes(pItem, eItem) {
  const pMins = pItem.minutesOfDay ?? 0;
  const eMins = eItem.estMinutes ?? eItem.minutesOfDay ?? 0;
  return Math.abs(pMins - eMins);
}

function runComparison() {
  const panelItems = getActivePanelItems();
  const excelItems = getActiveExcelItems();

  precalculateExcelEstimatedMinutes(excelItems);

  const usedPanel = new Set();
  const usedExcel = new Set();
  const results = [];

  // PASO 1: Coincidencia EXACTA de usuario + mismo monto (eligiendo el más cercano en horario real)
  excelItems.forEach((eItem) => {
    let bestP = null;
    let bestTimeDiff = Infinity;

    panelItems.forEach((pItem) => {
      if (usedPanel.has(pItem.uid)) return;
      if (pItem.tipo !== eItem.tipo) return;
      if (!sameDayOrUnknown(pItem, eItem)) return;
      if (pItem.usuarioNorm === eItem.usuarioNorm && Math.abs(pItem.monto - eItem.monto) < 0.01) {
        const timeDiff = getTimeDiffMinutes(pItem, eItem);
        if (timeDiff <= 360 && timeDiff < bestTimeDiff) {
          bestTimeDiff = timeDiff;
          bestP = pItem;
        }
      }
    });

    if (bestP) {
      usedPanel.add(bestP.uid);
      usedExcel.add(eItem.uid);
      results.push({
        key: eItem.uid,
        status: 'matched',
        matchNote: '',
        tipo: eItem.tipo,
        panel: bestP,
        excel: eItem
      });
    }
  });

  // PASO 2: Suma de 2 cargas seguidas del mismo usuario en el Panel que suman el monto del Excel
  excelItems.forEach((eItem) => {
    if (usedExcel.has(eItem.uid)) return;
    for (let i = 0; i < panelItems.length; i++) {
      const p1 = panelItems[i];
      if (usedPanel.has(p1.uid) || p1.tipo !== eItem.tipo) continue;
      if (!sameDayOrUnknown(p1, eItem)) continue;
      const sim1 = userSimilarity(p1.usuarioOriginal, eItem.usuarioOriginal);
      if (sim1 < 0.72) continue;
      if (getTimeDiffMinutes(p1, eItem) > 300) continue;

      for (let j = i + 1; j < panelItems.length; j++) {
        const p2 = panelItems[j];
        if (usedPanel.has(p2.uid) || p2.tipo !== eItem.tipo) continue;
        if (!sameDayOrUnknown(p2, eItem)) continue;
        if (p1.usuarioNorm !== p2.usuarioNorm) continue;
        if (Math.abs(p1.minutesOfDay - p2.minutesOfDay) <= 15 && Math.abs((p1.monto + p2.monto) - eItem.monto) < 0.01) {
          usedPanel.add(p1.uid);
          usedPanel.add(p2.uid);
          usedExcel.add(eItem.uid);
          const combinedPanel = {
            ...p1,
            id: `${p1.id} + ${p2.id}`,
            monto: p1.monto + p2.monto,
            deposito: p1.deposito + p2.deposito,
            retiro: p1.retiro + p2.retiro,
            combinedParts: `${formatMoney(p1.monto)} + ${formatMoney(p2.monto)}`
          };
          results.push({
            key: eItem.uid,
            status: 'similar',
            matchNote: `Suma de 2 cargas (${combinedPanel.combinedParts})`,
            tipo: eItem.tipo,
            panel: combinedPanel,
            excel: eItem
          });
          break;
        }
      }
      if (usedExcel.has(eItem.uid)) break;
    }
  });

  // PASO 3: Coincidencia por NOMBRE SIMILAR + MISMO MONTO + CERCANÍA DE HORARIO REAL
  excelItems.forEach((eItem) => {
    if (usedExcel.has(eItem.uid)) return;
    let bestP = null;
    let bestScore = -1;

    panelItems.forEach((pItem) => {
      if (usedPanel.has(pItem.uid)) return;
      if (pItem.tipo !== eItem.tipo) return;
      if (!sameDayOrUnknown(pItem, eItem)) return;
      if (Math.abs(pItem.monto - eItem.monto) >= 0.01) return;

      const sim = userSimilarity(eItem.usuarioOriginal, pItem.usuarioOriginal);
      const timeDiff = getTimeDiffMinutes(pItem, eItem);
      const maxAllowedDiff = (eItem.minutesOfDay !== null && eItem.minutesOfDay !== undefined) ? 150 : 260;

      if (sim >= 0.72 && timeDiff <= maxAllowedDiff) {
        const score = sim - (timeDiff / 300) * 0.25;
        if (score > bestScore) {
          bestScore = score;
          bestP = pItem;
        }
      }
    });

    if (bestP) {
      usedPanel.add(bestP.uid);
      usedExcel.add(eItem.uid);
      results.push({
        key: eItem.uid,
        status: 'similar',
        matchNote: 'Usuario escrito distinto',
        tipo: eItem.tipo,
        panel: bestP,
        excel: eItem
      });
    }
  });

  // PASO 4: Mismo usuario, pero MONTO DIFERENTE (solo si están cerca en horario)
  excelItems.forEach((eItem) => {
    if (usedExcel.has(eItem.uid)) return;
    let bestP = null;
    let bestTimeDiff = Infinity;

    panelItems.forEach((pItem) => {
      if (usedPanel.has(pItem.uid)) return;
      if (pItem.tipo !== eItem.tipo) return;
      if (!sameDayOrUnknown(pItem, eItem)) return;
      const sim = userSimilarity(eItem.usuarioOriginal, pItem.usuarioOriginal);
      const timeDiff = getTimeDiffMinutes(pItem, eItem);
      const maxDiff = (eItem.minutesOfDay !== null && eItem.minutesOfDay !== undefined) ? 45 : 90;

      if (sim >= 0.85 && timeDiff <= maxDiff) {
        if (timeDiff < bestTimeDiff) {
          bestTimeDiff = timeDiff;
          bestP = pItem;
        }
      }
    });

    if (bestP) {
      usedPanel.add(bestP.uid);
      usedExcel.add(eItem.uid);
      results.push({
        key: eItem.uid,
        status: 'diff',
        matchNote: '',
        tipo: eItem.tipo,
        panel: bestP,
        excel: eItem
      });
    }
  });

  // PASO 5: Movimientos solo en PANEL (Falta en el Excel)
  panelItems.forEach((pItem) => {
    if (usedPanel.has(pItem.uid)) return;
    results.push({
      key: pItem.uid,
      status: 'only_panel',
      matchNote: '',
      tipo: pItem.tipo,
      panel: pItem,
      excel: null
    });
  });

  // PASO 6: Movimientos solo en EXCEL (Falta en el Panel)
  excelItems.forEach((eItem) => {
    if (usedExcel.has(eItem.uid)) return;
    results.push({
      key: eItem.uid,
      status: 'only_excel',
      matchNote: '',
      tipo: eItem.tipo,
      panel: null,
      excel: eItem
    });
  });

  assignEstimatedTimeForExcelOnly(results);

  AppState.comparisonResults = results;
  if (typeof renderDayAndShiftBars === 'function') {
    renderDayAndShiftBars();
  }
  updateSummaryStats();
  renderTable();
}

function assignEstimatedTimeForExcelOnly(results) {
  const knownPoints = [];
  results.forEach(r => {
    if (r.excel && r.panel && r.panel.minutesOfDay !== undefined) {
      knownPoints.push({ row: r.excel.excelRowNumber, mins: r.panel.minutesOfDay });
    } else if (r.excel && r.excel.minutesOfDay !== null && r.excel.minutesOfDay !== undefined) {
      knownPoints.push({ row: r.excel.excelRowNumber, mins: r.excel.minutesOfDay });
    }
  });
  knownPoints.sort((a, b) => a.row - b.row);

  results.forEach(r => {
    if (r.panel) {
      r.sortMinutes = r.panel.minutesOfDay;
      r.displayTime = r.panel.timeStr || r.panel.fecha;
    } else if (r.excel) {
      if (r.excel.minutesOfDay !== null && r.excel.minutesOfDay !== undefined) {
        r.sortMinutes = r.excel.minutesOfDay;
        r.displayTime = r.excel.hora;
      } else {
        const rowNum = r.excel.excelRowNumber;
        let prev = null, next = null;
        for (const kp of knownPoints) {
          if (kp.row <= rowNum) prev = kp;
          if (kp.row >= rowNum && !next) next = kp;
        }
        if (prev && next && prev.row !== next.row) {
          const ratio = (rowNum - prev.row) / (next.row - prev.row);
          r.sortMinutes = prev.mins + ratio * (next.mins - prev.mins);
        } else if (prev) {
          r.sortMinutes = prev.mins + (rowNum - prev.row) * 0.5;
        } else if (next) {
          r.sortMinutes = Math.max(0, next.mins - (next.row - rowNum) * 0.5);
        } else {
          r.sortMinutes = rowNum;
        }
        r.displayTime = r.excel.hora || '—';
      }
    }
  });
}

