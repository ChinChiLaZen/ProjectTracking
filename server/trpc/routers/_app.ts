import { router } from "../trpc";
import { workspaceRouter } from "./workspace";
import { boardRouter } from "./board";
import { groupRouter } from "./group";
import { itemRouter } from "./item";
import { columnRouter } from "./column";
import { activityRouter } from "./activity";
import { viewRouter } from "./view";
import { searchRouter } from "./search";
import { updateRouter } from "./update";
import { notificationRouter } from "./notification";
import { attachmentRouter } from "./attachment";

export const appRouter = router({
  workspace: workspaceRouter,
  board: boardRouter,
  group: groupRouter,
  item: itemRouter,
  column: columnRouter,
  activity: activityRouter,
  view: viewRouter,
  search: searchRouter,
  update: updateRouter,
  notification: notificationRouter,
  attachment: attachmentRouter,
});

export type AppRouter = typeof appRouter;
