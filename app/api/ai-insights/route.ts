import {
  createDeterministicInsight,
  isInventoryInsight,
  type InsightItem,
  type InsightMovement,
} from "@/lib/inventory-insights";

export const dynamic = "force-dynamic";

type RequestBody = {
  question?: string;
  items?: InsightItem[];
  movements?: InsightMovement[];
};

function extractOutputText(payload: Record<string, unknown>) {
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const entry of output) {
    if (!entry || typeof entry !== "object") continue;
    const content = Array.isArray((entry as { content?: unknown[] }).content)
      ? (entry as { content: unknown[] }).content
      : [];
    for (const part of content) {
      if (part && typeof part === "object" && (part as { type?: string }).type === "output_text") {
        const text = (part as { text?: unknown }).text;
        if (typeof text === "string") return text;
      }
    }
  }
  return "";
}

function parseJsonText(text: string) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed) as unknown;
}

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = await request.json() as RequestBody;
  } catch {
    return Response.json({ error: "A valid request body is required." }, { status: 400 });
  }

  const question = typeof body.question === "string" && body.question.trim()
    ? body.question.trim().slice(0, 500)
    : "What should I reorder this week?";
  const items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
  const movements = Array.isArray(body.movements) ? body.movements.slice(0, 500) : [];
  const fallback = createDeterministicInsight(question, items);
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey || !items.length) return Response.json(fallback);

  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const inventoryContext = {
    question,
    currency: "PHP",
    items,
    recentMovements: movements,
    deterministicBaseline: fallback,
  };

  try {
    const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: [
          "You are StockPilot AI, an explainable inventory analyst for a small business.",
          "Use only the supplied inventory facts. Never invent demand, suppliers, lead times, revenue, or savings.",
          "Return one JSON object only, without markdown.",
          "Required keys: headline (string), summary (string), metrics ({attentionItems:number, estimatedOrderCost:number, criticalItems:number}), actions (array), nextQuestions (array of 3 strings).",
          "Each action must contain itemCode, itemName, urgency (critical|high|watch), recommendedQuantity, unit, estimatedCost, and rationale.",
          "Keep actions to at most 5, state assumptions plainly, and make the recommendation useful to a Philippine small-business operator.",
        ].join(" "),
        input: JSON.stringify(inventoryContext),
        max_output_tokens: 1200,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!openAIResponse.ok) throw new Error(`OpenAI request failed with ${openAIResponse.status}.`);
    const responsePayload = await openAIResponse.json() as Record<string, unknown>;
    const parsed = parseJsonText(extractOutputText(responsePayload));
    if (!isInventoryInsight(parsed)) throw new Error("OpenAI returned an unexpected response shape.");

    return Response.json({ ...parsed, mode: "ai", model });
  } catch (error) {
    console.error("StockPilot AI fallback:", error);
    return Response.json(fallback);
  }
}
