// =====================================================================
// trackerExport.js — turns the shared sheet model (trackerSheet.js) into
// CSV, Excel (.xlsx) and PDF files.
//
// Every emitter takes one or more "sections" so the same code serves both
// cases the app needs:
//   * a devotee exporting their own Sadhana        → 1 section
//   * a counsellor exporting all their counsellees → N sections, which
//     become N worksheets in Excel / N chapters in the PDF, plus a
//     comparison summary sheet.
//
// The heavy libraries (write-excel-file, jspdf) are imported lazily so
// they stay out of the initial bundle — nobody pays for them until they
// actually tap Export.
// =====================================================================

const SAFFRON = '#F97316'
const SLATE = '#1E293B'
const SLATE_LIGHT = '#334155'
const ORANGE_TINT = '#FFF7ED'
const YELLOW = '#FACC15'

function sanitizeFilename(s) {
  return String(s ?? 'sadhana')
    .replace(/[^a-zA-Z0-9\-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'sadhana'
}

/** Excel worksheet names: <=31 chars and none of : \ / ? * [ ] */
function sanitizeSheetName(s, fallback = 'Sheet') {
  const clean = String(s ?? '').replace(/[:\\/?*[\]]/g, ' ').trim()
  return (clean || fallback).slice(0, 31)
}

export function buildExportFilename({ title, rangeLabel, ext }) {
  const parts = [sanitizeFilename(title)]
  if (rangeLabel) parts.push(sanitizeFilename(rangeLabel))
  return `${parts.join('_')}.${ext}`
}

// ---------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------
function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csvRow(cells) { return cells.map(csvCell).join(',') }

/** @param {{title: string, subtitle?: string, model: object}[]} sections */
export function toCsv(sections, { title, rangeLabel } = {}) {
  const lines = []
  if (title) lines.push(csvRow([title]))
  if (rangeLabel) lines.push(csvRow([rangeLabel]))

  sections.forEach((section, si) => {
    if (si > 0 || sections.length > 1) {
      lines.push('')
      lines.push(csvRow([section.title]))
      if (section.subtitle) lines.push(csvRow([section.subtitle]))
    }
    const { model } = section

    // Group header, offset by the Date + Day columns and expanded across
    // each group's span so the CSV lines up with the Excel/PDF layout.
    const groupCells = ['', '']
    for (const g of model.groupHeader) {
      groupCells.push(g.label)
      for (let i = 1; i < g.span; i += 1) groupCells.push('')
    }
    const calcCount = model.columns.filter((c) => c.kind === 'calc').length
    if (calcCount) {
      groupCells.push('Totals')
      for (let i = 1; i < calcCount; i += 1) groupCells.push('')
    }
    lines.push(csvRow(groupCells))

    lines.push(csvRow(['Date', 'Day', ...model.columns.map((c) => c.label)]))
    lines.push(csvRow(['', 'Max', ...model.maxRow.map((m) => (m == null ? '' : m))]))

    for (const row of model.rows) {
      lines.push(csvRow([row.dateLabel, row.dayLabel, ...row.cells.map((c) => c.text)]))
    }
    lines.push(csvRow([
      'Total', model.totals.pct == null ? '' : `${model.totals.pct}%`,
      ...model.totals.cells.map((c) => (c == null ? '' : c)),
    ]))
  })

  // BOM so Excel opens UTF-8 correctly on Windows.
  return `\uFEFF${lines.join('\r\n')}`
}

// ---------------------------------------------------------------------
// Excel (.xlsx)
// ---------------------------------------------------------------------
const HEAD = { fontWeight: 'bold', color: '#FFFFFF', align: 'center', wrap: true }

// write-excel-file rejects a numeric `format` on a String cell, so an
// empty value must drop the format entirely rather than keep "0.00".
function numCell(value, extra = {}, fmt = '0.00') {
  const empty = value === null || value === undefined || value === ''
  return empty
    ? { value: null, type: String, ...extra }
    : { value: Number(value), type: Number, format: fmt, ...extra }
}

function sheetDataFor(section) {
  const { model } = section
  const width = 2 + model.columns.length
  const pad = (cells) => {
    const out = [...cells]
    while (out.length < width) out.push(null)
    return out
  }

  const data = []

  data.push(pad([{ value: section.title, fontWeight: 'bold', fontSize: 14, columnSpan: Math.min(width, 6) }]))
  if (section.subtitle) {
    data.push(pad([{ value: section.subtitle, color: '#64748B', columnSpan: Math.min(width, 6) }]))
  }
  data.push(pad([]))

  // Group header row — merged across each group's span.
  const groupRow = [null, null]
  for (const g of model.groupHeader) {
    groupRow.push({ value: g.label, ...HEAD, backgroundColor: SAFFRON, columnSpan: g.span })
    for (let i = 1; i < g.span; i += 1) groupRow.push(null)
  }
  data.push(pad(groupRow))

  // Column header row.
  data.push(pad([
    { value: 'Date', ...HEAD, backgroundColor: SLATE },
    { value: 'Day', ...HEAD, backgroundColor: SLATE },
    ...model.columns.map((c) => ({
      value: c.label,
      ...HEAD,
      backgroundColor: c.kind === 'calc' ? (c.isHighlighted ? YELLOW : SLATE_LIGHT) : SLATE,
      color: c.kind === 'calc' && c.isHighlighted ? '#1E293B' : '#FFFFFF',
    })),
  ]))

  // Max-marks row.
  data.push(pad([
    { value: null, backgroundColor: ORANGE_TINT },
    { value: 'Max', fontWeight: 'bold', color: '#C2410C', align: 'center', backgroundColor: ORANGE_TINT },
    ...model.maxRow.map((m) => numCell(m, {
      fontWeight: 'bold', color: '#C2410C', align: 'center', backgroundColor: ORANGE_TINT,
    })),
  ]))

  // Day rows.
  for (const row of model.rows) {
    data.push(pad([
      { value: row.dateLabel, fontWeight: 'bold' },
      { value: row.dayLabel, color: '#64748B' },
      ...row.cells.map((cell) => {
        if (cell.kind === 'input') return { value: cell.text || null, type: String, align: 'center' }
        return numCell(cell.text === '' ? null : cell.raw, {
          align: 'center',
          fontWeight: cell.kind === 'calc' ? 'bold' : undefined,
        })
      }),
    ]))
  }

  // Totals row.
  data.push(pad([
    { value: 'Total', fontWeight: 'bold', color: '#FFFFFF', backgroundColor: SAFFRON },
    numCell(
      model.totals.pct == null ? null : model.totals.pct / 100,
      { fontWeight: 'bold', color: '#FFFFFF', align: 'center', backgroundColor: SAFFRON },
      '0.0%'
    ),
    ...model.totals.cells.map((c) => numCell(c, {
      fontWeight: 'bold', color: '#FFFFFF', align: 'center', backgroundColor: SAFFRON,
    })),
  ]))

  const columns = [{ width: 10 }, { width: 6 }, ...model.columns.map((c) => ({
    width: Math.min(22, Math.max(9, String(c.label).length + 2)),
  }))]

  return { data, columns }
}

/** Cross-counsellee comparison sheet — one row per devotee. */
function summarySheetData(sections) {
  const data = [[
    { value: 'Devotee', ...HEAD, backgroundColor: SLATE },
    { value: 'Marks', ...HEAD, backgroundColor: SLATE },
    { value: 'Out of', ...HEAD, backgroundColor: SLATE },
    { value: 'Percentage', ...HEAD, backgroundColor: SLATE },
    { value: 'Days filled', ...HEAD, backgroundColor: SLATE },
  ]]
  for (const s of sections) {
    const t = s.model.totals
    data.push([
      { value: s.title, fontWeight: 'bold' },
      numCell(t.earned, { align: 'center' }),
      numCell(t.max, { align: 'center' }),
      numCell(t.pct == null ? null : t.pct / 100, { align: 'center', fontWeight: 'bold' }, '0.0%'),
      { value: `${t.daysFilled}/${t.daysTotal}`, align: 'center' },
    ])
  }
  return {
    data,
    columns: [{ width: 28 }, { width: 10 }, { width: 10 }, { width: 13 }, { width: 12 }],
  }
}

export async function toXlsxBlob(sections, { includeSummary = false } = {}) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')

  const used = new Set()
  const uniqueName = (name, fallback) => {
    let candidate = sanitizeSheetName(name, fallback)
    let n = 2
    while (used.has(candidate.toLowerCase())) {
      const suffix = ` (${n})`
      candidate = `${candidate.slice(0, 31 - suffix.length)}${suffix}`
      n += 1
    }
    used.add(candidate.toLowerCase())
    return candidate
  }

  const sheets = []
  if (includeSummary && sections.length > 1) {
    const { data, columns } = summarySheetData(sections)
    sheets.push({ data, columns, sheet: uniqueName('Summary'), stickyRowsCount: 1 })
  }
  sections.forEach((section, i) => {
    const { data, columns } = sheetDataFor(section)
    sheets.push({
      data,
      columns,
      sheet: uniqueName(section.sheetName ?? section.title, `Sheet ${i + 1}`),
      orientation: 'landscape',
      stickyColumnsCount: 2,
    })
  })

  return writeXlsxFile(sheets, { fontFamily: 'Calibri', fontSize: 10 }).toBlob()
}

// ---------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------
export async function toPdfBlob(sections, { title, rangeLabel, includeSummary = false } = {}) {
  // Use the NAMED jsPDF export: jspdf's `default` is a namespace object in
  // some module interop paths, not the constructor.
  const [pdfMod, autoTableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const JsPDF = pdfMod.jsPDF ?? pdfMod.default?.jsPDF ?? pdfMod.default
  const autoTable = autoTableMod.default ?? autoTableMod.applyPlugin

  const doc = new JsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  let first = true

  const heading = (main, sub) => {
    if (!first) doc.addPage()
    first = false
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(30, 41, 59)
    doc.text(main, 30, 34)
    if (sub) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(100, 116, 139)
      doc.text(sub, 30, 48)
    }
  }

  if (includeSummary && sections.length > 1) {
    heading(title ?? 'Sadhana Report', rangeLabel)
    autoTable(doc, {
      startY: 62,
      head: [['Devotee', 'Marks', 'Out of', '%', 'Days filled']],
      body: sections.map((s) => {
        const t = s.model.totals
        return [
          s.title,
          t.earned.toFixed(2),
          t.max.toFixed(2),
          t.pct == null ? '—' : `${t.pct.toFixed(1)}%`,
          `${t.daysFilled}/${t.daysTotal}`,
        ]
      }),
      styles: { fontSize: 9, cellPadding: 5 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 30, right: 30 },
    })
  }

  for (const section of sections) {
    const { model } = section
    heading(section.title, section.subtitle ?? rangeLabel)

    // Two header rows: merged group banner, then the column names.
    const groupRow = [
      { content: '', colSpan: 2, styles: { fillColor: [249, 115, 22] } },
      ...model.groupHeader.map((g) => ({
        content: g.label,
        colSpan: g.span,
        styles: { halign: 'center', fillColor: [249, 115, 22], textColor: 255, fontStyle: 'bold' },
      })),
    ]
    const calcCount = model.columns.filter((c) => c.kind === 'calc').length
    if (calcCount) {
      groupRow.push({
        content: 'Totals',
        colSpan: calcCount,
        styles: { halign: 'center', fillColor: [51, 65, 85], textColor: 255, fontStyle: 'bold' },
      })
    }

    const body = model.rows.map((row) => [
      row.dateLabel, row.dayLabel, ...row.cells.map((c) => c.text || '–'),
    ])
    body.push([
      { content: 'Total', styles: { fontStyle: 'bold', fillColor: [249, 115, 22], textColor: 255 } },
      {
        content: model.totals.pct == null ? '' : `${model.totals.pct.toFixed(1)}%`,
        styles: { fontStyle: 'bold', fillColor: [249, 115, 22], textColor: 255, halign: 'center' },
      },
      ...model.totals.cells.map((c) => ({
        content: c == null ? '' : Number(c).toFixed(2),
        styles: { fontStyle: 'bold', fillColor: [249, 115, 22], textColor: 255, halign: 'center' },
      })),
    ])

    autoTable(doc, {
      startY: 62,
      head: [
        groupRow,
        ['Date', 'Day', ...model.columns.map((c) => c.label)],
        ['', 'Max', ...model.maxRow.map((m) => (m == null ? '' : String(m)))],
      ],
      body,
      styles: { fontSize: 6.5, cellPadding: 2.5, overflow: 'linebreak', halign: 'center' },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold', fontSize: 6.5 },
      columnStyles: { 0: { halign: 'left', fontStyle: 'bold' }, 1: { halign: 'left' } },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 20, right: 20 },
      tableWidth: 'auto',
      // Tint the max-marks header row (the 3rd head row).
      didParseCell: (data) => {
        if (data.section === 'head' && data.row.index === 2) {
          data.cell.styles.fillColor = [255, 247, 237]
          data.cell.styles.textColor = [194, 65, 12]
        }
      },
    })
  }

  // Footer page numbers.
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(148, 163, 184)
    doc.text(
      `Page ${i} of ${pages}`,
      pageWidth - 30,
      doc.internal.pageSize.getHeight() - 14,
      { align: 'right' }
    )
  }

  return doc.output('blob')
}

export const EXPORT_FORMATS = [
  { key: 'xlsx', label: 'Excel', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { key: 'pdf', label: 'PDF', ext: 'pdf', mime: 'application/pdf' },
  { key: 'csv', label: 'CSV', ext: 'csv', mime: 'text/csv' },
]

/**
 * Build the file for one format. Returns { blob, filename, mime }.
 */
export async function buildExport({ format: fmt, sections, title, rangeLabel, includeSummary }) {
  const spec = EXPORT_FORMATS.find((f) => f.key === fmt)
  if (!spec) throw new Error(`Unknown export format: ${fmt}`)
  if (!sections?.length) throw new Error('Nothing to export')

  let blob
  if (fmt === 'csv') {
    blob = new Blob([toCsv(sections, { title, rangeLabel })], { type: 'text/csv;charset=utf-8' })
  } else if (fmt === 'xlsx') {
    blob = await toXlsxBlob(sections, { includeSummary })
  } else {
    blob = await toPdfBlob(sections, { title, rangeLabel, includeSummary })
  }

  return {
    blob,
    mime: spec.mime,
    filename: buildExportFilename({ title, rangeLabel, ext: spec.ext }),
  }
}
