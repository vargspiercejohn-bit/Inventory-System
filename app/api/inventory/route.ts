import { getPool } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DatabaseRow = Record<string, string | number | Date | null>;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS items (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    unit TEXT NOT NULL,
    opening_quantity INTEGER NOT NULL DEFAULT 0,
    unit_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
    reorder_level INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS stock_movements (
    id SERIAL PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('RECEIPT', 'ISSUE')),
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    unit_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
    reference TEXT NOT NULL DEFAULT '',
    requested_by TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS requested_by TEXT NOT NULL DEFAULT ''",
  `CREATE TABLE IF NOT EXISTS inventory_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS items_category_idx ON items(category_id)",
  "CREATE INDEX IF NOT EXISTS stock_movements_item_idx ON stock_movements(item_id)",
  "CREATE INDEX IF NOT EXISTS stock_movements_date_idx ON stock_movements(occurred_at)",
];

async function prepareDatabase() {
  const pool = getPool();
  for (const statement of schemaStatements) await pool.query(statement);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(726191)");
    const seed = await client.query("SELECT value FROM inventory_meta WHERE key = $1", ["starter_seed"]);
    if (seed.rowCount) {
      await client.query("COMMIT");
      return;
    }

    await client.query("INSERT INTO categories (name, description) VALUES ($1, $2), ($3, $4), ($5, $6) ON CONFLICT (name) DO NOTHING", [
      "Office Supplies", "Paper, writing tools, and everyday office materials",
      "Equipment", "Reusable office equipment and devices",
      "Cleaning Supplies", "Workplace sanitation and cleaning materials",
    ]);

    const existingItems = await client.query("SELECT COUNT(*)::integer AS count FROM items");
    if (Number(existingItems.rows[0]?.count ?? 0) === 0) {
      const starterItems = [
        ["ITM-001", "Bond Paper A4", "Office Supplies", "ream", 50, 200, 20],
        ["ITM-002", "Ballpen Black", "Office Supplies", "pc", 200, 12, 50],
        ["ITM-003", "Long Folder", "Office Supplies", "pc", 100, 8, 30],
        ["ITM-004", "Desktop Stapler", "Equipment", "pc", 20, 185, 5],
        ["ITM-005", "Disinfectant Spray", "Cleaning Supplies", "can", 15, 145, 10],
      ];
      for (const item of starterItems) {
        await client.query(`INSERT INTO items (code, name, category_id, unit, opening_quantity, unit_cost, reorder_level)
          VALUES ($1, $2, (SELECT id FROM categories WHERE name = $3), $4, $5, $6, $7)`, item);
      }

      const starterMovements = [
        ["ITM-001", "RECEIPT", 100, 200, "PO-2026-001", "Opening month delivery", "12 days"],
        ["ITM-001", "ISSUE", 60, 200, "RIS-2026-001", "Issued to Administration", "8 days"],
        ["ITM-002", "RECEIPT", 300, 12, "PO-2026-002", "Restock", "6 days"],
        ["ITM-002", "ISSUE", 250, 12, "RIS-2026-002", "Department distribution", "3 days"],
        ["ITM-005", "ISSUE", 8, 145, "RIS-2026-003", "Issued to Facilities", "1 day"],
      ];
      for (const movement of starterMovements) {
        await client.query(`INSERT INTO stock_movements (item_id, type, quantity, unit_cost, reference, notes, occurred_at)
          VALUES ((SELECT id FROM items WHERE code = $1), $2, $3, $4, $5, $6, CURRENT_TIMESTAMP - $7::interval)`, movement);
      }
    }

    await client.query("INSERT INTO inventory_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", ["starter_seed", "1"]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function snapshot() {
  const pool = getPool();
  const [categoriesResult, itemsResult, movementsResult] = await Promise.all([
    pool.query(`SELECT c.id, c.name, c.description, c.created_at AS "createdAt",
      COUNT(i.id)::integer AS "itemCount",
      COALESCE(SUM((i.opening_quantity + COALESCE((SELECT SUM(CASE WHEN sm.type = 'RECEIPT' THEN sm.quantity ELSE -sm.quantity END) FROM stock_movements sm WHERE sm.item_id = i.id), 0)) * i.unit_cost), 0)::double precision AS "stockValue"
      FROM categories c LEFT JOIN items i ON i.category_id = c.id
      GROUP BY c.id ORDER BY c.name`),
    pool.query(`SELECT i.id, i.code, i.name, i.category_id AS "categoryId", c.name AS "categoryName",
      i.unit, i.opening_quantity AS "openingQuantity", i.unit_cost AS "unitCost",
      i.reorder_level AS "reorderLevel", i.created_at AS "createdAt", i.updated_at AS "updatedAt",
      COALESCE(SUM(CASE WHEN sm.type = 'RECEIPT' THEN sm.quantity ELSE 0 END), 0)::integer AS receipts,
      COALESCE(SUM(CASE WHEN sm.type = 'ISSUE' THEN sm.quantity ELSE 0 END), 0)::integer AS issues,
      (i.opening_quantity + COALESCE(SUM(CASE WHEN sm.type = 'RECEIPT' THEN sm.quantity ELSE -sm.quantity END), 0))::integer AS stock
      FROM items i JOIN categories c ON c.id = i.category_id
      LEFT JOIN stock_movements sm ON sm.item_id = i.id
      GROUP BY i.id, c.name ORDER BY i.code`),
    pool.query(`SELECT sm.id, sm.item_id AS "itemId", i.code AS "itemCode", i.name AS "itemName",
      sm.type, sm.quantity, sm.unit_cost AS "unitCost", sm.quantity * sm.unit_cost AS amount,
      sm.reference, sm.requested_by AS "requestedBy", sm.notes, sm.occurred_at AS "occurredAt"
      FROM stock_movements sm JOIN items i ON i.id = sm.item_id
      ORDER BY sm.occurred_at DESC, sm.id DESC LIMIT 500`),
  ]);
  return {
    categories: categoriesResult.rows as DatabaseRow[],
    items: itemsResult.rows as DatabaseRow[],
    movements: movementsResult.rows as DatabaseRow[],
  };
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveInteger(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

function positiveMoney(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function requiredMoney(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function movingAverageCost(currentStock: number, currentAverageCost: number, receivedQuantity: number, receiptUnitCost: number) {
  const newStock = currentStock + receivedQuantity;
  if (newStock <= 0) return receiptUnitCost;
  return ((currentStock * currentAverageCost) + (receivedQuantity * receiptUnitCost)) / newStock;
}

function errorResponse(error: unknown) {
  const details = error as { code?: string; constraint?: string; message?: string };
  if (details.code === "28P01") return Response.json({ error: "PostgreSQL rejected the password. Run `npm run db:setup` again." }, { status: 500 });
  if (details.code === "3D000") return Response.json({ error: "The inventory_db database does not exist. Run `npm run db:setup`." }, { status: 500 });
  if (details.code === "ECONNREFUSED") return Response.json({ error: "PostgreSQL is not running on localhost:5433." }, { status: 500 });
  if (details.code === "23505" && details.constraint?.includes("items_code")) return Response.json({ error: "That item code is already in use." }, { status: 409 });
  if (details.code === "23505" && details.constraint?.includes("categories_name")) return Response.json({ error: "That category name already exists." }, { status: 409 });
  return Response.json({ error: details.message || "Unexpected PostgreSQL inventory error." }, { status: 500 });
}

export async function GET() {
  try {
    await prepareDatabase();
    return Response.json(await snapshot());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await prepareDatabase();
    const payload = await request.json() as Record<string, unknown>;
    const entity = cleanText(payload.entity);
    const pool = getPool();

    if (entity === "category") {
      const name = cleanText(payload.name);
      if (!name) return Response.json({ error: "Category name is required." }, { status: 400 });
      await pool.query("INSERT INTO categories (name, description) VALUES ($1, $2)", [name, cleanText(payload.description)]);
    } else if (entity === "item") {
      const code = cleanText(payload.code).toUpperCase();
      const name = cleanText(payload.name);
      const unit = cleanText(payload.unit);
      const categoryId = positiveInteger(payload.categoryId);
      if (!code || !name || !unit || !categoryId) return Response.json({ error: "Code, name, category, and unit are required." }, { status: 400 });
      await pool.query(`INSERT INTO items (code, name, category_id, unit, opening_quantity, unit_cost, reorder_level)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`, [code, name, categoryId, unit, positiveInteger(payload.openingQuantity), positiveMoney(payload.unitCost), positiveInteger(payload.reorderLevel)]);
    } else if (entity === "movement") {
      const itemId = positiveInteger(payload.itemId);
      const type = cleanText(payload.type).toUpperCase();
      const quantity = positiveInteger(payload.quantity);
      if (!itemId || !quantity || !["RECEIPT", "ISSUE"].includes(type)) return Response.json({ error: "Item, movement type, and quantity are required." }, { status: 400 });
      const receiptUnitCost = type === "RECEIPT" ? requiredMoney(payload.unitCost) : null;
      if (type === "RECEIPT" && receiptUnitCost === null) return Response.json({ error: "A valid unit cost is required for a stock receipt." }, { status: 400 });
      const occurredAt = cleanText(payload.occurredAt) || new Date().toISOString();
      const requestedBy = cleanText(payload.requestedBy);
      if (type === "ISSUE" && !requestedBy) return Response.json({ error: "Issued to / Office is required for an issue." }, { status: 400 });

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const itemResult = await client.query(`SELECT unit_cost AS "unitCost" FROM items WHERE id = $1 FOR UPDATE`, [itemId]);
        const item = itemResult.rows[0] as { unitCost: number } | undefined;
        if (!item) {
          await client.query("ROLLBACK");
          return Response.json({ error: "Item was not found." }, { status: 404 });
        }

        const stockResult = await client.query(`SELECT
          (i.opening_quantity + COALESCE(SUM(CASE WHEN sm.type = 'RECEIPT' THEN sm.quantity ELSE -sm.quantity END), 0))::integer AS stock
          FROM items i LEFT JOIN stock_movements sm ON sm.item_id = i.id
          WHERE i.id = $1 GROUP BY i.id`, [itemId]);
        const currentStock = Number(stockResult.rows[0]?.stock ?? 0);
        const currentAverageCost = Number(item.unitCost);
        if (type === "ISSUE" && quantity > currentStock) {
          await client.query("ROLLBACK");
          return Response.json({ error: `Only ${currentStock} units are available to issue.` }, { status: 409 });
        }

        const movementUnitCost = type === "RECEIPT" ? Number(receiptUnitCost) : currentAverageCost;
        await client.query(`INSERT INTO stock_movements (item_id, type, quantity, unit_cost, reference, requested_by, notes, occurred_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [itemId, type, quantity, movementUnitCost, cleanText(payload.reference), requestedBy, cleanText(payload.notes), occurredAt]);

        if (type === "RECEIPT") {
          const newAverageCost = movingAverageCost(currentStock, currentAverageCost, quantity, movementUnitCost);
          await client.query("UPDATE items SET unit_cost = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [newAverageCost, itemId]);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } else {
      return Response.json({ error: "Unsupported inventory action." }, { status: 400 });
    }

    return Response.json(await snapshot(), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await prepareDatabase();
    const payload = await request.json() as Record<string, unknown>;
    const entity = cleanText(payload.entity);
    const id = positiveInteger(payload.id);
    const pool = getPool();
    if (!id) return Response.json({ error: "A valid record is required." }, { status: 400 });

    if (entity === "category") {
      const name = cleanText(payload.name);
      if (!name) return Response.json({ error: "Category name is required." }, { status: 400 });
      await pool.query("UPDATE categories SET name = $1, description = $2 WHERE id = $3", [name, cleanText(payload.description), id]);
    } else if (entity === "item") {
      const code = cleanText(payload.code).toUpperCase();
      const name = cleanText(payload.name);
      const unit = cleanText(payload.unit);
      const categoryId = positiveInteger(payload.categoryId);
      if (!code || !name || !unit || !categoryId) return Response.json({ error: "Code, name, category, and unit are required." }, { status: 400 });
      await pool.query(`UPDATE items SET code = $1, name = $2, category_id = $3, unit = $4, opening_quantity = $5, reorder_level = $6, updated_at = CURRENT_TIMESTAMP WHERE id = $7`, [code, name, categoryId, unit, positiveInteger(payload.openingQuantity), positiveInteger(payload.reorderLevel), id]);
    } else {
      return Response.json({ error: "Unsupported inventory action." }, { status: 400 });
    }

    return Response.json(await snapshot());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await prepareDatabase();
    const url = new URL(request.url);
    const entity = url.searchParams.get("entity");
    const id = positiveInteger(url.searchParams.get("id"));
    const pool = getPool();
    if (!id) return Response.json({ error: "A valid record is required." }, { status: 400 });

    if (entity === "category") {
      const usage = await pool.query("SELECT COUNT(*)::integer AS count FROM items WHERE category_id = $1", [id]);
      if (Number(usage.rows[0]?.count ?? 0) > 0) return Response.json({ error: "Move or delete the items in this category first." }, { status: 409 });
      await pool.query("DELETE FROM categories WHERE id = $1", [id]);
    } else if (entity === "item") {
      await pool.query("DELETE FROM items WHERE id = $1", [id]);
    } else {
      return Response.json({ error: "Unsupported inventory action." }, { status: 400 });
    }

    return Response.json(await snapshot());
  } catch (error) {
    return errorResponse(error);
  }
}
