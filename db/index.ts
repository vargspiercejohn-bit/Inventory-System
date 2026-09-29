import { Pool } from "pg";

declare global {
  var inventoryPostgresPool: Pool | undefined;
}

export function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("PostgreSQL is not configured. Run `npm run db:setup`, then restart the app.");
  }

  if (!global.inventoryPostgresPool) {
    global.inventoryPostgresPool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: false,
    });
  }

  return global.inventoryPostgresPool;
}
