import { readFile } from "node:fs/promises";
import path from "node:path";
import { getPool } from "@/db";
import { createInventoryReportWorkbook, type InventoryReportCategory, type InventoryReportItem } from "@/lib/inventory-report-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pool = getPool();
    const [categoriesResult, itemsResult] = await Promise.all([
      pool.query("SELECT id, name FROM categories ORDER BY name"),
      pool.query(`SELECT i.code, i.name, i.category_id AS "categoryId", i.unit, i.unit_cost AS "unitCost",
        (i.opening_quantity + COALESCE(SUM(CASE WHEN sm.type = 'RECEIPT' THEN sm.quantity ELSE -sm.quantity END), 0))::integer AS quantity
        FROM items i LEFT JOIN stock_movements sm ON sm.item_id = i.id
        GROUP BY i.id ORDER BY i.code`),
    ]);
    const categories = categoriesResult.rows.map((category) => ({ ...category, id: Number(category.id) })) as InventoryReportCategory[];
    const items = itemsResult.rows.map((item) => ({
      ...item,
      categoryId: Number(item.categoryId),
      unitCost: Number(item.unitCost),
      quantity: Number(item.quantity),
    })) as InventoryReportItem[];
    const asOfDate = new Date();
    const template = await readFile(path.join(process.cwd(), "templates", "inventory-report-template.xlsx"));
    const workbook = createInventoryReportWorkbook(new Uint8Array(template), categories, items, asOfDate);
    const fileDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(asOfDate);

    return new Response(Buffer.from(workbook), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="inventory-report-as-of-${fileDate}.xlsx"`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The inventory report could not be created." }, { status: 500 });
  }
}
