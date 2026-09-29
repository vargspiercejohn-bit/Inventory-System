"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

type MovementType = "RECEIPT" | "ISSUE";

type Item = {
  id: number;
  code: string;
  name: string;
  categoryName: string;
  unit: string;
  openingQuantity: number;
  unitCost: number;
  reorderLevel: number;
  createdAt: string;
  stock: number;
};

type Movement = {
  id: number;
  itemId: number;
  type: MovementType;
  quantity: number;
  unitCost: number;
  amount: number;
  reference: string;
  requestedBy: string;
  notes: string;
  occurredAt: string;
};

type InventorySnapshot = { items: Item[]; movements: Movement[] };

const whole = new Intl.NumberFormat("en-PH");
const shortDate = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" });

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function StockCardView() {
  const params = useParams<{ id: string }>();
  const itemId = numberValue(params.id);
  const [data, setData] = useState<InventorySnapshot>({ items: [], movements: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const savedTheme = localStorage.getItem("inventory-theme");
    const preferredTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.theme = savedTheme === "dark" || savedTheme === "light" ? savedTheme : preferredTheme;
  }, []);

  useEffect(() => {
    async function loadStockCard() {
      try {
        const response = await fetch("/api/inventory", { cache: "no-store" });
        const payload = await response.json() as InventorySnapshot & { error?: string };
        if (!response.ok) throw new Error(payload.error || "The stock card could not be loaded.");
        setData({
          items: payload.items.map((item) => ({ ...item, id: numberValue(item.id), openingQuantity: numberValue(item.openingQuantity), unitCost: numberValue(item.unitCost), reorderLevel: numberValue(item.reorderLevel), stock: numberValue(item.stock) })),
          movements: payload.movements.map((movement) => ({ ...movement, id: numberValue(movement.id), itemId: numberValue(movement.itemId), quantity: numberValue(movement.quantity), unitCost: numberValue(movement.unitCost), amount: numberValue(movement.amount) })),
        });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The stock card could not be loaded.");
      } finally {
        setLoading(false);
      }
    }

    void loadStockCard();
  }, []);

  const item = useMemo(() => data.items.find((candidate) => candidate.id === itemId) ?? null, [data.items, itemId]);

  const ledger = useMemo(() => {
    if (!item) return [];
    let balanceQuantity = item.openingQuantity;
    return data.movements
      .filter((movement) => movement.itemId === item.id)
      .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime() || a.id - b.id)
      .map((movement) => {
        balanceQuantity += movement.type === "RECEIPT" ? movement.quantity : -movement.quantity;
        return { movement, balanceQuantity };
      });
  }, [data.movements, item]);

  useEffect(() => {
    if (item) document.title = `${item.code} · ${item.name} | Stock Card`;
  }, [item]);

  if (loading) return <main className="stock-card-window"><div className="stock-view-state" role="status"><span className="spinner" /><strong>Loading stock card</strong><p>Preparing the item ledger…</p></div></main>;
  if (error || !item) return <main className="stock-card-window"><div className="stock-view-state error-state"><strong>Stock card unavailable</strong><p>{error || "The selected item could not be found."}</p><button className="secondary-button" onClick={() => window.close()}>Close window</button></div></main>;

  return (
    <main className="stock-card-window">
      <header className="stock-view-toolbar">
        <div className="stock-view-brand"><span className="brand-mark"><img src="/invlogo.png" alt="Inventory System logo" /></span><div><strong>INVENTORY SYSTEM</strong><small>Item movement ledger</small></div></div>
        <div className="stock-view-actions"><a className="secondary-button" href={`/api/stock-card/${item.id}/export`}>Export ledger (.xlsx)</a><button className="primary-button" onClick={() => window.print()}>Print view</button><button className="icon-button stock-view-close" onClick={() => window.close()} aria-label="Close stock card window">×</button></div>
      </header>

      <section className="panel stock-card-sheet stock-card-document official-stock-card">
        <div className="official-stock-card-title"><h1>STOCK CARD</h1></div>
        <div className="official-stock-card-meta">
          <div className="meta-row"><span>Entity Name:</span><strong>Inventory System</strong><span>Fund Cluster:</span><strong>—</strong></div>
          <div className="meta-row"><span>Item:</span><strong>{item.name}</strong><span>Stock No.:</span><strong>{item.code}</strong></div>
          <div className="meta-row"><span>Description:</span><strong>—</strong><span>Re-Order Point:</span><strong>{whole.format(item.reorderLevel)}</strong></div>
          <div className="meta-row unit-row"><span>Unit of Measurement:</span><strong>{item.unit}</strong><span /><strong /></div>
        </div>
        <div className="table-wrap stock-ledger-wrap">
          <table className="stock-ledger-table official-stock-card-table">
            <colgroup><col className="date-col" /><col className="reference-col" /><col className="receipt-col" /><col className="issue-qty-col" /><col className="office-col" /><col className="balance-col" /><col className="days-col" /></colgroup>
            <thead>
              <tr><th rowSpan={2}>Date</th><th rowSpan={2}>Reference</th><th className="receipts" colSpan={1}>Receipt</th><th className="issues" colSpan={2}>Issue</th><th className="balance" colSpan={1}>Balance</th><th rowSpan={2}>No. of Days to<br />Consume</th></tr>
              <tr><th className="receipts">Qty.</th><th className="issues">Qty.</th><th className="issues office-column">Office</th><th className="balance">Qty.</th></tr>
            </thead>
            <tbody>
              <tr className="opening-row"><td>{shortDate.format(new Date(item.createdAt))}</td><td>Beginning balance</td><td>—</td><td>—</td><td>—</td><td><strong>{whole.format(item.openingQuantity)}</strong></td><td>—</td></tr>
              {ledger.map(({ movement, balanceQuantity }) => <tr key={movement.id}><td>{shortDate.format(new Date(movement.occurredAt))}</td><td><span className="item-code">{movement.reference || "—"}</span>{movement.notes && <small>{movement.notes}</small>}</td><td className="positive">{movement.type === "RECEIPT" ? whole.format(movement.quantity) : ""}</td><td className="negative">{movement.type === "ISSUE" ? whole.format(movement.quantity) : ""}</td><td>{movement.type === "ISSUE" ? (movement.requestedBy || <span className="not-recorded">Not recorded</span>) : "—"}</td><td><strong>{whole.format(balanceQuantity)}</strong></td><td>—</td></tr>)}
            </tbody>
          </table>
          {!ledger.length && <div className="stock-view-empty"><strong>No movements recorded</strong><span>The opening balance is the current balance for this item.</span></div>}
        </div>
        <div className="stock-card-footer"><span>{ledger.length} movement{ledger.length === 1 ? "" : "s"}</span><strong>Current balance: {whole.format(item.stock)} {item.unit}</strong></div>
      </section>
    </main>
  );
}
