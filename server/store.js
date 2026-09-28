import { mkdir, readFile, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export const priorities = ["Low", "Medium", "High"];
export const maxTextLength = 200;

export function isValidTask(task) {
  return task && typeof task.id === "string" && task.id.length > 0
    && typeof task.text === "string" && task.text === task.text.trim()
    && task.text.length > 0 && task.text.length <= maxTextLength
    && typeof task.completed === "boolean" && priorities.includes(task.priority);
}

// Write a complete temporary file, then replace the data file atomically.
// A failed write never replaces the last saved data or the in-memory list.
async function saveFile(file, tasks) {
  const temporaryFile = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporaryFile, "wx");
    try {
      await handle.writeFile(JSON.stringify(tasks, null, 2) + "\n", "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryFile, file);
  } finally {
    await unlink(temporaryFile).catch(() => {});
  }
}

export async function createStore(file) {
  await mkdir(dirname(file), { recursive: true });
  let tasks;
  let contents;
  try {
    contents = await readFile(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (contents === undefined) {
    tasks = [];
    await saveFile(file, tasks);
  } else {
    // Fail at startup on damaged data; never silently overwrite it with [].
    tasks = JSON.parse(contents);
    if (!Array.isArray(tasks) || !tasks.every(isValidTask)
      || new Set(tasks.map((task) => task.id)).size !== tasks.length) {
      throw new Error("Invalid task data. Restore the JSON file from a backup.");
    }
  }

  let queue = Promise.resolve();
  return {
    list() {
      return tasks.map((task) => ({ ...task }));
    },
    // Serialize changes so simultaneous requests cannot overwrite each other.
    update(change) {
      const result = queue.then(async () => {
        const nextTasks = change(tasks.map((task) => ({ ...task })));
        await saveFile(file, nextTasks);
        tasks = nextTasks;
        return tasks.map((task) => ({ ...task }));
      });
      queue = result.catch(() => {});
      return result;
    },
  };
}
