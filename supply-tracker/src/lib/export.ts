"use client";

export interface Column<T> { header: string; value: (row: T) => string | number | null | undefined; width?: number }
export interface ReportMeta { title: string; subtitle?: string; generatedBy?: string }

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (s: string) => s.replace(/[^a-z0-9-_]+/gi, "_").replace(/_+/g, "_").toLowerCase();
const stamp = () => new Date().toISOString().slice(0, 10);

/** Neutralises spreadsheet formula injection (cells starting with = + - @). */
export function sanitizeCell(v: unknown): string | number {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return v;
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function toCSV<T>(columns: Column<T>[], rows: T[]): string {
  const esc = (v: unknown) => {
    const s = String(sanitizeCell(v));
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => esc(c.header)).join(","), ...rows.map((r) => columns.map((c) => esc(c.value(r))).join(","))].join("\r\n");
}

export function exportCSV<T>(meta: ReportMeta, columns: Column<T>[], rows: T[]) {
  download(new Blob(["﻿" + toCSV(columns, rows)], { type: "text/csv;charset=utf-8" }), `${safeName(meta.title)}_${stamp()}.csv`);
}

export async function exportXLSX<T>(meta: ReportMeta, columns: Column<T>[], rows: T[]) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Supply Team Portal";
  wb.created = new Date();
  const ws = wb.addWorksheet(meta.title.slice(0, 31));
  ws.addRow([meta.title]).font = { bold: true, size: 14 };
  if (meta.subtitle) ws.addRow([meta.subtitle]).font = { italic: true, color: { argb: "FF64748B" } };
  ws.addRow([`Generated ${new Date().toLocaleString()}${meta.generatedBy ? ` by ${meta.generatedBy}` : ""}`]).font = { size: 9, color: { argb: "FF64748B" } };
  ws.addRow([]);
  const header = ws.addRow(columns.map((c) => c.header));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } }; });
  for (const r of rows) ws.addRow(columns.map((c) => sanitizeCell(c.value(r))));
  columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width ?? Math.min(48, Math.max(12, c.header.length + 4)); });
  ws.views = [{ state: "frozen", ySplit: header.number }];
  ws.autoFilter = { from: { row: header.number, column: 1 }, to: { row: header.number, column: columns.length } };
  const buf = await wb.xlsx.writeBuffer();
  download(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${safeName(meta.title)}_${stamp()}.xlsx`);
}

export async function exportPDF<T>(meta: ReportMeta, columns: Column<T>[], rows: T[], summary?: [string, string | number][]) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: columns.length > 6 ? "landscape" : "portrait", unit: "pt", format: "a4" });
  doc.setFontSize(16);
  doc.text(meta.title, 40, 44);
  doc.setFontSize(9);
  doc.setTextColor(100);
  let y = 60;
  if (meta.subtitle) { doc.text(meta.subtitle, 40, y); y += 13; }
  doc.text(`Generated ${new Date().toLocaleString()}${meta.generatedBy ? ` by ${meta.generatedBy}` : ""}`, 40, y);
  y += 10;
  if (summary?.length) {
    autoTable(doc, {
      startY: y + 6, theme: "plain", styles: { fontSize: 9, cellPadding: 3 },
      body: summary.map(([k, v]) => [k, String(v)]), columnStyles: { 0: { fontStyle: "bold", cellWidth: 160 } },
      margin: { left: 40 }, tableWidth: 320,
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  }
  autoTable(doc, {
    startY: y + 10,
    head: [columns.map((c) => c.header)],
    body: rows.map((r) => columns.map((c) => { const v = c.value(r); return v === null || v === undefined ? "" : String(v); })),
    styles: { fontSize: 7.5, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: [79, 70, 229] },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    margin: { left: 40, right: 40 },
    didDrawPage: () => {
      const page = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(`Supply Team Portal · Page ${page}`, 40, doc.internal.pageSize.getHeight() - 20);
    },
  });
  doc.save(`${safeName(meta.title)}_${stamp()}.pdf`);
}
