import { describe, expect, it, vi } from "vitest";

import { applyCursor } from "./pagination";

function fakeCollectionRef(docGetResult: unknown) {
  return {
    doc: (id: string) => ({ id, get: () => Promise.resolve(docGetResult) }),
  };
}

describe("applyCursor", () => {
  it("returns the query unchanged when no cursor is given", async () => {
    const startAfterMock = vi.fn();
    const query = { startAfter: startAfterMock };
    const collectionRef = fakeCollectionRef({ exists: true });

    const result = await applyCursor(collectionRef as never, query as never, undefined);

    expect(result).toBe(query);
    expect(startAfterMock).not.toHaveBeenCalled();
  });

  it("resolves an existing cursor to a snapshot and calls query.startAfter with it", async () => {
    const cursorSnap = { exists: true, id: "doc-1" };
    const startAfterMock = vi.fn().mockReturnValue("query-with-cursor");
    const query = { startAfter: startAfterMock };
    const collectionRef = fakeCollectionRef(cursorSnap);

    const result = await applyCursor(collectionRef as never, query as never, "doc-1");

    expect(startAfterMock).toHaveBeenCalledWith(cursorSnap);
    expect(result).toBe("query-with-cursor");
  });

  it("ignores a cursor whose document no longer exists, returning the query unchanged", async () => {
    const startAfterMock = vi.fn();
    const query = { startAfter: startAfterMock };
    const collectionRef = fakeCollectionRef({ exists: false });

    const result = await applyCursor(collectionRef as never, query as never, "ghost");

    expect(startAfterMock).not.toHaveBeenCalled();
    expect(result).toBe(query);
  });
});
