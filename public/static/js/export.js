// ============================================================================
// Utilitaires d'export EXCEL (.xlsx via SheetJS) et PDF (via jsPDF+autoTable)
// pour tous les rapports/tableaux de la plateforme.
//
// Utilisation :
//   exportTableToExcel({ filename, sheetName, title, columns, rows })
//   exportTableToPdf({ filename, title, subtitle, columns, rows, orientation })
//   exportButtons('functionPrefix') -> HTML des 2 boutons
//
// columns : [{ header: 'Nom', key: 'nom' }, ...]
// rows    : [{ nom: '...', ... }, ...]   (valeurs déjà formatées de préférence)
// ============================================================================

const CATEGORY_LABELS = {
  normal: 'Élève normal',
  indigent: 'Indigent',
  fils_enseignant: "Fils d'enseignant"
}

function categoryLabel(cat) {
  return CATEGORY_LABELS[cat] || CATEGORY_LABELS.normal
}

function categoryBadge(cat) {
  const c = cat || 'normal'
  const map = {
    normal: 'badge-blue',
    indigent: 'badge-amber',
    fils_enseignant: 'badge-green'
  }
  return `<span class="badge ${map[c] || 'badge-gray'}">${categoryLabel(c)}</span>`
}

/** Options du <select> de catégorie d'élève. */
function categoryOptions(selected) {
  return Object.entries(CATEGORY_LABELS)
    .map(([v, l]) => `<option value="${v}" ${v === (selected || 'normal') ? 'selected' : ''}>${l}</option>`)
    .join('')
}

// ---------------------------------------------------------------------------
// EXPORT EXCEL
// ---------------------------------------------------------------------------
function exportTableToExcel({ filename, sheetName = 'Rapport', title = '', columns, rows }) {
  if (typeof XLSX === 'undefined') { toast('Librairie Excel non chargée', 'error'); return }
  const headerRow = columns.map(c => c.header)
  const dataRows = rows.map(r => columns.map(c => r[c.key] ?? ''))

  const aoa = []
  if (title) {
    aoa.push([title])
    aoa.push([])
  }
  aoa.push(headerRow)
  aoa.push(...dataRows)

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  // Largeurs de colonnes auto (approximation par longueur max)
  ws['!cols'] = columns.map((c, i) => {
    let max = String(c.header).length
    for (const r of dataRows) {
      const len = String(r[i] ?? '').length
      if (len > max) max = len
    }
    return { wch: Math.min(Math.max(max + 2, 10), 50) }
  })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : filename + '.xlsx')
}

/** Export multi-feuilles : sheets = [{ sheetName, title, columns, rows }, ...] */
function exportSheetsToExcel({ filename, sheets }) {
  if (typeof XLSX === 'undefined') { toast('Librairie Excel non chargée', 'error'); return }
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const headerRow = s.columns.map(c => c.header)
    const dataRows = s.rows.map(r => s.columns.map(c => r[c.key] ?? ''))
    const aoa = []
    if (s.title) { aoa.push([s.title]); aoa.push([]) }
    aoa.push(headerRow)
    aoa.push(...dataRows)
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = s.columns.map((c, i) => {
      let max = String(c.header).length
      for (const r of dataRows) {
        const len = String(r[i] ?? '').length
        if (len > max) max = len
      }
      return { wch: Math.min(Math.max(max + 2, 10), 50) }
    })
    XLSX.utils.book_append_sheet(wb, ws, String(s.sheetName || 'Feuille').slice(0, 31))
  }
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : filename + '.xlsx')
}

// ---------------------------------------------------------------------------
// EXPORT PDF
// ---------------------------------------------------------------------------
function exportTableToPdf({ filename, title = '', subtitle = '', columns, rows, orientation = 'portrait' }) {
  if (typeof window.jspdf === 'undefined') { toast('Librairie PDF non chargée', 'error'); return }
  const { jsPDF } = window.jspdf
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' })

  let y = 15
  if (title) {
    doc.setFontSize(14)
    doc.setFont(undefined, 'bold')
    doc.text(title, 14, y)
    y += 7
  }
  if (subtitle) {
    doc.setFontSize(10)
    doc.setFont(undefined, 'normal')
    doc.setTextColor(100)
    doc.text(subtitle, 14, y)
    y += 6
    doc.setTextColor(0)
  }

  doc.autoTable({
    startY: y,
    head: [columns.map(c => c.header)],
    body: rows.map(r => columns.map(c => String(r[c.key] ?? ''))),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 }
  })

  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(130)
    doc.text(
      `Généré le ${new Date().toLocaleDateString('fr-FR')} — page ${i}/${pageCount}`,
      14,
      doc.internal.pageSize.getHeight() - 8
    )
  }

  doc.save(filename.endsWith('.pdf') ? filename : filename + '.pdf')
}

/** Export PDF multi-sections : sections = [{ title, columns, rows }, ...] */
function exportSectionsToPdf({ filename, title = '', subtitle = '', sections, orientation = 'portrait' }) {
  if (typeof window.jspdf === 'undefined') { toast('Librairie PDF non chargée', 'error'); return }
  const { jsPDF } = window.jspdf
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' })

  let y = 15
  if (title) {
    doc.setFontSize(14)
    doc.setFont(undefined, 'bold')
    doc.text(title, 14, y)
    y += 7
  }
  if (subtitle) {
    doc.setFontSize(10)
    doc.setFont(undefined, 'normal')
    doc.setTextColor(100)
    doc.text(subtitle, 14, y)
    y += 8
    doc.setTextColor(0)
  }

  for (const s of sections) {
    if (y > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 15 }
    if (s.title) {
      doc.setFontSize(11)
      doc.setFont(undefined, 'bold')
      doc.text(s.title, 14, y)
      y += 4
    }
    doc.autoTable({
      startY: y,
      head: [s.columns.map(c => c.header)],
      body: s.rows.map(r => s.columns.map(c => String(r[c.key] ?? ''))),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 14, right: 14 }
    })
    y = doc.lastAutoTable.finalY + 10
  }

  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(130)
    doc.text(
      `Généré le ${new Date().toLocaleDateString('fr-FR')} — page ${i}/${pageCount}`,
      14,
      doc.internal.pageSize.getHeight() - 8
    )
  }

  doc.save(filename.endsWith('.pdf') ? filename : filename + '.pdf')
}

/** Boutons d'export standards (appellent <prefix>Excel() et <prefix>Pdf()). */
function exportButtons(prefix) {
  return `
    <button onclick="${prefix}Excel()" class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg text-sm font-semibold"><i class="fas fa-file-excel mr-1.5"></i>Excel</button>
    <button onclick="${prefix}Pdf()" class="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg text-sm font-semibold"><i class="fas fa-file-pdf mr-1.5"></i>PDF</button>`
}
