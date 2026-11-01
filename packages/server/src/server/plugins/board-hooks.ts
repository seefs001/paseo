import type { BoardTaskService } from "../board/tasks.js";
import type { PluginLifecycle } from "./lifecycle/index.js";

export function subscribeBoardTaskHooks(
  tasks: BoardTaskService,
  lifecycle: PluginLifecycle,
): () => void {
  const previousTasks = new Map(tasks.list().map((task) => [task.id, task]));
  return tasks.subscribe((change) => {
    if (change.kind === "remove") {
      const task = previousTasks.get(change.taskId);
      previousTasks.delete(change.taskId);
      if (task) lifecycle.emit("board.task.delete.after", { task });
      return;
    }
    const previous = previousTasks.get(change.task.id);
    previousTasks.set(change.task.id, change.task);
    if (previous) {
      lifecycle.emit("board.task.update.after", { previous, next: change.task });
    } else {
      lifecycle.emit("board.task.create.after", { task: change.task });
    }
  });
}
