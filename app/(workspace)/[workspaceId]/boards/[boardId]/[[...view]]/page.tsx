import { BoardTable } from "@/components/board/BoardTable";
import { ActivityFeed } from "@/components/board/ActivityFeed";

// [[...view]] reserves the route shape for Kanban/Calendar/etc. (§2, §6).
// Session 7: the first (and only) segment is read as a saved View id — a
// shared view's URL is literally "the board URL + /{view.id}" (§10.1).
export default async function BoardPage({
  params,
}: {
  params: Promise<{ workspaceId: string; boardId: string; view?: string[] }>;
}) {
  const { workspaceId, boardId, view } = await params;
  const viewId = view?.[0];

  return (
    <main style={{ maxWidth: 1000, margin: "2rem auto", padding: "0 1rem" }}>
      <BoardTable boardId={boardId} workspaceId={workspaceId} viewId={viewId} />
      <ActivityFeed boardId={boardId} />
    </main>
  );
}
