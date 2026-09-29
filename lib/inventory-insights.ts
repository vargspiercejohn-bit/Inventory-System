export type InsightItem = {
  code: string;
  name: string;
  unit: string;
  stock: number;
  reorderLevel: number;
  unitCost: number;
  issues: number;
};

export type InsightMovement = {
  itemId: number;
  itemCode: string;
  type: "RECEIPT" | "ISSUE";
  quantity: number;
  occurredAt: string;
};

export type InsightAction = {
  itemCode: string;
  itemName: string;
  urgency: "critical" | "high" | "watch";
  recommendedQuantity: number;
  unit: string;
  estimatedCost: number;
  rationale: string;
};

export type InventoryInsight = {
  mode: "ai" | "demo";
  model?: string;
  headline: string;
  summary: string;
  metrics: {
    attentionItems: number;
    estimatedOrderCost: number;
    criticalItems: number;
  };
  actions: InsightAction[];
  nextQuestions: string[];
};

function urgencyRank(urgency: InsightAction["urgency"]) {
  return urgency === "critical" ? 0 : urgency === "high" ? 1 : 2;
}

export function createDeterministicInsight(
  question: string,
  items: InsightItem[],
): InventoryInsight {
  const actions = items
    .map((item): InsightAction | null => {
      const weeklyDemand = Math.max(1, Math.ceil(item.issues / 4));
      const targetStock = Math.max(item.reorderLevel * 2, weeklyDemand * 3);
      const recommendedQuantity = Math.max(0, targetStock - item.stock);
      if (recommendedQuantity === 0 && item.stock > item.reorderLevel) return null;

      const urgency: InsightAction["urgency"] = item.stock <= 0
        ? "critical"
        : item.stock <= item.reorderLevel
          ? "high"
          : "watch";
      const coverage = weeklyDemand ? Math.max(0, item.stock / weeklyDemand) : 0;

      return {
        itemCode: item.code,
        itemName: item.name,
        urgency,
        recommendedQuantity,
        unit: item.unit,
        estimatedCost: recommendedQuantity * item.unitCost,
        rationale: item.stock <= 0
          ? `No stock remains; recent usage suggests about ${weeklyDemand} ${item.unit} per week.`
          : `${item.stock} ${item.unit} on hand is at or near the ${item.reorderLevel} ${item.unit} reorder point (${coverage.toFixed(1)} weeks of cover).`,
      };
    })
    .filter((action): action is InsightAction => action !== null)
    .sort((a, b) => urgencyRank(a.urgency) - urgencyRank(b.urgency) || b.estimatedCost - a.estimatedCost)
    .slice(0, 5);

  const estimatedOrderCost = actions.reduce((sum, action) => sum + action.estimatedCost, 0);
  const criticalItems = actions.filter((action) => action.urgency === "critical").length;
  const lowerQuestion = question.toLowerCase();
  const focus = lowerQuestion.includes("budget") || lowerQuestion.includes("cash")
    ? `The prioritized plan needs approximately PHP ${estimatedOrderCost.toLocaleString("en-PH", { maximumFractionDigits: 0 })}. Fund critical lines first, then high-risk items.`
    : lowerQuestion.includes("slow") || lowerQuestion.includes("overstock")
      ? "No urgent overstock signal is shown in the current snapshot. Review items with high stock and low recent issues before the next purchase cycle."
      : actions.length
        ? `${actions.length} item${actions.length === 1 ? "" : "s"} need attention. Start with ${actions[0].itemName} to reduce the most immediate stockout risk.`
        : "Stock levels are currently above their reorder points. Keep monitoring issue velocity before placing the next order.";

  return {
    mode: "demo",
    headline: criticalItems ? `${criticalItems} critical stockout ${criticalItems === 1 ? "risk" : "risks"} detected` : actions.length ? "Reorder plan ready" : "Inventory is in a healthy range",
    summary: focus,
    metrics: { attentionItems: actions.length, estimatedOrderCost, criticalItems },
    actions,
    nextQuestions: [
      "What should I reorder first with a PHP 10,000 budget?",
      "Which items are likely to run out next?",
      "Where could we reduce excess inventory?",
    ],
  };
}

export function isInventoryInsight(value: unknown): value is Omit<InventoryInsight, "mode" | "model"> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.headline === "string"
    && typeof candidate.summary === "string"
    && Array.isArray(candidate.actions)
    && Array.isArray(candidate.nextQuestions)
    && !!candidate.metrics
    && typeof candidate.metrics === "object";
}
