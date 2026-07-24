"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { trpc } from "@/lib/trpc/client";
import { getColumnType } from "@/lib/columnTypes/types";
import { columnTypeRegistry } from "@/lib/columnTypes/registry";
import { rankBetween } from "@/lib/ordering/rank";
import { bucketItemsByGroupKeys, type KanbanBucket } from "@/lib/views/bucketItemsByGroupKeys";
import { valueForGroupKey } from "@/lib/views/kanbanGroupKeyValue";
import type { ViewConfig } from "@/lib/views/viewConfig";
import { cellKey, sortByRank } from "./BoardTable";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type BoardShell = RouterOutputs["board"]["get"];
type BoardGroup = BoardShell["groups"][number];
type BoardColumn = BoardShell["columns"][number];
type ItemListPage = RouterOutputs["item"]["list"];
type BoardItem = ItemListPage["items"][number];

// A card can render in more than one bucket at once (a multi-assignee
// `person` item — Decision 3), so the DOM/drag id is `${bucketKey}::${itemId}`,
// not the bare itemId — dnd-kit requires each draggable to have a unique id.
function KanbanCard({ item, draggableId }: { item: BoardItem; draggableId: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: draggableId });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-testid={`kanban-card-${item.id}`}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.5 : 1,
        border: "1px solid #ddd",
        borderRadius: 4,
        padding: "0.5rem",
        marginBottom: "0.5rem",
        background: "#fff",
        cursor: "grab",
        touchAction: "none",
      }}
    >
      {item.name}
    </div>
  );
}

// No per-card drop targets (no @dnd-kit/sortable here) — Session 9
// deliberately doesn't support manual reordering within a bucket, only
// moving a card between buckets. Dropping anywhere in a bucket always
// appends to its end; see KanbanGroupSwimlanes' handleDragEnd.
function KanbanBucketColumn({ bucket, itemsById }: { bucket: KanbanBucket; itemsById: Map<string, BoardItem> }) {
  const { setNodeRef, isOver } = useDroppable({ id: bucket.key });
  return (
    <div
      ref={setNodeRef}
      data-testid={`kanban-bucket-${bucket.key}`}
      style={{
        minWidth: 220,
        flexShrink: 0,
        background: isOver ? "#eef6ff" : "#f7f7f7",
        borderRadius: 6,
        padding: "0.5rem",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
        {bucket.color && (
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: bucket.color,
              marginRight: "0.4rem",
            }}
          />
        )}
        {bucket.label} <span style={{ color: "#888", fontWeight: 400 }}>({bucket.itemIds.length})</span>
      </div>
      {bucket.itemIds.map((id) => {
        const item = itemsById.get(id);
        if (!item) return null;
        return <KanbanCard key={`${bucket.key}::${id}`} item={item} draggableId={`${bucket.key}::${id}`} />;
      })}
    </div>
  );
}

