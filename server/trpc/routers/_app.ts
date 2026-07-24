import { router } from "../trpc";
import { workspaceRouter } from "./workspace";
import { boardRouter } from "./board";
import { groupRouter } from "./group";
import { itemRouter } from "./item";
import { columnRouter } from "./column";
import { activityRouter } from "./activity";
import { viewRouter } from "./view";
import { searchRouter } from "./search";

export const appRouter = router({
  workspace: workspaceRouter,
  board: boardRouter,
  group: groupRouter,
  item: itemRouter,
  column: columnRouter,
  activity: activityRouter,
  view: viewRouter,
  search: searchRouter,
});

export type AppRouter = typeof appRouter;
