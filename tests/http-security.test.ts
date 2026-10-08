import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer, type Server } from "node:http";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";

process.env.ALLOW_PRIVATE_NETWORK_FETCH = "true";
process.env.MODEL_CALLS_ENABLED = "false";
const { guardedFetch } = await import("@rfidhot/backend/lib/http-fetch");
const dispatcher = getGlobalDispatcher();
const mock = new MockAgent();
mock.disableNetConnect();
after(async () => {
  setGlobalDispatcher(dispatcher);
  await mock.close();
});

test("credentialed redirects never reach a different origin", async () => {
  let reached = 0;
  const destination = createServer((_req, res) => { reached++; res.end("unexpected"); });
  const listen = (s: Server) => new Promise<string>((resolve) => s.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(s.address() as { port: number }).port}`)));
  const target = await listen(destination);
  const origin = createServer((_req, res) => { res.writeHead(302, { location: target }); res.end(); });
  const base = await listen(origin);
  try {
    for (const name of ["Authorization", "Cookie", "Proxy-Authorization"]) {
      await assert.rejects(guardedFetch(base, { headers: { [name]: "AUDIT_FAKE_TOKEN" }, route: "direct" }), /cross-origin.*credentials/);
    }
    assert.equal(reached, 0);
    assert.equal((await guardedFetch(base, { route: "direct" })).status, 200);
    assert.equal(reached, 1, "uncredentialed collector redirects remain supported");
  } finally {
    await Promise.all([origin, destination].map((s) => new Promise<void>((resolve) => { s.close(() => resolve()); s.closeAllConnections(); })));
  }
});

test("HTTPS redirects cannot downgrade to HTTP", async () => {
  setGlobalDispatcher(mock);
  mock.get("https://origin.test").intercept({ path: "/downgrade" }).reply(302, "", { headers: { location: "http://target.test/result" } });
  await assert.rejects(guardedFetch("https://origin.test/downgrade", { route: "direct" }), /HTTPS redirect downgrade/);
  mock.assertNoPendingInterceptors();
});

test("same-origin redirect methods match 301/302/303/307/308 semantics", async () => {
  setGlobalDispatcher(mock);
  for (const status of [301, 302, 303, 307, 308]) {
    const method = status === 307 || status === 308 ? "POST" : "GET";
    const pool = mock.get("https://origin.test");
    pool.intercept({ path: `/start-${status}`, method: "POST", body: "private body" })
      .reply(status, "", { headers: { location: `/end-${status}` } });
    pool.intercept({ path: `/end-${status}`, method, ...(method === "POST" ? { body: "private body" } : {}) })
      .reply(200, method);
    const response = await guardedFetch(`https://origin.test/start-${status}`, {
      method: "POST", body: "private body", headers: { authorization: "Bearer TEST", "content-type": "text/plain" }, route: "direct",
    });
    assert.equal(response.text(), method);
  }
  mock.assertNoPendingInterceptors();
});

test("307 cannot carry a request body to another origin", async () => {
  setGlobalDispatcher(mock);
  mock.get("https://origin.test").intercept({ path: "/body", method: "POST", body: "private body" })
    .reply(307, "", { headers: { location: "https://target.test/body" } });
  await assert.rejects(guardedFetch("https://origin.test/body", { method: "POST", body: "private body", route: "direct" }), /cross-origin.*request body/);
  mock.assertNoPendingInterceptors();
});
