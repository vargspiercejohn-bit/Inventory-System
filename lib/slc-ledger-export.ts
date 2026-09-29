import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export type SlcLedgerItem = {
  code: string;
  name: string;
  unit: string;
  openingQuantity: number;
  reorderLevel: number;
  createdAt: Date | string;
};

export type SlcLedgerMovement = {
  id: number;
  type: "RECEIPT" | "ISSUE";
  quantity: number;
  reference: string;
  requestedBy: string;
  occurredAt: Date | string;
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

function numberCell(reference: string, style: number, value?: number, formula?: string) {
  if (!Number.isFinite(value)) return `<c r="${reference}" s="${style}"/>`;
  const formulaXml = formula ? `<f>${xmlEscape(formula)}</f>` : "";
  return `<c r="${reference}" s="${style}">${formulaXml}<v>${value}</v></c>`;
}

function excelDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  const utcDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((utcDay - Date.UTC(1899, 11, 30)) / 86_400_000);
}

function metadataRows(item: SlcLedgerItem) {
  return [
    `<row r="1" spans="1:11" ht="21" x14ac:dyDescent="0.3">${textCell("C1", 1, "STOCK CARD")}${textCell("D1", 1)}${textCell("E1", 1)}${textCell("F1", 1)}${textCell("G1", 1)}${textCell("H1", 1)}</row>`,
    `<row r="2" spans="1:11" x14ac:dyDescent="0.3">${textCell("A2", 2, "Entity Name:")}${textCell("B2", 2)}${textCell("C2", 3, "Inventory System")}${textCell("D2", 3)}${textCell("E2", 3)}${textCell("F2", 3)}${textCell("G2", 2)}${textCell("H2", 2, "Fund Cluster:")}${textCell("I2", 2)}${textCell("J2", 4)}${textCell("K2", 4)}</row>`,
    `<row r="3" spans="1:11" x14ac:dyDescent="0.3">${textCell("A3", 2, "Item:")}${textCell("B3", 2)}${textCell("C3", 3, item.name)}${textCell("D3", 3)}${textCell("E3", 3)}${textCell("F3", 3)}${textCell("G3", 2)}${textCell("H3", 2, "Stock no:")}${textCell("I3", 2)}${textCell("J3", 4, item.code)}${textCell("K3", 4)}</row>`,
    `<row r="4" spans="1:11" x14ac:dyDescent="0.3">${textCell("A4", 2, "Description:")}${textCell("B4", 2)}${textCell("C4", 3)}${textCell("D4", 3)}${textCell("E4", 3)}${textCell("F4", 3)}${textCell("G4", 2)}${textCell("H4", 2, "Re-Order Point:")}${textCell("I4", 2)}${numberCell("J4", 4, item.reorderLevel)}${textCell("K4", 4)}</row>`,
    `<row r="5" spans="1:11" ht="15" thickBot="1" x14ac:dyDescent="0.35">${textCell("A5", 5, "Unit of Measurement :")}${textCell("B5", 5)}${textCell("C5", 6, item.unit)}${textCell("D5", 6)}${textCell("E5", 6)}${textCell("F5", 6)}${textCell("G5", 5)}${textCell("H5", 5)}${textCell("I5", 5)}${textCell("J5", 5)}${textCell("K5", 5)}</row>`,
  ];
}

function headerRows() {
  return [
    `<row r="6" spans="1:11" ht="15" thickBot="1" x14ac:dyDescent="0.35">${textCell("A6", 10, "Date")}${textCell("B6", 12, "Reference")}${textCell("C6", 14, "Receipt")}${textCell("D6", 15, "Issue")}${textCell("E6", 36)}${textCell("F6", 37)}${textCell("G6", 39, "Balance")}${textCell("H6", 40)}${textCell("I6", 7, "No. of Days to Consume")}${textCell("J6", 7)}${textCell("K6", 8)}</row>`,
    `<row r="7" spans="1:11" ht="15" thickBot="1" x14ac:dyDescent="0.35">${textCell("A7", 11)}${textCell("B7", 13)}${textCell("C7", 38, "Qty")}${textCell("D7", 38, "Qty")}${textCell("E7", 9, "Office")}${textCell("F7", 16)}${textCell("G7", 41)}${textCell("H7", 42)}${textCell("I7", 5)}${textCell("J7", 5)}${textCell("K7", 5)}</row>`,
  ];
}

