import { BoardTable } from "@/components/board/BoardTable";

// [[...view]] reserves the route shape for Kanban/Calendar/etc. (§2, §6) —
// Session 2 only implements Table, so any view segment is currently ignored.
export default async function BoardPage({
  params,
}: {
  params: Promise<{ workspaceId: string; boardId: string; view?: string[] }>;
}) {
  const { boardId } = await params;

  return (
    <main style={{ maxWidth: 1000, margin: "2rem auto", padding: "0 1rem" }}>
      <BoardTable boardId={boardId} />
    </main>
  );
}
