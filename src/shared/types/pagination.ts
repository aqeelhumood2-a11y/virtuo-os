// A generic, storage-agnostic cursor-pagination shape shared by any Core
// module that lists a growing, ordered collection (audit logs,
// notifications, and future candidates like inventory movements). `cursor`
// is an opaque token from a previous page's `nextCursor` -- callers never
// construct or parse it themselves, only pass it back verbatim. Kept here
// rather than duplicated per module so every paginated list API in Core
// has the same shape before any UI exists to consume it.
export type PageOptions = {
  limit?: number;
  cursor?: string;
};

export type Page<T> = {
  items: T[];
  // null means "no more pages" -- absent/undefined is deliberately not used
  // so callers can't mistake "not yet fetched" for "exhausted."
  nextCursor: string | null;
};
