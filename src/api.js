export async function requestTasks(path = "", options = {}) {
  let response;
  try {
    response = await fetch(`/api/tasks${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Cannot reach the task server. Start it and try again.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || "The task server is unavailable. Start it and try again.");
  }
  if (!data) throw new Error("The task server returned an invalid response.");
  return data;
}
