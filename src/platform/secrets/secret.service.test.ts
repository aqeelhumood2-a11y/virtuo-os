import { beforeEach, describe, expect, it, vi } from "vitest";

const getSecretMock = vi.fn();
const createSecretMock = vi.fn();
const addSecretVersionMock = vi.fn();
const accessSecretVersionMock = vi.fn();
const deleteSecretMock = vi.fn();

vi.mock("@google-cloud/secret-manager", () => ({
  SecretManagerServiceClient: vi.fn().mockImplementation(function FakeSecretManagerServiceClient() {
    return {
      getSecret: getSecretMock,
      createSecret: createSecretMock,
      addSecretVersion: addSecretVersionMock,
      accessSecretVersion: accessSecretVersionMock,
      deleteSecret: deleteSecretMock,
    };
  }),
}));

vi.mock("@/shared/config/server-env", () => ({
  serverEnv: {
    FIREBASE_PROJECT_ID: "proj-1",
    FIREBASE_CLIENT_EMAIL: "svc@proj-1.iam.gserviceaccount.com",
    FIREBASE_PRIVATE_KEY: "fake-key",
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("storeConnectorCredential", () => {
  it("creates the secret when it doesn't exist yet, then adds a version", async () => {
    getSecretMock.mockRejectedValue({ code: 5 });
    createSecretMock.mockResolvedValue([{}]);
    addSecretVersionMock.mockResolvedValue([{ name: "projects/proj-1/secrets/connector-c1-shopify/versions/1" }]);

    const { storeConnectorCredential } = await import("./secret.service");
    const ref = await storeConnectorCredential("c1", "shopify", "shpat_abc");

    expect(createSecretMock).toHaveBeenCalledWith({
      parent: "projects/proj-1",
      secretId: "connector-c1-shopify",
      secret: { replication: { automatic: {} } },
    });
    expect(addSecretVersionMock).toHaveBeenCalledWith({
      parent: "projects/proj-1/secrets/connector-c1-shopify",
      payload: { data: Buffer.from("shpat_abc", "utf8") },
    });
    expect(ref).toBe("projects/proj-1/secrets/connector-c1-shopify/versions/1");
  });

  it("reuses an existing secret without creating a new one", async () => {
    getSecretMock.mockResolvedValue([{}]);
    addSecretVersionMock.mockResolvedValue([{ name: "projects/proj-1/secrets/connector-c1-shopify/versions/2" }]);

    const { storeConnectorCredential } = await import("./secret.service");
    await storeConnectorCredential("c1", "shopify", "tok2");

    expect(createSecretMock).not.toHaveBeenCalled();
  });

  it("propagates a non-not-found error from getSecret", async () => {
    getSecretMock.mockRejectedValue(new Error("permission denied"));

    const { storeConnectorCredential } = await import("./secret.service");
    await expect(storeConnectorCredential("c1", "shopify", "tok")).rejects.toThrow("permission denied");
    expect(createSecretMock).not.toHaveBeenCalled();
  });

  it("throws if Secret Manager returns no version name", async () => {
    getSecretMock.mockResolvedValue([{}]);
    addSecretVersionMock.mockResolvedValue([{}]);

    const { storeConnectorCredential } = await import("./secret.service");
    await expect(storeConnectorCredential("c1", "shopify", "tok")).rejects.toThrow();
  });
});

describe("resolveConnectorCredential", () => {
  it("decodes the payload back to plaintext", async () => {
    accessSecretVersionMock.mockResolvedValue([{ payload: { data: Buffer.from("shpat_abc", "utf8") } }]);

    const { resolveConnectorCredential } = await import("./secret.service");
    await expect(resolveConnectorCredential("projects/proj-1/secrets/s/versions/1")).resolves.toBe("shpat_abc");
  });

  it("throws when no payload is returned", async () => {
    accessSecretVersionMock.mockResolvedValue([{}]);

    const { resolveConnectorCredential } = await import("./secret.service");
    await expect(resolveConnectorCredential("ref")).rejects.toThrow();
  });
});

describe("deleteConnectorCredential", () => {
  it("deletes the secret by its computed resource name", async () => {
    deleteSecretMock.mockResolvedValue([{}]);

    const { deleteConnectorCredential } = await import("./secret.service");
    await deleteConnectorCredential("c1", "shopify");

    expect(deleteSecretMock).toHaveBeenCalledWith({ name: "projects/proj-1/secrets/connector-c1-shopify" });
  });

  it("silently ignores a not-found secret", async () => {
    deleteSecretMock.mockRejectedValue({ code: 5 });

    const { deleteConnectorCredential } = await import("./secret.service");
    await expect(deleteConnectorCredential("c1", "shopify")).resolves.toBeUndefined();
  });

  it("propagates a non-not-found error", async () => {
    deleteSecretMock.mockRejectedValue(new Error("permission denied"));

    const { deleteConnectorCredential } = await import("./secret.service");
    await expect(deleteConnectorCredential("c1", "shopify")).rejects.toThrow("permission denied");
  });
});
