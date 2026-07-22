import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { serverEnv } from "@/shared/config/server-env";

// A single platform-wide LLM key (see server-env.ts's comment on
// ANTHROPIC_API_KEY for why this is not per-company like a Connector's
// credential). Lazily constructed so importing this module never fails in
// an environment where the App isn't installed/configured; only actually
// asking a question requires the key.
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!serverEnv.ANTHROPIC_API_KEY) {
    throw new AiAssistantNotConfiguredError();
  }
  if (!client) {
    client = new Anthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY });
  }
  return client;
}

export class AiAssistantNotConfiguredError extends Error {
  constructor() {
    super("The AI Assistant is not configured for this deployment (no ANTHROPIC_API_KEY set).");
    this.name = "AiAssistantNotConfiguredError";
  }
}

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 1024;

// Pure request/response -- no streaming, no tool use, no conversation
// history. The Assistant only ever answers from the context it's handed
// (see query-orchestrator.service.ts); this function itself has no
// awareness of Core, Firestore, or authorization at all.
export async function askClaude(systemPrompt: string, question: string): Promise<string> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: "user", content: question }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  return textBlock?.text ?? "";
}
