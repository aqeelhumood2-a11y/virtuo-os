import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/health", () => {
  it("responds 200 with a status and timestamp", async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
  });
});
