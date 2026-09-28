import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createApp } from "./app.js";

async function fixture(t) {
  const folder = await mkdtemp(join(tmpdir(), "mememe-api-test-"));
  const file = join(folder, "data", "tasks.json");
  let server;
  let base;
  async function stop() {
    if (server) await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  async function start() {
    const app = await createApp(file);
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;
  }
  t.after(async () => {
    await stop();
    await rm(folder, { recursive: true, force: true });
  });
  await start();
  return {
    folder, file, stop, start,
    async request(path = "", method = "GET", body, headers) {
      const response = await fetch(`${base}/api/tasks${path}`, {
        method,
        headers: headers || { "Content-Type": "application/json" },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      });
      assert.match(response.headers.get("content-type"), /application\/json/);
      return { status: response.status, data: await response.json() };
    },
  };
}

test("CRUD, combined search/status, priorities, counts and restart persistence", async (t) => {
  const api = await fixture(t);
  assert.deepEqual((await api.request()).data.tasks, []);
  const first = await api.request("", "POST", { text: "  Learn React  ", priority: "High" });
  assert.equal(first.status, 201);
  const id = first.data.task.id;
  assert.equal(first.data.task.text, "Learn React");
  const second = await api.request("", "POST", { text: "Read a book" });
  assert.equal(second.data.task.priority, "Medium");
  assert.equal(second.data.task.completed, false);
  assert.equal((await api.request(`/${id}`, "PATCH", { text: "Review React", completed: true, priority: "Low" })).status, 200);
  const found = await api.request("?search=REACT&status=Completed");
  assert.deepEqual(found.data.tasks.map((task) => task.text), ["Review React"]);
  assert.deepEqual(found.data.summary, { total: 2, completed: 1, remaining: 1 });
  assert.equal((await api.request("?search=React&status=Uncompleted")).data.tasks.length, 0);
  await api.stop();
  await api.start();
  const restored = (await api.request()).data.tasks.find((task) => task.id === id);
  assert.equal(restored.priority, "Low");
  assert.equal(restored.completed, true);
  assert.equal(restored.text, "Review React");
  assert.equal((await api.request(`/${id}`, "DELETE")).data.deletedId, id);
  assert.equal((await api.request(`/${id}`, "PATCH", { text: "Missing" })).status, 404);
  assert.equal((await api.request(`/${id}`, "DELETE")).status, 404);
  assert.equal((await api.request("", "DELETE")).data.deletedCount, 1);
  await api.stop();
  await api.start();
  assert.deepEqual((await api.request()).data.tasks, []);
  assert.deepEqual(JSON.parse(await readFile(api.file, "utf8")), []);
});

test("invalid requests return JSON errors and never modify saved data", async (t) => {
  const api = await fixture(t);
  for (const body of [null, [], {}, { text: " " }, { text: 42 }, { text: "x".repeat(201) },
    { text: "Task", completed: "false" }, { text: "Task", priority: "Urgent" },
    { text: "Task", id: "client-id" }]) {
    const result = await api.request("", "POST", body === null ? "null" : body);
    assert.equal(result.status, 400);
    assert.equal(typeof result.data.error, "string");
  }
  assert.equal((await api.request("", "POST", "{broken")).status, 400);
  assert.equal((await api.request("", "POST", { text: "x".repeat(17000) })).status, 413);
  assert.equal((await api.request("", "POST", "text=Task", { "Content-Type": "application/x-www-form-urlencoded" })).status, 415);
  assert.equal((await api.request("?status=Unknown")).status, 400);
  assert.equal((await api.request("?search=a&search=b")).status, 400);
  assert.equal((await api.request("", "PUT")).status, 405);
  const created = await api.request("", "POST", { text: "Keep me" });
  const before = await readFile(api.file, "utf8");
  for (const body of [{ text: " " }, { completed: 0 }, { priority: null }, {}]) {
    assert.equal((await api.request(`/${created.data.task.id}`, "PATCH", body)).status, 400);
  }
  assert.equal(await readFile(api.file, "utf8"), before);
});

test("concurrent writes retain all additions and changes to the same task", async (t) => {
  const api = await fixture(t);
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) =>
    api.request("", "POST", { text: `Task ${index}` })));
  assert.ok(results.every((result) => result.status === 201));
  const id = results[0].data.task.id;
  await Promise.all([
    api.request(`/${id}`, "PATCH", { text: "Updated" }),
    api.request(`/${id}`, "PATCH", { completed: true }),
    api.request(`/${id}`, "PATCH", { priority: "High" }),
  ]);
  await api.stop();
  await api.start();
  const tasks = (await api.request()).data.tasks;
  assert.equal(tasks.length, 20);
  assert.equal(new Set(tasks.map((task) => task.id)).size, 20);
  assert.deepEqual(tasks.find((task) => task.id === id), { id, text: "Updated", completed: true, priority: "High" });
});

test("failed disk writes preserve data and do not poison the write queue", async (t) => {
  const api = await fixture(t);
  await api.request("", "POST", { text: "Keep this" });
  const original = await readFile(api.file, "utf8");
  const dataFolder = join(api.folder, "data");
  const backupFolder = join(api.folder, "data-backup");
  await rename(dataFolder, backupFolder);
  try {
    assert.equal((await api.request("", "POST", { text: "Must not persist" })).status, 500);
    assert.equal((await api.request()).data.tasks.length, 1);
  } finally {
    await rename(backupFolder, dataFolder);
  }
  assert.equal(await readFile(api.file, "utf8"), original);
  assert.equal((await api.request("", "POST", { text: "Recovered" })).status, 201);
  assert.equal((await api.request()).data.tasks.length, 2);
});

test("damaged JSON stops startup without overwriting the file", async (t) => {
  const api = await fixture(t);
  await api.stop();
  for (const contents of ["{broken", '[{"id":"bad"}]']) {
    await writeFile(api.file, contents);
    await assert.rejects(createApp(api.file));
    assert.equal(await readFile(api.file, "utf8"), contents);
  }
});