function ledgerRows(item: SlcLedgerItem, movements: SlcLedgerMovement[], minimumRows = 24) {
  const rows: string[] = [];
  const dataRows = Math.max(minimumRows, movements.length + 1);
  let balance = item.openingQuantity;

  rows.push(`<row r="8" spans="1:11" x14ac:dyDescent="0.3">${numberCell("A8", 18, excelDate(item.createdAt))}${textCell("B8", 19, "Beginning Balance")}${textCell("C8", 19)}${textCell("D8", 19)}${textCell("E8", 24)}${textCell("F8", 25)}${numberCell("G8", 28, balance)}${textCell("H8", 29)}${textCell("I8", 32)}${textCell("J8", 33)}${textCell("K8", 33)}</row>`);

  for (let index = 0; index < dataRows - 1; index += 1) {
    const rowNumber = index + 9;
    const movement = movements[index];
    if (movement) balance += movement.type === "RECEIPT" ? movement.quantity : -movement.quantity;
    const dateValue = movement ? excelDate(movement.occurredAt) : undefined;
    const receipt = movement?.type === "RECEIPT" ? movement.quantity : undefined;
    const issue = movement?.type === "ISSUE" ? movement.quantity : undefined;
    const formula = movement ? `G${rowNumber - 1}+C${rowNumber}-D${rowNumber}` : undefined;
    rows.push(`<row r="${rowNumber}" spans="1:11" x14ac:dyDescent="0.3">${numberCell(`A${rowNumber}`, 23, dateValue)}${textCell(`B${rowNumber}`, 21, movement?.reference)}${numberCell(`C${rowNumber}`, 21, receipt)}${numberCell(`D${rowNumber}`, 21, issue)}${textCell(`E${rowNumber}`, 26, movement?.type === "ISSUE" ? movement.requestedBy : "")}${textCell(`F${rowNumber}`, 27)}${numberCell(`G${rowNumber}`, 30, movement ? balance : undefined, formula)}${textCell(`H${rowNumber}`, 31)}${textCell(`I${rowNumber}`, 34)}${textCell(`J${rowNumber}`, 35)}${textCell(`K${rowNumber}`, 35)}</row>`);
  }

  return { rows, finalRow: dataRows + 7 };
}

function mergeCells(finalRow: number) {
  const refs = [
    "C1:H1", "C2:F2", "J2:K2", "C3:F3", "J3:K3", "C4:F4", "J4:K4", "C5:F5",
    "A6:A7", "B6:B7", "D6:F6", "E7:F7", "G6:H7", "I6:K7",
  ];
  for (let row = 8; row <= finalRow; row += 1) refs.push(`E${row}:F${row}`, `G${row}:H${row}`, `I${row}:K${row}`);
  return `<mergeCells count="${refs.length}">${refs.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>`;
}

export function createSlcLedgerWorkbook(templateBytes: Uint8Array, item: SlcLedgerItem, movements: SlcLedgerMovement[]) {
  const files = unzipSync(templateBytes);
  const sheetPath = "xl/worksheets/sheet1.xml";
  const workbookPath = "xl/workbook.xml";
  const workbookRelationshipsPath = "xl/_rels/workbook.xml.rels";
  const contentTypesPath = "[Content_Types].xml";
  const sheetXml = strFromU8(files[sheetPath]);
  const { rows: movementRows, finalRow } = ledgerRows(item, movements);
  const sheetData = `<sheetData>${[...metadataRows(item), ...headerRows(), ...movementRows].join("")}</sheetData>`;
  const updatedSheet = sheetXml
    .replace(/<dimension ref="[^"]+"\/>/, `<dimension ref="A1:K${finalRow}"/>`)
    .replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, '<sheetViews><sheetView tabSelected="1" zoomScale="115" zoomScaleNormal="115" workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>')
    .replace(/<sheetData>[\s\S]*?<\/sheetData>/, sheetData)
    .replace(/<mergeCells[^>]*>[\s\S]*?<\/mergeCells>/, mergeCells(finalRow));
  files[sheetPath] = strToU8(updatedSheet);

  const workbookXml = strFromU8(files[workbookPath]);
  files[workbookPath] = strToU8(
    workbookXml
      .replace('<sheet name="Sheet1"', '<sheet name="Stock Card"')
      .replace(/<calcPr\s+([^>]*)\/>/, '<calcPr $1 calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>'),
  );

  // The source template contains a calculation chain for its sample formulas.
  // Once ledger rows are regenerated that chain is no longer valid, so Excel
  // must rebuild it from the formulas in the worksheet instead of repairing it.
  delete files["xl/calcChain.xml"];
  if (files[workbookRelationshipsPath]) {
    files[workbookRelationshipsPath] = strToU8(
      strFromU8(files[workbookRelationshipsPath]).replace(/<Relationship\b[^>]*\bType="[^"]*\/calcChain"[^>]*\/>/g, ""),
    );
  }
  if (files[contentTypesPath]) {
    files[contentTypesPath] = strToU8(
      strFromU8(files[contentTypesPath]).replace(/<Override\b[^>]*\bPartName="\/xl\/calcChain\.xml"[^>]*\/>/g, ""),
    );
  }

  return zipSync(files, { level: 6 });
}
