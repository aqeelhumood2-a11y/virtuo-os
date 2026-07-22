import "server-only";

import { FieldValue, type DocumentData } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";

import type { QueryLogEntry } from "../domain/ai-assistant.types";

// Nested under the same document Platform's app-install state already owns
// (companies/{companyId}/apps/ai-assistant), same convention every App
// uses. Append-only accountability record of what was asked/answered --
// never read by the LLM itself, never a correctness dependency (the
// Assistant works identically with or without this write succeeding).
function queryLogCollection(companyId: string) {
  return adminDb.collection("companies").doc(companyId).collection("apps").doc("ai-assistant").collection("queryLog");
}

function toQueryLogEntry(id: string, data: DocumentData): QueryLogEntry {
  return { id, question: data.question, answer: data.answer, actorId: data.actorId };
}

export async function addQueryLogEntry(companyId: string, question: string, answer: string, actorId: string): Promise<void> {
  await queryLogCollection(companyId).doc().set({
    question,
    answer,
    actorId,
    createdAt: FieldValue.serverTimestamp(),
  });
}

export async function listRecentQueryLog(companyId: string, limit: number): Promise<QueryLogEntry[]> {
  const snap = await queryLogCollection(companyId).orderBy("createdAt", "desc").limit(limit).get();
  return snap.docs.map((doc) => toQueryLogEntry(doc.id, doc.data()));
}
