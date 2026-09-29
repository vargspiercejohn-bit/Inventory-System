import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export type InventoryReportCategory = {
  id: number;
  name: string;
};

export type InventoryReportItem = {
  code: string;
  name: string;
  categoryId: number;
  unit: string;
  unitCost: number;
  quantity: number;
};

type CellValue = string | number | null | undefined;

function xmlEscape(value: CellValue) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function textCell(reference: string, style: number, value?: CellValue) {
  if (value === null || value === undefined || value === "") return `<c r="${reference}" s="${style}"/>`;
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function numberCell(reference: string, style: number, value: number, formula?: string) {
  const formulaXml = formula ? `<f>${xmlEscape(formula)}</f>` : "";
  return `<c r="${reference}" s="${style}">${formulaXml}<v>${Number.isFinite(value) ? value : 0}</v></c>`;
}

function reportRows(categories: InventoryReportCategory[], items: InventoryReportItem[], asOfDate: Date) {
  const rows: string[] = [];
  const merges = ["A1:F1", "A2:F2", "A4:A5", "B4:B5", "C4:C5", "D4:D5", "E4:E5", "F4:F5"];
  const asOf = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(asOfDate);

  rows.push(
    `<row r="1" spans="1:6" ht="24" customHeight="1">${textCell("A1", 27, "INVENTORY REPORT")}${textCell("B1", 26)}${textCell("C1", 26)}${textCell("D1", 26)}${textCell("E1", 26)}${textCell("F1", 26)}</row>`,
    `<row r="2" spans="1:6" ht="19" customHeight="1">${textCell("A2", 28, `As of Date: ${asOf}`)}${textCell("B2", 26)}${textCell("C2", 26)}${textCell("D2", 26)}${textCell("E2", 26)}${textCell("F2", 26)}</row>`,
    `<row r="3" spans="1:6" ht="8" customHeight="1"/>`,
    `<row r="4" spans="1:6" ht="18" customHeight="1">${textCell("A4", 5, "Items")}${textCell("B4", 7, "Item Code")}${textCell("C4", 9, "Unit")}${textCell("D4", 9, "Unit Cost")}${textCell("E4", 11, "Quantity")}${textCell("F4", 12, "Total Amount")}</row>`,
    `<row r="5" spans="1:6">${textCell("A5", 6)}${textCell("B5", 8)}${textCell("C5", 10)}${textCell("D5", 10)}${textCell("E5", 8)}${textCell("F5", 8)}</row>`,
  );

  let rowNumber = 6;
  const categoryTotalRows: number[] = [];
  const sortedCategories = [...categories].sort((first, second) => first.name.localeCompare(second.name));
  const sortedItems = [...items].sort((first, second) => first.code.localeCompare(second.code));

  for (const category of sortedCategories) {
    const categoryItems = sortedItems.filter((item) => item.categoryId === category.id);
    const categoryRowHeight = category.name.length > 32 ? 30 : 19;
    rows.push(`<row r="${rowNumber}" spans="1:6" ht="${categoryRowHeight}" customHeight="1">${textCell(`A${rowNumber}`, 28, category.name)}${textCell(`B${rowNumber}`, 26)}${textCell(`C${rowNumber}`, 26)}${textCell(`D${rowNumber}`, 26)}${textCell(`E${rowNumber}`, 26)}${textCell(`F${rowNumber}`, 26)}</row>`);
    rowNumber += 1;

    if (!categoryItems.length) continue;
    const firstItemRow = rowNumber;
    let categoryTotal = 0;
    for (const item of categoryItems) {
      const amount = Math.max(item.quantity, 0) * item.unitCost;
      categoryTotal += amount;
      const rowHeight = item.name.length > 42 ? 30 : 18;
      rows.push(`<row r="${rowNumber}" spans="1:6" ht="${rowHeight}" customHeight="1">${textCell(`A${rowNumber}`, 13, item.name)}${textCell(`B${rowNumber}`, 14, item.code)}${textCell(`C${rowNumber}`, 29, item.unit)}${numberCell(`D${rowNumber}`, 15, item.unitCost)}${numberCell(`E${rowNumber}`, 16, item.quantity)}${numberCell(`F${rowNumber}`, 17, amount, `D${rowNumber}*E${rowNumber}`)}</row>`);
      rowNumber += 1;
    }

    const lastItemRow = rowNumber - 1;
    rows.push(`<row r="${rowNumber}" spans="1:6" ht="18" customHeight="1">${textCell(`A${rowNumber}`, 28, "Category Total")}${textCell(`B${rowNumber}`, 26)}${textCell(`C${rowNumber}`, 26)}${textCell(`D${rowNumber}`, 26)}${textCell(`E${rowNumber}`, 26)}${numberCell(`F${rowNumber}`, 27, categoryTotal, `SUM(F${firstItemRow}:F${lastItemRow})`)}</row>`);
    categoryTotalRows.push(rowNumber);
    rowNumber += 1;
  }

  const grandTotal = items.reduce((total, item) => total + Math.max(item.quantity, 0) * item.unitCost, 0);
  const totalFormula = categoryTotalRows.length ? categoryTotalRows.map((row) => `F${row}`).join("+") : undefined;
  rows.push(`<row r="${rowNumber}" spans="1:6" ht="21" customHeight="1">${textCell(`A${rowNumber}`, 28, "GRAND TOTAL")}${textCell(`B${rowNumber}`, 26)}${textCell(`C${rowNumber}`, 26)}${textCell(`D${rowNumber}`, 26)}${textCell(`E${rowNumber}`, 26)}${numberCell(`F${rowNumber}`, 27, grandTotal, totalFormula)}</row>`);

  return { rows, merges, finalRow: rowNumber };
}

export function createInventoryReportWorkbook(templateBytes: Uint8Array, categories: InventoryReportCategory[], items: InventoryReportItem[], asOfDate = new Date()) {
  const files = unzipSync(templateBytes);
  const sheetPath = "xl/worksheets/sheet1.xml";
  const workbookPath = "xl/workbook.xml";
  const workbookRelationshipsPath = "xl/_rels/workbook.xml.rels";
  const contentTypesPath = "[Content_Types].xml";
  const { rows, merges, finalRow } = reportRows(categories, items, asOfDate);
  const sheetXml = strFromU8(files[sheetPath]);
  const mergeCells = `<mergeCells count="${merges.length}">${merges.map((reference) => `<mergeCell ref="${reference}"/>`).join("")}</mergeCells>`;
  const updatedSheet = sheetXml
    .replace(/<dimension ref="[^"]+"\/>/, `<dimension ref="A1:F${finalRow}"/>`)
    .replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, '<sheetViews><sheetView tabSelected="1" zoomScale="100" zoomScaleNormal="100" workbookViewId="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A6" sqref="A6"/></sheetView></sheetViews>')
    .replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${rows.join("")}</sheetData>`)
    .replace(/<mergeCells[^>]*>[\s\S]*?<\/mergeCells>/, mergeCells)
    .replace(/<pageMargins[^>]*\/>/, '<pageMargins left="0.35" right="0.35" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>');
  files[sheetPath] = strToU8(updatedSheet);

  files[workbookPath] = strToU8(
    strFromU8(files[workbookPath])
      .replace('<sheet name="Sheet1"', '<sheet name="Inventory Report"')
      .replace(/<calcPr\s+([^>]*)\/>/, '<calcPr $1 calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>'),
  );

  delete files["xl/calcChain.xml"];
  if (files[workbookRelationshipsPath]) {
    files[workbookRelationshipsPath] = strToU8(strFromU8(files[workbookRelationshipsPath]).replace(/<Relationship\b[^>]*\bType="[^"]*\/calcChain"[^>]*\/>/g, ""));
  }
  if (files[contentTypesPath]) {
    files[contentTypesPath] = strToU8(strFromU8(files[contentTypesPath]).replace(/<Override\b[^>]*\bPartName="\/xl\/calcChain\.xml"[^>]*\/>/g, ""));
  }

  return zipSync(files, { level: 6 });
}
