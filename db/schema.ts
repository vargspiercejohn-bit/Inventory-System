import { sql } from "drizzle-orm";
import { check, doublePrecision, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("categories_name_unique").on(table.name)]);

export const items = pgTable("items", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  categoryId: integer("category_id").notNull().references(() => categories.id, { onDelete: "restrict" }),
  unit: text("unit").notNull(),
  openingQuantity: integer("opening_quantity").notNull().default(0),
  unitCost: doublePrecision("unit_cost").notNull().default(0),
  reorderLevel: integer("reorder_level").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("items_code_unique").on(table.code),
  index("items_category_idx").on(table.categoryId),
]);

export const stockMovements = pgTable("stock_movements", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["RECEIPT", "ISSUE"] }).notNull(),
  quantity: integer("quantity").notNull(),
  unitCost: doublePrecision("unit_cost").notNull().default(0),
  reference: text("reference").notNull().default(""),
  requestedBy: text("requested_by").notNull().default(""),
  notes: text("notes").notNull().default(""),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("stock_movements_item_idx").on(table.itemId),
  index("stock_movements_date_idx").on(table.occurredAt),
  check("stock_movements_type_check", sql`${table.type} IN ('RECEIPT', 'ISSUE')`),
  check("stock_movements_quantity_check", sql`${table.quantity} > 0`),
]);

export const inventoryMeta = pgTable("inventory_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
