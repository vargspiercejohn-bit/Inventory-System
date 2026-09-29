"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Theme = "light" | "dark";
type View = "Dashboard" | "Items" | "Stock Card" | "Categories" | "Reports" | "Settings";
type MovementType = "RECEIPT" | "ISSUE";

type Category = {
  id: number;
  name: string;
  description: string;
  createdAt: string;
  itemCount: number;
  stockValue: number;
};

type Item = {
  id: number;
  code: string;
  name: string;
  categoryId: number;
  categoryName: string;
  unit: string;
  openingQuantity: number;
  unitCost: number;
  reorderLevel: number;
  createdAt: string;
  updatedAt: string;
  receipts: number;
  issues: number;
  stock: number;
};

type Movement = {
  id: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  type: MovementType;
  quantity: number;
  unitCost: number;
  amount: number;
  reference: string;
  requestedBy: string;
  notes: string;
  occurredAt: string;
};

type InventoryData = { categories: Category[]; items: Item[]; movements: Movement[] };
type ItemForm = { id?: number; code: string; name: string; categoryId: string; unit: string; openingQuantity: string; unitCost: string; reorderLevel: string };
type CategoryForm = { id?: number; name: string; description: string };

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "development";
const APP_ENVIRONMENT = process.env.NODE_ENV === "production" ? "Production" : "Development";

const navigation: { name: View; icon: string; detail: string }[] = [
  { name: "Dashboard", icon: "/icons/dashboard.svg", detail: "Overview" },
  { name: "Items", icon: "/icons/items.svg", detail: "Item masterlist" },
  { name: "Stock Card", icon: "/icons/stock-card.svg", detail: "Receipts and issues" },
  { name: "Categories", icon: "/icons/categories.svg", detail: "Item grouping" },
  { name: "Reports", icon: "/icons/reports.svg", detail: "Inventory analytics" },
  { name: "Settings", icon: "/icons/settings.svg", detail: "System settings" },
];

const money = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 });
const whole = new Intl.NumberFormat("en-PH");
const shortDate = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" });

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalize(data: InventoryData): InventoryData {
  return {
    categories: data.categories.map((category) => ({ ...category, id: numberValue(category.id), itemCount: numberValue(category.itemCount), stockValue: numberValue(category.stockValue) })),
    items: data.items.map((item) => ({ ...item, id: numberValue(item.id), categoryId: numberValue(item.categoryId), openingQuantity: numberValue(item.openingQuantity), unitCost: numberValue(item.unitCost), reorderLevel: numberValue(item.reorderLevel), receipts: numberValue(item.receipts), issues: numberValue(item.issues), stock: numberValue(item.stock) })),
    movements: data.movements.map((movement) => ({ ...movement, id: numberValue(movement.id), itemId: numberValue(movement.itemId), quantity: numberValue(movement.quantity), unitCost: numberValue(movement.unitCost), amount: numberValue(movement.amount) })),
  };
}

function itemStatus(item: Item) {
  if (item.stock <= 0) return "Out of stock";
  if (item.stock <= item.reorderLevel) return "Low stock";
  return "In stock";
}

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function saveCsv(filename: string, rows: (string | number)[][]) {
  const content = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ThemeIcon({ theme }: { theme: Theme }) {
  return <img className="theme-icon" src={theme === "light" ? "/icons/dark-mode.svg" : "/icons/light-mode.svg"} alt="" />;
}

function MetricCard({ tone, icon, label, value, caption }: { tone: string; icon: string; label: string; value: string; caption: string }) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-icon"><img src={icon} alt="" /></div>
      <div className="metric-copy"><p>{label}</p><strong>{value}</strong><span>{caption}</span></div>
    </article>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone = status === "In stock" ? "success" : status === "Low stock" ? "warning" : "danger";
  return <span className={`status-pill ${tone}`}><i />{status}</span>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><strong>{title}</strong><span>{detail}</span></div>;
}

function LoadingView() {
  return <div className="loading-view" role="status"><span className="spinner" /><strong>Loading inventory</strong><p>Preparing your latest records…</p></div>;
}

