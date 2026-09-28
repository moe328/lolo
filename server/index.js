import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createApp } from "./app.js";

const port = Number(process.env.PORT || 3001);
const dataFile = process.env.DATA_FILE
  ? resolve(process.env.DATA_FILE)
  : fileURLToPath(new URL("./data/tasks.json", import.meta.url));

try {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535.");
  }
  const app = await createApp(dataFile);
  const server = app.listen(port, "127.0.0.1", () => {
    console.log(`Task API: http://127.0.0.1:${port}/api/tasks`);
    console.log(`Data file: ${dataFile}`);
  });
  server.on("error", (error) => {
    console.error("Could not start API:", error.message);
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => server.close());
  }
} catch (error) {
  console.error("Could not start API:", error.message);
  process.exitCode = 1;
}
