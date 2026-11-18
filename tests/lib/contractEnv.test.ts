// The CMS contract (tests/cms, driven by the cms-dashboard repo) stubs the
// Cloudinary credentials with vi.stubEnv in beforeAll and expects the real
// /photography page to search with them. Under Vitest astro:env is a snapshot
// taken when it first loads, which here is before the stub (the static
// import below), so this fails unless lib/serverEnv reads the live env in
// tests. Same harness and stubs as the contract; tests/cms stays untouched.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cloudName } from "../../src/lib/serverEnv";
import { clearOriginCache } from "../../src/lib/originCache";
import { mockFetch, renderRoute } from "../cms/routes";

const fetch = vi.fn(mockFetch);
beforeAll(() => {
  vi.stubGlobal("fetch", fetch);
  vi.stubEnv("CLOUDINARY_CLOUD_NAME", "demo");
  vi.stubEnv("CLOUDINARY_API_KEY", "key");
  vi.stubEnv("CLOUDINARY_API_SECRET", "secret");
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  clearOriginCache();
});

describe("CMS contract env stubs reach the Cloudinary reads", () => {
  it("renders /photography with the stubbed credentials", async () => {
    expect(cloudName()).toBe("demo");
    const { status, body } = await renderRoute("/photography");
    expect(status).toBe(200);
    const search = fetch.mock.calls.find(([url]) => String(url).includes("api.cloudinary.com"));
    expect(search, "no Cloudinary Search call").toBeDefined();
    expect(String(search![0])).toContain("/v1_1/demo/");
    expect(new Headers(search![1]?.headers).get("Authorization")).toBe(`Basic ${btoa("key:secret")}`);
    expect(body).toContain("library-a");
  });
});