export default function Home() {
  const [theme, setTheme] = useState<Theme>("light");
  const [activeView, setActiveView] = useState<View>("Dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [data, setData] = useState<InventoryData>({ categories: [], items: [], movements: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedStockItemId, setSelectedStockItemId] = useState("");
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [itemForm, setItemForm] = useState<ItemForm>({ code: "", name: "", categoryId: "", unit: "pc", openingQuantity: "0", unitCost: "0", reorderLevel: "0" });
  const [categoryForm, setCategoryForm] = useState<CategoryForm>({ name: "", description: "" });
  const [movementForm, setMovementForm] = useState({ itemId: "", type: "RECEIPT" as MovementType, quantity: "", unitCost: "", reference: "", requestedBy: "", notes: "", occurredAt: new Date().toISOString().slice(0, 10) });
  const monthStart = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;
  const [reportFrom, setReportFrom] = useState(monthStart);
  const [reportTo, setReportTo] = useState(new Date().toISOString().slice(0, 10));

  const loadInventory = useCallback(async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      setError("");
      const response = await fetch("/api/inventory", { cache: "no-store", signal: controller.signal });
      const payload = await response.json() as InventoryData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Inventory could not be loaded.");
      const normalized = normalize(payload);
      setData(normalized);
      setSelectedStockItemId((current) => normalized.items.some((item) => String(item.id) === current) ? current : String(normalized.items[0]?.id ?? ""));
    } catch (caught) {
      setError(caught instanceof DOMException && caught.name === "AbortError" ? "The inventory request timed out. Check that this laptop, PostgreSQL, and the network connection are still running." : caught instanceof Error ? caught.message : "Inventory could not be loaded.");
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("inventory-theme") as Theme | null;
    const preferred = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const frame = window.requestAnimationFrame(() => {
      setTheme(saved ?? preferred);
      void loadInventory();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loadInventory]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("inventory-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function mutate(method: "POST" | "PATCH" | "DELETE", payload: Record<string, unknown>, successMessage: string) {
    setSaving(true);
    setError("");
    try {
      const url = method === "DELETE" ? `/api/inventory?entity=${payload.entity}&id=${payload.id}` : "/api/inventory";
      const response = await fetch(url, {
        method,
        headers: method === "DELETE" ? undefined : { "Content-Type": "application/json" },
        body: method === "DELETE" ? undefined : JSON.stringify(payload),
      });
      const result = await response.json() as InventoryData & { error?: string };
      if (!response.ok) throw new Error(result.error || "The change could not be saved.");
      setData(normalize(result));
      setToast(successMessage);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The change could not be saved.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  const totals = useMemo(() => {
    const inStock = data.items.filter((item) => itemStatus(item) === "In stock").length;
    const lowStock = data.items.filter((item) => itemStatus(item) === "Low stock").length;
    const outOfStock = data.items.filter((item) => itemStatus(item) === "Out of stock").length;
    const stockValue = data.items.reduce((sum, item) => sum + Math.max(item.stock, 0) * item.unitCost, 0);
    return { inStock, lowStock, outOfStock, stockValue };
  }, [data.items]);

  const filteredItems = useMemo(() => {
    const term = query.trim().toLowerCase();
    return data.items.filter((item) => {
      const matchesQuery = !term || `${item.code} ${item.name} ${item.categoryName} ${item.unit}`.toLowerCase().includes(term);
      return matchesQuery && (categoryFilter === "all" || String(item.categoryId) === categoryFilter);
    });
  }, [data.items, query, categoryFilter]);

  const stockCardItems = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return data.items.filter((item) => `${item.code} ${item.name} ${item.categoryName}`.toLowerCase().includes(term)).slice(0, 8);
  }, [data.items, query]);

  const selectedStockItem = useMemo(() => data.items.find((item) => String(item.id) === selectedStockItemId) ?? null, [data.items, selectedStockItemId]);

  const recentStockMovements = useMemo(() => [...data.movements]
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime() || b.id - a.id)
    .slice(0, 10), [data.movements]);

  const reportMovements = useMemo(() => data.movements.filter((movement) => {
    const date = movement.occurredAt.slice(0, 10);
    return (!reportFrom || date >= reportFrom) && (!reportTo || date <= reportTo);
  }), [data.movements, reportFrom, reportTo]);

  const reportTotals = useMemo(() => reportMovements.reduce((summary, movement) => {
    if (movement.type === "RECEIPT") { summary.receiptQty += movement.quantity; summary.receiptValue += movement.amount; }
    else { summary.issueQty += movement.quantity; summary.issueValue += movement.amount; }
    return summary;
  }, { receiptQty: 0, receiptValue: 0, issueQty: 0, issueValue: 0 }), [reportMovements]);

  const monthlyActivity = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, index) => ({ label: new Intl.DateTimeFormat("en", { month: "short" }).format(new Date(2026, index, 1)), receipts: 0, issues: 0 }));
    data.movements.forEach((movement) => {
      const date = new Date(movement.occurredAt.replace(" ", "T"));
      if (Number.isNaN(date.getTime())) return;
      const bucket = months[date.getMonth()];
      if (movement.type === "RECEIPT") bucket.receipts += movement.amount;
      else bucket.issues += movement.amount;
    });
    return months;
  }, [data.movements]);

  function openNewItem() {
    const nextCode = `ITM-${String(data.items.length + 1).padStart(3, "0")}`;
    setItemForm({ code: nextCode, name: "", categoryId: String(data.categories[0]?.id ?? ""), unit: "pc", openingQuantity: "0", unitCost: "0", reorderLevel: "0" });
    setItemModalOpen(true);
  }

  function openEditItem(item: Item) {
    setItemForm({ id: item.id, code: item.code, name: item.name, categoryId: String(item.categoryId), unit: item.unit, openingQuantity: String(item.openingQuantity), unitCost: String(item.unitCost), reorderLevel: String(item.reorderLevel) });
    setItemModalOpen(true);
  }

  async function submitItem(event: FormEvent) {
    event.preventDefault();
    const payload = { entity: "item", ...itemForm, categoryId: Number(itemForm.categoryId), openingQuantity: Number(itemForm.openingQuantity), unitCost: Number(itemForm.unitCost), reorderLevel: Number(itemForm.reorderLevel) };
    const okay = await mutate(itemForm.id ? "PATCH" : "POST", payload, itemForm.id ? "Item updated." : "Item added.");
    if (okay) setItemModalOpen(false);
  }

  function openNewCategory() {
    setCategoryForm({ name: "", description: "" });
    setCategoryModalOpen(true);
  }

  function openEditCategory(category: Category) {
    setCategoryForm({ id: category.id, name: category.name, description: category.description });
    setCategoryModalOpen(true);
  }

  async function submitCategory(event: FormEvent) {
    event.preventDefault();
    const okay = await mutate(categoryForm.id ? "PATCH" : "POST", { entity: "category", ...categoryForm }, categoryForm.id ? "Category updated." : "Category added.");
    if (okay) setCategoryModalOpen(false);
  }

  async function submitMovement(event: FormEvent) {
    event.preventDefault();
    const occurredAt = new Date(`${movementForm.occurredAt}T12:00:00`).toISOString();
    const okay = await mutate("POST", { entity: "movement", ...movementForm, itemId: Number(selectedStockItemId), quantity: Number(movementForm.quantity), unitCost: movementForm.unitCost === "" ? undefined : Number(movementForm.unitCost), occurredAt }, "Stock movement recorded.");
    if (okay) setMovementForm((current) => ({ ...current, quantity: "", unitCost: "", reference: "", requestedBy: "", notes: "", occurredAt: new Date().toISOString().slice(0, 10) }));
  }

  function selectMovementItem(itemId: string) {
    setMovementForm((current) => ({ ...current, itemId, unitCost: "" }));
  }

  function selectStockCardItem(itemId: string) {
    setSelectedStockItemId(itemId);
    selectMovementItem(itemId);
    setQuery("");
  }

  async function deleteItem(item: Item) {
    if (!window.confirm(`Delete ${item.name} and its stock history?`)) return;
    await mutate("DELETE", { entity: "item", id: item.id }, "Item deleted.");
  }

  async function deleteCategory(category: Category) {
    if (!window.confirm(`Delete the ${category.name} category?`)) return;
    await mutate("DELETE", { entity: "category", id: category.id }, "Category deleted.");
  }

  function switchView(view: View) {
    setActiveView(view);
    setMenuOpen(false);
    setQuery("");
  }

  const maxMonthly = Math.max(...monthlyActivity.flatMap((month) => [month.receipts, month.issues]), 1);
  const totalItems = data.items.length || 1;
  const inPercent = (totals.inStock / totalItems) * 100;
  const lowPercent = (totals.lowStock / totalItems) * 100;
  const donutStyle = { background: `conic-gradient(var(--green) 0 ${inPercent}%, var(--amber) ${inPercent}% ${inPercent + lowPercent}%, var(--red) ${inPercent + lowPercent}% 100%)` };

  return (
    <main className="app-shell">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><img src="/invlogo.png" alt="Inventory System logo" /></div>
          <div><strong>INVENTORY</strong><small>System</small></div>
          <button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="Close navigation">×</button>
        </div>
        <nav aria-label="Inventory modules">
          {navigation.map((entry) => (
            <button className={`${activeView === entry.name ? "active" : ""} ${entry.name === "Settings" ? "settings-entry" : ""}`} onClick={() => switchView(entry.name)} key={entry.name} title={entry.detail}>
              <span className="nav-icon"><img src={entry.icon} alt="" /></span><span>{entry.name}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-note"><div className="sidebar-note-heading"><strong>Live inventory</strong><b>v{APP_VERSION}</b></div><span><i /> All changes are saved</span></div>
        <div className="profile-card"><div className="avatar">AU</div><div><strong>Admin User</strong><span><i /> Inventory Admin</span></div></div>
      </aside>

      {menuOpen && <button className="sidebar-scrim" onClick={() => setMenuOpen(false)} aria-label="Close navigation overlay" />}

      <section className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button menu-button" onClick={() => setMenuOpen(true)} aria-label="Open navigation">☰</button>
            <div><span className="eyebrow">Inventory workspace</span><h1>{activeView}</h1></div>
          </div>
          <div className="topbar-actions">
            {activeView === "Items" && <label className="global-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search records..." aria-label="Search records" /></label>}
            <button className="theme-toggle" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}><ThemeIcon theme={theme} /><span>{theme === "light" ? "Dark" : "Light"}</span></button>
            <button className="user-avatar" aria-label="User profile">AU</button>
          </div>
        </header>

        <div className="dashboard-content">
          {error && <div className="alert-banner" role="alert"><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
          {toast && <div className="toast" role="status">✓ {toast}</div>}
          {loading ? <LoadingView /> : (
            <>
              {activeView === "Dashboard" && (
                <>
                  <div className="page-intro"><div><p>{shortDate.format(new Date())}</p><h2>Inventory at a glance</h2><span>Live stock levels and recent activity from your saved records.</span></div><button className="primary-button" onClick={() => switchView("Stock Card")}>+ Record movement</button></div>
                  <section className="metrics-grid" aria-label="Inventory overview">
                    <MetricCard tone="blue" icon="/icons/total-items.png" label="Total items" value={whole.format(data.items.length)} caption={`${data.categories.length} active categories`} />
                    <MetricCard tone="green" icon="/icons/total-stock-value.png" label="Total stock value" value={money.format(totals.stockValue)} caption="Current inventory valuation" />
                    <MetricCard tone="amber" icon="/icons/low-stock-items.png" label="Low stock items" value={whole.format(totals.lowStock)} caption="At or below reorder level" />
                    <MetricCard tone="red" icon="/icons/out-of-stock-items.png" label="Out of stock" value={whole.format(totals.outOfStock)} caption="Items requiring restock" />
                  </section>
                  <section className="insights-grid">
                    <article className="panel stock-summary"><div className="panel-heading"><div><span>Inventory health</span><h3>Stock summary</h3></div></div><div className="stock-summary-body"><div className="donut" style={donutStyle}><div><strong>{data.items.length}</strong><span>Total items</span></div></div><div className="stock-legend"><div><i className="legend-green" /><span>In stock<small>Above reorder level</small></span><strong>{totals.inStock}</strong></div><div><i className="legend-amber" /><span>Low stock<small>Needs attention</small></span><strong>{totals.lowStock}</strong></div><div><i className="legend-red" /><span>Out of stock<small>Restock required</small></span><strong>{totals.outOfStock}</strong></div></div></div></article>
                    <article className="panel"><div className="panel-heading"><div><span>Value moved</span><h3>Monthly activity</h3></div><div className="activity-legend"><span><i className="blue-dot" />Receipts</span><span><i className="red-dot" />Issues</span></div></div><div className="bar-chart">{monthlyActivity.map((month) => <div className="bar-group" key={month.label}><div className="bars"><i className="receipt-bar" style={{ height: `${Math.max(3, (month.receipts / maxMonthly) * 100)}%` }} title={`Receipts: ${money.format(month.receipts)}`} /><i className="issue-bar" style={{ height: `${Math.max(3, (month.issues / maxMonthly) * 100)}%` }} title={`Issues: ${money.format(month.issues)}`} /></div><span>{month.label}</span></div>)}</div></article>
                  </section>
                  <section className="dashboard-lower">
                    <article className="panel"><div className="panel-heading"><div><span>Latest updates</span><h3>Recent movements</h3></div><button className="text-button" onClick={() => switchView("Stock Card")}>View all</button></div><div className="compact-list">{data.movements.slice(0, 5).map((movement) => <div key={movement.id}><span className={`movement-mark ${movement.type.toLowerCase()}`}>{movement.type === "RECEIPT" ? "↓" : "↑"}</span><div><strong>{movement.itemName}</strong><small>{movement.reference || "No reference"} · {shortDate.format(new Date(movement.occurredAt))}</small></div><b className={movement.type === "RECEIPT" ? "positive" : "negative"}>{movement.type === "RECEIPT" ? "+" : "−"}{movement.quantity} {data.items.find((item) => item.id === movement.itemId)?.unit}</b></div>)}{!data.movements.length && <EmptyState title="No movements yet" detail="Record a receipt or issue to begin." />}</div></article>
                    <article className="panel"><div className="panel-heading"><div><span>Action needed</span><h3>Reorder list</h3></div><button className="text-button" onClick={() => switchView("Items")}>Manage items</button></div><div className="compact-list">{data.items.filter((item) => itemStatus(item) !== "In stock").slice(0, 5).map((item) => <div key={item.id}><span className="item-initial">{item.name.slice(0, 1)}</span><div><strong>{item.name}</strong><small>{item.code} · Reorder at {item.reorderLevel}</small></div><StatusPill status={itemStatus(item)} /></div>)}{!data.items.some((item) => itemStatus(item) !== "In stock") && <EmptyState title="Stock levels look healthy" detail="No items currently need reordering." />}</div></article>
                  </section>
                </>
              )}

              {activeView === "Items" && (
                <>
                  <div className="page-intro"><div><p>Item masterlist</p><h2>Manage inventory items</h2><span>Add, update, search, and remove products from one place.</span></div><button className="primary-button" onClick={openNewItem} disabled={!data.categories.length}>+ Add item</button></div>
                  <section className="panel data-panel"><div className="data-toolbar"><label className="table-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search code or item..." /></label><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">All categories</option>{data.categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select><button className="secondary-button" onClick={() => saveCsv("inventory-items.csv", [["Code", "Item", "Category", "Unit", "Average Unit Cost", "Stock", "Reorder Level", "Status"], ...filteredItems.map((item) => [item.code, item.name, item.categoryName, item.unit, item.unitCost, item.stock, item.reorderLevel, itemStatus(item)])])}>Export CSV</button></div><div className="table-wrap"><table className="items-table"><thead><tr><th>Item</th><th>Category</th><th>Unit</th><th>Average unit cost</th><th>On hand</th><th>Reorder level</th><th>Status</th><th>Actions</th></tr></thead><tbody>{filteredItems.map((item) => <tr key={item.id}><td><div className="item-cell"><span className="item-thumb">{item.name.slice(0, 1)}</span><div><strong>{item.name}</strong><small>{item.code}</small></div></div></td><td>{item.categoryName}</td><td>{item.unit}</td><td>{money.format(item.unitCost)}</td><td><strong>{whole.format(item.stock)}</strong></td><td>{whole.format(item.reorderLevel)}</td><td><StatusPill status={itemStatus(item)} /></td><td><div className="row-actions"><button onClick={() => openEditItem(item)} aria-label={`Edit ${item.name}`}>Edit</button><button className="delete-action" onClick={() => void deleteItem(item)} aria-label={`Delete ${item.name}`}>Delete</button></div></td></tr>)}</tbody></table>{!filteredItems.length && <EmptyState title="No items found" detail="Try another search or add a new item." />}</div><div className="table-footer"><span>Showing <b>{filteredItems.length}</b> of <b>{data.items.length}</b> items</span><span>Total value: <b>{money.format(filteredItems.reduce((sum, item) => sum + Math.max(item.stock, 0) * item.unitCost, 0))}</b></span></div></section>
                </>
              )}

              {activeView === "Stock Card" && (
                <>
                  <div className="page-intro"><div><p>Inventory movements</p><h2>Stock card transactions</h2><span>Select an item for a new transaction, or open its complete stock card in a separate tab.</span></div></div>

                  <section className="panel stock-search-panel">
                    <div className="stock-picker-copy"><span>Item search</span><h3>Find an item</h3><p>Search by item name, stock number, or category. Matching items appear directly below the search field.</p></div>
                    <div className="stock-search-combobox">
                      <div className="stock-item-search"><span>⌕</span><input id="stock-card-item-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Type an item name, code, or category..." aria-label="Search stock card items" role="combobox" aria-expanded={Boolean(query.trim())} aria-controls="stock-card-search-results" autoComplete="off" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Clear item search">×</button>}</div>
                      {query.trim() && <div className="stock-search-dropdown" id="stock-card-search-results" role="listbox" aria-label="Matching inventory items">
                        {stockCardItems.map((item) => <button type="button" role="option" aria-selected={selectedStockItemId === String(item.id)} onClick={() => selectStockCardItem(String(item.id))} key={item.id}>
                          <span className="item-initial">{item.name.slice(0, 1)}</span><span><strong>{item.name}</strong><small>{item.code} · {item.categoryName}</small></span><b>{whole.format(item.stock)} {item.unit}</b><em>Select</em>
                        </button>)}
                        {!stockCardItems.length && <div className="stock-search-no-result"><strong>No matching item</strong><span>Check the item name, code, or category and try again.</span></div>}
                      </div>}
                    </div>
                    {selectedStockItem && <div className="selected-transaction-item"><span className="item-initial">{selectedStockItem.name.slice(0, 1)}</span><div><small>Selected for new transaction</small><strong>{selectedStockItem.name}</strong><span>{selectedStockItem.code} · {whole.format(selectedStockItem.stock)} {selectedStockItem.unit} available</span></div><a href={`/stock-card/${selectedStockItem.id}`} target="_blank" rel="noopener noreferrer">View ledger <span aria-hidden="true">↗</span></a></div>}
                  </section>

                  {selectedStockItem ? <>
                    <section className="panel movement-entry">
                      <div className="panel-heading"><div><span>New transaction</span><h3>Record movement for {selectedStockItem.name}</h3></div><span className="selected-item-chip">{selectedStockItem.code} · {whole.format(selectedStockItem.stock)} {selectedStockItem.unit} · Avg. {money.format(selectedStockItem.unitCost)}</span></div>
                      <form className="stock-movement-form" onSubmit={submitMovement}>
                        <label><span>Movement</span><select value={movementForm.type} onChange={(event) => setMovementForm({ ...movementForm, type: event.target.value as MovementType, unitCost: "", requestedBy: event.target.value === "RECEIPT" ? "" : movementForm.requestedBy })}><option value="RECEIPT">Receipt / Stock in</option><option value="ISSUE">Issue / Stock out</option></select></label>
                        <label><span>Quantity</span><input required min="1" type="number" value={movementForm.quantity} onChange={(event) => setMovementForm({ ...movementForm, quantity: event.target.value })} /></label>
                        {movementForm.type === "RECEIPT" && <label><span>Receipt unit cost</span><input required min="0" step="0.01" type="number" placeholder={`Current average: ${money.format(selectedStockItem.unitCost)}`} value={movementForm.unitCost} onChange={(event) => setMovementForm({ ...movementForm, unitCost: event.target.value })} /></label>}
                        <label><span>Reference</span><input placeholder="IAR, PO, RIS, etc." value={movementForm.reference} onChange={(event) => setMovementForm({ ...movementForm, reference: event.target.value })} /></label>
                        <label><span>Date</span><input required type="date" value={movementForm.occurredAt} onChange={(event) => setMovementForm({ ...movementForm, occurredAt: event.target.value })} /></label>
                        <label className="requester-field"><span>Issued to / Office</span><input required={movementForm.type === "ISSUE"} disabled={movementForm.type !== "ISSUE"} placeholder={movementForm.type === "ISSUE" ? "Name of recipient or requesting office" : "Available for issue transactions"} value={movementForm.requestedBy} onChange={(event) => setMovementForm({ ...movementForm, requestedBy: event.target.value })} /></label>
                        <label className="movement-notes issue-notes"><span>Notes</span><input placeholder="Optional transaction notes" value={movementForm.notes} onChange={(event) => setMovementForm({ ...movementForm, notes: event.target.value })} /></label>
                        <button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save movement"}</button>
                      </form>
                    </section>
                  </> : <section className="panel"><EmptyState title="Select an item" detail="Search and choose an item for a new receipt or issue transaction." /></section>}

                  <section className="panel stock-recent-panel">
                    <div className="panel-heading"><div><span>Latest activity</span><h3>Previous Transactions</h3></div><span className="recent-count">{recentStockMovements.length} shown</span></div>
                    <div className="recent-transaction-list">
                      {recentStockMovements.map((movement) => {
                        const movementItem = data.items.find((item) => item.id === movement.itemId);
                        return <article key={movement.id}><span className={`movement-mark ${movement.type.toLowerCase()}`}>{movement.type === "RECEIPT" ? "↓" : "↑"}</span><div className="recent-transaction-copy"><strong>{movement.itemName}</strong><span>{movement.reference || "No reference"} · {shortDate.format(new Date(movement.occurredAt))}</span>{movement.type === "ISSUE" && <small>Issued to: {movement.requestedBy || "Not recorded"}</small>}</div><div className="recent-transaction-value"><strong className={movement.type === "RECEIPT" ? "positive" : "negative"}>{movement.type === "RECEIPT" ? "+" : "−"}{whole.format(movement.quantity)} {movementItem?.unit || "unit"}</strong><span>{money.format(movement.amount)}</span></div><a href={`/stock-card/${movement.itemId}`} target="_blank" rel="noopener noreferrer" aria-label={`View stock card for ${movement.itemName}`}>View ledger ↗</a></article>;
                      })}
                      {!recentStockMovements.length && <EmptyState title="No transactions yet" detail="Recorded receipts and issues will appear here." />}
                    </div>
                  </section>
                </>
              )}

              {activeView === "Categories" && (
                <>
                  <div className="page-intro"><div><p>Item organization</p><h2>Categories</h2><span>Group related items and review the value held in each category.</span></div><button className="primary-button" onClick={openNewCategory}>+ Add category</button></div>
                  <section className="category-grid">{data.categories.map((category) => <article className="category-card" key={category.id}><div className="category-top"><span className="category-icon">{category.name.slice(0, 1).toUpperCase()}</span><div className="category-actions"><button onClick={() => openEditCategory(category)}>Edit</button><button onClick={() => void deleteCategory(category)} disabled={category.itemCount > 0}>Delete</button></div></div><h3>{category.name}</h3><p>{category.description || "No description provided."}</p><div className="category-stats"><div><span>Items</span><strong>{whole.format(category.itemCount)}</strong></div><div><span>Stock value</span><strong>{money.format(category.stockValue)}</strong></div></div></article>)}<button className="add-category-card" onClick={openNewCategory}><span>+</span><strong>Add category</strong><small>Create another item group</small></button></section>
                </>
              )}

              {activeView === "Reports" && (
                <>
                  <div className="page-intro"><div><p>Inventory analytics</p><h2>Reports</h2><span>Review stock valuation and transaction activity for a selected period.</span></div><a className="primary-button" href="/api/inventory/export">Export inventory report</a></div>
                  <section className="report-filters panel"><div><label><span>From</span><input type="date" value={reportFrom} onChange={(event) => setReportFrom(event.target.value)} /></label><label><span>To</span><input type="date" value={reportTo} onChange={(event) => setReportTo(event.target.value)} /></label></div><button className="secondary-button" onClick={() => saveCsv("transaction-report.csv", [["Date", "Reference", "Item", "Type", "Quantity", "Amount"], ...reportMovements.map((movement) => [movement.occurredAt, movement.reference, movement.itemName, movement.type, movement.quantity, movement.amount])])}>Export transactions</button></section>
                  <section className="report-metrics"><article><span>Receipt quantity</span><strong>{whole.format(reportTotals.receiptQty)}</strong><small>{money.format(reportTotals.receiptValue)}</small></article><article><span>Issue quantity</span><strong>{whole.format(reportTotals.issueQty)}</strong><small>{money.format(reportTotals.issueValue)}</small></article><article><span>Net quantity moved</span><strong>{whole.format(reportTotals.receiptQty - reportTotals.issueQty)}</strong><small>{reportMovements.length} transactions</small></article><article><span>Current stock value</span><strong>{money.format(totals.stockValue)}</strong><small>Across {data.items.length} items</small></article></section>
                  <section className="reports-grid"><article className="panel"><div className="panel-heading"><div><span>Current position</span><h3>Inventory valuation</h3></div></div><div className="table-wrap"><table className="report-table"><thead><tr><th>Item</th><th>Balance</th><th>Unit cost</th><th>Value</th><th>Status</th></tr></thead><tbody>{data.items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.code}</small></td><td>{whole.format(item.stock)} {item.unit}</td><td>{money.format(item.unitCost)}</td><td><strong>{money.format(Math.max(item.stock, 0) * item.unitCost)}</strong></td><td><StatusPill status={itemStatus(item)} /></td></tr>)}</tbody></table></div></article><article className="panel"><div className="panel-heading"><div><span>Selected period</span><h3>Transaction summary</h3></div></div><div className="report-breakdown"><div className="breakdown-row"><span><i className="legend-green" />Receipts</span><strong>{money.format(reportTotals.receiptValue)}</strong></div><div className="breakdown-bar"><i style={{ width: `${reportTotals.receiptValue + reportTotals.issueValue ? (reportTotals.receiptValue / (reportTotals.receiptValue + reportTotals.issueValue)) * 100 : 0}%` }} /></div><div className="breakdown-row"><span><i className="legend-red" />Issues</span><strong>{money.format(reportTotals.issueValue)}</strong></div><div className="breakdown-bar issue"><i style={{ width: `${reportTotals.receiptValue + reportTotals.issueValue ? (reportTotals.issueValue / (reportTotals.receiptValue + reportTotals.issueValue)) * 100 : 0}%` }} /></div><div className="report-note"><strong>{reportMovements.length}</strong><span>transactions recorded from {reportFrom ? shortDate.format(new Date(reportFrom + "T00:00:00")) : "the beginning"} to {reportTo ? shortDate.format(new Date(reportTo + "T00:00:00")) : "today"}.</span></div></div></article></section>
                </>
              )}

              {activeView === "Settings" && (
                <>
                  <div className="page-intro"><div><p>System preferences</p><h2>Settings</h2><span>Review application information and manage your display preference.</span></div></div>
                  <section className="settings-grid">
                    <article className="panel settings-card">
                      <div className="panel-heading"><div><span>Appearance</span><h3>Display theme</h3></div></div>
                      <div className="settings-card-body"><div className="setting-row"><div><strong>Current theme</strong><span>The selected theme is saved on this device.</span></div><button className="secondary-button" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>Use {theme === "light" ? "dark" : "light"} mode</button></div></div>
                    </article>
                    <article className="panel settings-card">
                      <div className="panel-heading"><div><span>About</span><h3>System information</h3></div></div>
                      <div className="settings-card-body">
                        <div className="about-system-identity"><span className="about-system-logo"><img src="/invlogo.png" alt="" /></span><div><strong>Inventory System</strong><span>Inventory control and reporting workspace</span></div><b>v{APP_VERSION}</b></div>
                        <p className="about-system-description">Tracks inventory items, receipts, issues, stock balances, category valuations, and operational reports in one local system.</p>
                        <div className="settings-list"><div><span>Application version</span><strong>v{APP_VERSION}</strong></div><div><span>Environment</span><strong>{APP_ENVIRONMENT}</strong></div><div><span>Database</span><strong>PostgreSQL</strong></div><div><span>Inventory costing</span><strong>Moving weighted average</strong></div><div><span>Report format</span><strong>Excel by category</strong></div><div><span>System timezone</span><strong>Asia/Manila</strong></div></div>
                      </div>
                    </article>
                  </section>
                </>
              )}
            </>
          )}
        </div>
      </section>

      {itemModalOpen && <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="item-modal-title"><div className="modal-heading"><div><span>Item masterlist</span><h2 id="item-modal-title">{itemForm.id ? "Edit item" : "Add inventory item"}</h2></div><button onClick={() => setItemModalOpen(false)} aria-label="Close">×</button></div><form onSubmit={submitItem}><div className="form-grid"><label><span>Item code</span><input required value={itemForm.code} onChange={(event) => setItemForm({ ...itemForm, code: event.target.value })} /></label><label><span>Item name</span><input required value={itemForm.name} onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })} /></label><label><span>Category</span><select required value={itemForm.categoryId} onChange={(event) => setItemForm({ ...itemForm, categoryId: event.target.value })}><option value="">Select category</option>{data.categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><label><span>Unit</span><input required placeholder="pc, box, ream…" value={itemForm.unit} onChange={(event) => setItemForm({ ...itemForm, unit: event.target.value })} /></label><label><span>Opening quantity</span><input required min="0" type="number" value={itemForm.openingQuantity} onChange={(event) => setItemForm({ ...itemForm, openingQuantity: event.target.value })} /></label><label><span>{itemForm.id ? "Average unit cost" : "Opening unit cost"}</span><input required min="0" step="0.01" type="number" disabled={Boolean(itemForm.id)} value={itemForm.unitCost} onChange={(event) => setItemForm({ ...itemForm, unitCost: event.target.value })} />{itemForm.id && <small>Calculated automatically from stock receipts.</small>}</label><label><span>Reorder level</span><input required min="0" type="number" value={itemForm.reorderLevel} onChange={(event) => setItemForm({ ...itemForm, reorderLevel: event.target.value })} /></label></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setItemModalOpen(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : itemForm.id ? "Save changes" : "Add item"}</button></div></form></section></div>}

      {categoryModalOpen && <div className="modal-backdrop" role="presentation"><section className="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="category-modal-title"><div className="modal-heading"><div><span>Item organization</span><h2 id="category-modal-title">{categoryForm.id ? "Edit category" : "Add category"}</h2></div><button onClick={() => setCategoryModalOpen(false)} aria-label="Close">×</button></div><form onSubmit={submitCategory}><div className="form-grid single-column"><label><span>Category name</span><input required value={categoryForm.name} onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })} /></label><label><span>Description</span><textarea rows={4} value={categoryForm.description} onChange={(event) => setCategoryForm({ ...categoryForm, description: event.target.value })} /></label></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setCategoryModalOpen(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : categoryForm.id ? "Save changes" : "Add category"}</button></div></form></section></div>}
    </main>
  );
}