// One real board Group's swimlanes — reuses the exact trpc.item.list
// query shape GroupItemList (Table) already uses, same pagination/filter/
// sort compiler; only the rendering differs (§6: presentation/grouping
// only). Buckets are a display grouping *within* this Group, not a
// replacement for it — a card never crosses Groups via a Kanban drag.
function KanbanGroupSwimlanes({
  boardId,
  group,
  groupByColumn,
  viewConfig,
  setMutationError,
}: {
  boardId: string;
  group: BoardGroup;
  groupByColumn: BoardColumn;
  viewConfig: ViewConfig;
  setMutationError: (message: string | null) => void;
}) {
  const utils = trpc.useUtils();
  const queryInput = { boardId, groupId: group.id, viewConfig };
  const itemsQuery = trpc.item.list.useInfiniteQuery(queryInput, {
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const items = sortByRank((itemsQuery.data?.pages ?? []).flatMap((page) => page.items));
  const values = (itemsQuery.data?.pages ?? []).flatMap((page) => page.values);
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const valueFor = (itemId: string, columnId: string) => values.find((v) => v.itemId === itemId && v.columnId === columnId);

  const columnType = getColumnType(columnTypeRegistry, groupByColumn.key);
  const buckets = bucketItemsByGroupKeys(
    items,
    (itemId) => valueFor(itemId, groupByColumn.id)?.value,
    columnType,
    groupByColumn.settings,
  );

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor));

  const moveKanban = trpc.item.moveKanban.useMutation({
    onMutate: async (input) => {
      setMutationError(null);
      await utils.item.list.cancel(queryInput);
      const previous = utils.item.list.getInfiniteData(queryInput);

      utils.item.list.setInfiniteData(queryInput, (old) => {
        if (!old) return old;
        const key = cellKey(input.itemId, input.columnId);
        let patchedValue = false;

        const pages = old.pages.map((page) => {
          const nextItems = page.items.map((i) =>
            i.id === input.itemId ? { ...i, rank: input.rank, version: input.expectedItemVersion + 1 } : i,
          );
          const valueIndex = page.values.findIndex((v) => cellKey(v.itemId, v.columnId) === key);
          if (valueIndex !== -1) patchedValue = true;
          const nextValues =
            valueIndex === -1
              ? page.values
              : page.values.map((v, idx) =>
                  idx === valueIndex ? { ...v, value: input.value, version: input.expectedColumnVersion + 1 } : v,
                );
          return { ...page, items: nextItems, values: nextValues };
        });

        if (patchedValue) return { ...old, pages };
        const [first, ...rest] = pages;
        if (!first) return { ...old, pages };
        return {
          ...old,
          pages: [
            {
              ...first,
              values: [
                ...first.values,
                { itemId: input.itemId, columnId: input.columnId, value: input.value, version: input.expectedColumnVersion + 1 },
              ],
            },
            ...rest,
          ],
        };
      });

      return { previous };
    },
    onError: (err, _input, context) => {
      if (context?.previous) utils.item.list.setInfiniteData(queryInput, context.previous);
      setMutationError(err.data?.code === "CONFLICT" ? "Someone else edited this card — refreshed." : err.message);
    },
    onSettled: () => utils.item.list.invalidate(queryInput),
  });

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const [sourceBucketKey, itemId] = String(active.id).split("::");
    const targetBucketKey = String(over.id);
    if (!itemId || sourceBucketKey === targetBucketKey) return;

    const item = itemsById.get(itemId);
    if (!item) return;

    const targetBucket = buckets.find((b) => b.key === targetBucketKey);
    const lastItemId = targetBucket?.itemIds[targetBucket.itemIds.length - 1];
    const lastItem = lastItemId ? itemsById.get(lastItemId) : undefined;
    const rank = rankBetween(lastItem?.rank ?? null, null);

    const existingValue = valueFor(itemId, groupByColumn.id);
    const currentValue = existingValue?.value ?? columnType.defaultValue(groupByColumn.settings);

    let newValue: unknown;
    try {
      newValue = valueForGroupKey(columnType.shadowField, currentValue, sourceBucketKey ?? "__empty__", targetBucketKey);
    } catch {
      setMutationError("This column type doesn't support Kanban drag.");
      return;
    }

    moveKanban.mutate({
      boardId,
      itemId,
      rank,
      expectedItemVersion: item.version,
      columnId: groupByColumn.id,
      value: newValue,
      expectedColumnVersion: existingValue?.version ?? 0,
    });
  }

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <strong>{group.name}</strong>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div style={{ display: "flex", gap: "0.75rem", overflowX: "auto", padding: "0.5rem 0" }}>
          {buckets.map((bucket) => (
            <KanbanBucketColumn key={bucket.key} bucket={bucket} itemsById={itemsById} />
          ))}
        </div>
      </DndContext>
      {itemsQuery.hasNextPage && (
        <button type="button" onClick={() => itemsQuery.fetchNextPage()} disabled={itemsQuery.isFetchingNextPage}>
          {itemsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}

export function KanbanBoard({
  boardId,
  groups,
  groupByColumn,
  viewConfig,
  setMutationError,
}: {
  boardId: string;
  groups: BoardGroup[];
  groupByColumn: BoardColumn;
  viewConfig: ViewConfig;
  setMutationError: (message: string | null) => void;
}) {
  return (
    <div>
      {sortByRank(groups).map((group) => (
        <KanbanGroupSwimlanes
          key={group.id}
          boardId={boardId}
          group={group}
          groupByColumn={groupByColumn}
          viewConfig={viewConfig}
          setMutationError={setMutationError}
        />
      ))}
    </div>
  );
}
