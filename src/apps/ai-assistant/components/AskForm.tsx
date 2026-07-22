"use client";

import { useActionState } from "react";

import { Button } from "@/shared/ui";

import { askQuestionAction, type AiAssistantActionFormState } from "../actions";
import type { QueryLogEntry } from "../domain/ai-assistant.types";

const initialState: AiAssistantActionFormState = {};

export function AskForm({
  companyId,
  branchId,
  csrfToken,
  recentQuestions,
}: {
  companyId: string;
  branchId: string;
  csrfToken: string;
  recentQuestions: QueryLogEntry[];
}) {
  const [state, action, pending] = useActionState(askQuestionAction, initialState);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-lg font-semibold text-neutral-900">AI Assistant</h1>
      <p className="text-sm text-neutral-600">
        Ask about recent orders or inventory. Answers are grounded only in data you already have access to.
      </p>

      <form action={action} className="flex flex-col gap-2">
        <input type="hidden" name="csrfToken" value={csrfToken} />
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="branchId" value={branchId} />
        <textarea
          name="question"
          rows={3}
          placeholder="e.g. How many Widgets do we have in stock?"
          className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Asking…" : "Ask"}
        </Button>
        {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
        {state.answer ? <p className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-900">{state.answer}</p> : null}
      </form>

      {recentQuestions.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-neutral-900">Recent questions</h2>
          {recentQuestions.map((entry) => (
            <div key={entry.id} className="flex flex-col gap-1 rounded-md border border-neutral-200 p-3 text-sm">
              <span className="font-medium text-neutral-900">{entry.question}</span>
              <span className="text-neutral-600">{entry.answer}</span>
            </div>
          ))}
        </div>
      ) : null}
    </main>
  );
}
