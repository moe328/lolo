import express from "express";
import { randomUUID } from "node:crypto";
import { createStore, priorities, maxTextLength } from "./store.js";

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function validateBody(body, creating = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw httpError(400, "Send a JSON object.");
  }
  const keys = Object.keys(body);
  if (!keys.length || keys.some((key) => !["text", "completed", "priority"].includes(key))) {
    throw httpError(400, "Use only text, completed, and priority fields.");
  }
  const changes = {};
  if (creating || Object.hasOwn(body, "text")) {
    if (typeof body.text !== "string" || !body.text.trim()
      || body.text.trim().length > maxTextLength) {
      throw httpError(400, `Task text must contain 1–${maxTextLength} characters.`);
    }
    changes.text = body.text.trim();
  }
  if (Object.hasOwn(body, "completed")) {
    if (typeof body.completed !== "boolean") {
      throw httpError(400, "completed must be true or false.");
    }
    changes.completed = body.completed;
  }
  if (Object.hasOwn(body, "priority")) {
    if (!priorities.includes(body.priority)) {
      throw httpError(400, "priority must be Low, Medium, or High.");
    }
    changes.priority = body.priority;
  }
  return changes;
}

export async function createApp(dataFile) {
  const store = await createStore(dataFile);
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use((req, _res, next) => {
    if (["POST", "PATCH"].includes(req.method) && !req.is("application/json")) {
      return next(httpError(415, "Use Content-Type: application/json."));
    }
    next();
  });
  app.use(express.json({ limit: "16kb" }));

  app.get("/api/tasks", (req, res) => {
    const { search = "", status = "All" } = req.query;
    if (typeof search !== "string" || search.length > maxTextLength
      || !["All", "Completed", "Uncompleted"].includes(status)) {
      throw httpError(400, "Invalid search or status filter.");
    }
    const allTasks = store.list();
    const tasks = allTasks.filter((task) => {
      const matchesSearch = task.text.toLowerCase().includes(search.trim().toLowerCase());
      const matchesStatus = status === "All"
        || (status === "Completed" && task.completed)
        || (status === "Uncompleted" && !task.completed);
      return matchesSearch && matchesStatus;
    });
    const completed = allTasks.filter((task) => task.completed).length;
    res.json({ tasks, summary: { total: allTasks.length, completed, remaining: allTasks.length - completed } });
  });

  app.post("/api/tasks", async (req, res) => {
    const changes = validateBody(req.body, true);
    const task = { id: randomUUID(), completed: false, priority: "Medium", ...changes };
    await store.update((tasks) => [...tasks, task]);
    res.status(201).json({ task });
  });

  app.patch("/api/tasks/:id", async (req, res) => {
    const changes = validateBody(req.body);
    const tasks = await store.update((current) => {
      if (!current.some((task) => task.id === req.params.id)) {
        throw httpError(404, "Task not found.");
      }
      return current.map((task) => task.id === req.params.id ? { ...task, ...changes } : task);
    });
    res.json({ task: tasks.find((task) => task.id === req.params.id) });
  });

  app.delete("/api/tasks/:id", async (req, res) => {
    await store.update((tasks) => {
      if (!tasks.some((task) => task.id === req.params.id)) {
        throw httpError(404, "Task not found.");
      }
      return tasks.filter((task) => task.id !== req.params.id);
    });
    res.json({ deletedId: req.params.id });
  });

  app.delete("/api/tasks", async (_req, res) => {
    let deletedCount = 0;
    await store.update((tasks) => {
      deletedCount = tasks.length;
      return [];
    });
    res.json({ deletedCount });
  });

  app.all("/api/tasks", (_req, res) => {
    res.set("Allow", "GET, POST, DELETE").status(405).json({ error: "Method not allowed." });
  });
  app.all("/api/tasks/:id", (_req, res) => {
    res.set("Allow", "PATCH, DELETE").status(405).json({ error: "Method not allowed." });
  });
  app.use((_req, res) => res.status(404).json({ error: "Endpoint not found." }));
  app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    let message = error.message;
    if (error.type === "entity.parse.failed") message = "Invalid JSON.";
    if (status === 413) message = "Request body is too large.";
    if (status >= 500) {
      console.error("Task storage request failed:", error.message);
      message = "Could not save tasks. Please try again.";
    }
    res.status(status).json({ error: message });
  });
  return app;
}
