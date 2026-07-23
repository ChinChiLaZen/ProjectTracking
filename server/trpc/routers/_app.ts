import { router } from "../trpc";
import { workspaceRouter } from "./workspace";

export const appRouter = router({
  workspace: workspaceRouter,
});

export type AppRouter = typeof appRouter;
