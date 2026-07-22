// Read-only Q&A over data the asking user can already see through Core's
// own already-capability-gated reads -- never a new grant of access, never
// a write path. See docs/phases/PHASE_6_PLAN.md §6.
export type QueryLogEntry = {
  id: string;
  question: string;
  answer: string;
  actorId: string;
};
