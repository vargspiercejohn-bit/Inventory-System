import { readFile } from "node:fs/promises";
import path from "node:path";
import { getPool } from "@/db";
import { createSlcLedgerWorkbook, type SlcLedgerItem, type SlcLedgerMovement } from "@/lib/slc-ledger-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function safeFilename(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "item";
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const itemId = Number(id);
    if (!Number.isInteger(itemId) || itemId <= 0) return Response.json({ error: "A valid item is required." }, { status: 400 });

    const pool = getPool();
    const [itemResult, movementResult] = await Promise.all([
      pool.query(`SELECT code, name, unit, opening_quantity AS "openingQuantity",
        reorder_level AS "reorderLevel", created_at AS "createdAt"
        FROM items WHERE id = $1`, [itemId]),
      pool.query(`SELECT id, type, quantity, reference, requested_by AS "requestedBy", occurred_at AS "occurredAt"
        FROM stock_movements WHERE item_id = $1 ORDER BY occurred_at, id`, [itemId]),
    ]);

    const item = itemResult.rows[0] as SlcLedgerItem | undefined;
    if (!item) return Response.json({ error: "The selected item was not found." }, { status: 404 });
    const movements = movementResult.rows as SlcLedgerMovement[];
    const template = await readFile(path.join(process.cwd(), "templates", "slc-ledger-template.xlsx"));
    const workbook = createSlcLedgerWorkbook(new Uint8Array(template), {
      ...item,
      openingQuantity: Number(item.openingQuantity),
      reorderLevel: Number(item.reorderLevel),
    }, movements.map((movement) => ({ ...movement, id: Number(movement.id), quantity: Number(movement.quantity) })));

    return new Response(Buffer.from(workbook), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="stock-card-${safeFilename(item.code)}.xlsx"`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The ledger export could not be created." }, { status: 500 });
  }
}
