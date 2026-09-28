import React, { useEffect, useRef, useState } from "react";
import { requestTasks } from "./api.js";

const priorities = ["Low", "Medium", "High"];

export default function TodoList() {
  const [tasks, setTasks] = useState([]);
  const [summary, setSummary] = useState({ total: 0, completed: 0, remaining: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const savingRef = useRef(false);
  const [taskText, setTaskText] = useState("");
  const [newPriority, setNewPriority] = useState("Medium");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");

  // Search and status filtering happen on the server. Cancel obsolete searches.
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setLoadError("");
    const timer = setTimeout(async () => {
      try {
        const query = new URLSearchParams({ search, status: filter });
        const data = await requestTasks(`?${query}`, { signal: controller.signal });
        if (active) {
          setTasks(data.tasks);
          setSummary(data.summary);
        }
      } catch (error) {
        if (active && error.name !== "AbortError") setLoadError(error.message);
      } finally {
        if (active) setLoading(false);
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, filter, refresh]);

  // Only report success after the server has saved the change to disk.
  async function changeTask(path, method, body) {
    if (savingRef.current || loading || loadError) return false;
    savingRef.current = true;
    setSaving(true);
    setActionError("");
    try {
      await requestTasks(path, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      setLoading(true);
      setRefresh((value) => value + 1);
      return true;
    } catch (error) {
      setActionError(error.message);
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function addTask(event) {
    event.preventDefault();
    const text = taskText.trim();
    if (!text) return;

    if (await changeTask("", "POST", { text, priority: newPriority })) {
      setTaskText("");
    }
  }

  function toggleTask(task) {
    changeTask(`/${task.id}`, "PATCH", { completed: !task.completed });
  }

  function startEditing(task) {
    setEditingId(task.id);
    setEditText(task.text);
  }

  function changePriority(id, priority) {
    changeTask(`/${id}`, "PATCH", { priority });
  }

  function cancelEditing() {
    setEditingId(null);
    setEditText("");
  }

  async function saveTask(event, id) {
    event.preventDefault();
    const text = editText.trim();
    if (!text) return;

    if (await changeTask(`/${id}`, "PATCH", { text })) cancelEditing();
  }

  async function deleteTask(id) {
    if (await changeTask(`/${id}`, "DELETE")) {
      if (editingId === id) cancelEditing();
    }
  }

  async function clearAllTasks() {
    if (await changeTask("", "DELETE")) cancelEditing();
  }

  const busy = loading || saving || Boolean(loadError);

  return (
    <>
      <section className="task-panel" aria-label="Manage tasks">
        {actionError && <p className="error" role="alert">{actionError}</p>}
        {loadError && (
          <div className="error" role="alert">
            <p>{loadError}</p>
            <button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button>
          </div>
        )}
        <form onSubmit={addTask}>
          <label htmlFor="new-task">New task</label>
          <div className="add-row">
            <input
              id="new-task"
              maxLength={200}
              disabled={saving}
              value={taskText}
              onChange={(event) => setTaskText(event.target.value)}
              placeholder="Enter a task"
              autoComplete="off"
            />
            <select
              aria-label="New task priority"
              disabled={saving}
              value={newPriority}
              onChange={(event) => setNewPriority(event.target.value)}
            >
              {priorities.map((priority) => (
                <option key={priority} value={priority}>{priority}</option>
              ))}
            </select>
            <button className="add-button" disabled={busy || !taskText.trim()}>Add</button>
          </div>
        </form>

        <div className="search-section">
          <label htmlFor="search">Search tasks</label>
          <input
            id="search"
            maxLength={200}
            disabled={saving}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tasks"
          />
        </div>

        <div className="filters" role="group" aria-label="Task filters and actions">
          {["All", "Completed", "Uncompleted"].map((status) => (
            <button
              key={status}
              disabled={saving}
              type="button"
              aria-pressed={filter === status}
              onClick={() => setFilter(status)}
            >
              {status}
            </button>
          ))}
          <button
            type="button"
            className="delete-button"
            onClick={clearAllTasks}
            disabled={busy || summary.total === 0}
          >
            Clear all
          </button>
        </div>

        {loading ? <p role="status">Loading tasks…</p> : loadError ? null : tasks.length > 0 ? (
          <ul className="task-list">
            {tasks.map((task) => (
              <li className="task-row" key={task.id}>
                {editingId === task.id ? (
                  <form className="edit-form" onSubmit={(event) => saveTask(event, task.id)}>
                    <input
                      aria-label="Edit task"
                      maxLength={200}
                      disabled={saving}
                      value={editText}
                      onChange={(event) => setEditText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") cancelEditing();
                      }}
                      autoFocus
                    />
                    <button type="submit" disabled={busy || !editText.trim()}>Save</button>
                    <button type="button" disabled={saving} onClick={cancelEditing}>Cancel</button>
                  </form>
                ) : (
                  <>
                    <label className={task.completed ? "task completed" : "task"}>
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={task.completed}
                        onChange={() => toggleTask(task)}
                      />
                      <span>{task.text}</span>
                    </label>
                    <button type="button" disabled={busy} onClick={() => startEditing(task)}>
                      Edit
                    </button>
                  </>
                )}
                <select
                  aria-label={`Priority for ${task.text}`}
                  disabled={busy}
                  value={task.priority}
                  onChange={(event) => changePriority(task.id, event.target.value)}
                >
                  {priorities.map((priority) => (
                    <option key={priority} value={priority}>{priority}</option>
                  ))}
                </select>
                <button type="button" disabled={busy} className="delete-button" onClick={() => deleteTask(task.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state" role="status">
            <p>{summary.total === 0
              ? "No tasks yet."
              : "No matching tasks. Try another search or filter."}</p>
          </div>
        )}

        {!loading && !loadError && (
          <footer aria-live="polite">
            <span>{summary.remaining} remaining</span>
            <span>{summary.completed} of {summary.total} completed</span>
          </footer>
        )}
      </section>
      <p className="session-note" role="status">
        {saving ? "Saving changes…" : loadError || actionError
          ? "Check the error above before retrying."
          : "Tasks are saved on the server, even after refreshing."}
      </p>
    </>
  );
}
