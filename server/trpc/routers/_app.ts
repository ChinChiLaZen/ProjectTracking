import { router } from "../trpc";
import { workspaceRouter } from "./workspace";
import { boardRouter } from "./board";
import { groupRouter } from "./group";
import { itemRouter } from "./item";
import { columnRouter } from "./column";
import { activityRouter } from "./activity";

export const appRouter = router({
  workspace: workspaceRouter,
  board: boardRouter,
  group: groupRouter,
  item: itemRouter,
  column: columnRouter,
  activity: activityRouter,
});

export type AppRouter = typeof appRouter;
