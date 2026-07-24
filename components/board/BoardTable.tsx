"use client";

import { Fragment, useRef, useState, type CSSProperties } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useVirtualizer } from "@tanstack/react-virtual";
import { trpc } from "@/lib/trpc/client";
import { getColumnType } from "@/lib/columnTypes/types";
import { columnTypeRegistry } from "@/lib/columnTypes/registry";
import { rankBetween } from "@/lib/ordering/rank";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type BoardShell = RouterOutputs["board"]["get"];
type BoardGroup = BoardShell["groups"][number];
type BoardColumn = BoardShell["columns"][number];
type ItemListPage = RouterOutputs["item"]["list"];
type BoardItem = ItemListPage["items"][number];
type BoardColumnValue = ItemListPage["values"][number];

// Session 4 note: the row grid below is a styled div-grid, not a literal
// <table>, so each group can be an independently height-capped, virtualized
// scroll region (TanStack Virtual needs a fixed-size scroll container per
// list; a single <table> can't give each group's <tbody> that). ARIA
// table/row/cell roles are applied throughout to keep the same accessible
// semantics a real <table> would have (§11).
const ROW_HEIGHT = 36;
const GROUP_MAX_HEIGHT = 400;

function cellKey(itemId: string, columnId: string) {
  return `${itemId}:${columnId}`;
}

function sortByRank<T extends { rank: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
}

function gridTemplateColumns(columnCount: number) {
  return `2rem 4rem 10rem repeat(${columnCount}, minmax(8rem, 1fr))`;
}

const dragHandleStyle: CSSProperties = { cursor: "grab", textAlign: "center", touchAction: "none" };
const rowStyle: CSSProperties = { display: "grid", alignItems: "center", borderBottom: "1px solid #eee" };
const headerCellStyle: CSSProperties = { textAlign: "left", borderBottom: "1px solid #ccc", fontWeight: 600, padding: "0.25rem" };

function GroupHeaderRow({ group, columnCount }: { group: BoardGroup; columnCount: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.id,
    data: { type: "group" as const },
  });

  return (
    <div
      ref={setNodeRef}
      role="row"
      style={{
        ...rowStyle,
        gridTemplateColumns: gridTemplateColumns(columnCount),
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        paddingTop: "0.5rem",
      }}
    >
      <div {...attributes} {...listeners} role="cell" style={dragHandleStyle} aria-label={`Reorder group ${group.name}`}>
        ⠿
      </div>
      <div role="cell" style={{ gridColumn: `span ${columnCount + 2}`, fontWeight: 600 }}>
        {group.name}
      </div>
    </div>
  );
}

function ItemRow({
  item,
  columns,
  valueFor,
  editingCell,
  onStartEdit,
  onCommitValue,
  onCancelEdit,
  style,
}: {
  item: BoardItem;
  columns: BoardColumn[];
  valueFor: (itemId: string, columnId: string) => BoardColumnValue | undefined;
  editingCell: string | null;
  onStartEdit: (key: string) => void;
  onCommitValue: (item: BoardItem, column: BoardColumn, existing: BoardColumnValue | undefined, nextValue: unknown) => void;
  onCancelEdit: () => void;
  style?: CSSProperties;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { type: "item" as const },
  });

  return (
    <div
      ref={setNodeRef}
      role="row"
      style={{
        ...rowStyle,
        ...style,
        gridTemplateColumns: gridTemplateColumns(columns.length),
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <div {...attributes} {...listeners} role="cell" style={dragHandleStyle} aria-label={`Reorder item ${item.name}`}>
        ⠿
      </div>
      <div role="cell">{item.number}</div>
      <div role="cell">{item.name}</div>
      {columns.map((column) => {
        const columnType = getColumnType(columnTypeRegistry, column.key);
        const existing = valueFor(item.id, column.id);
        const key = cellKey(item.id, column.id);
        const isEditing = editingCell === key;
        const isReadOnly = Boolean(columnType.computed);
        const value = existing?.value ?? columnType.defaultValue(column.settings);

        return (
          <div
            key={column.id}
            role="cell"
            onClick={() => {
              if (!isReadOnly && !isEditing) onStartEdit(key);
            }}
          >
            {isEditing ? (
              <columnType.Editor
                value={value}
                settings={column.settings}
                onChange={(nextValue) => onCommitValue(item, column, existing, nextValue)}
                onCancel={onCancelEdit}
              />
            ) : (
              <columnType.Cell value={value} settings={column.settings} readOnly={isReadOnly} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// One group's paginated, virtualized item list — fully self-contained
// (own query, own drag context, own mutations) so item drags never need to
// reach outside their own group (Session 3 scope: same-group reorder only).
function GroupItemList({
  boardId,
  group,
  columns,
  editingCell,
  setEditingCell,
  setMutationError,
}: {
  boardId: string;
  group: BoardGroup;
  columns: BoardColumn[];
  editingCell: string | null;
  setEditingCell: (key: string | null) => void;
  setMutationError: (message: string | null) => void;
}) {
  const utils = trpc.useUtils();
  const queryInput = { boardId, groupId: group.id };
  const itemsQuery = trpc.item.list.useInfiniteQuery(queryInput, {
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const items = sortByRank((itemsQuery.data?.pages ?? []).flatMap((page) => page.items));
  const values = (itemsQuery.data?.pages ?? []).flatMap((page) => page.values);
  const valueFor = (itemId: string, columnId: string) =>
    values.find((v) => v.itemId === itemId && v.columnId === columnId);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const setColumnValue = trpc.item.setColumnValue.useMutation({
    onMutate: async (input) => {
      setMutationError(null);
      await utils.item.list.cancel(queryInput);
      const previous = utils.item.list.getInfiniteData(queryInput);

      utils.item.list.setInfiniteData(queryInput, (old) => {
        if (!old) return old;
        const key = cellKey(input.itemId, input.columnId);
        let patched = false;
        const pages = old.pages.map((page) => {
          const index = page.values.findIndex((v) => cellKey(v.itemId, v.columnId) === key);
          if (index === -1) return page;
          patched = true;
          const nextValues = page.values.map((v, i) =>
            i === index ? { ...v, value: input.value, version: input.expectedVersion + 1 } : v,
          );
          return { ...page, values: nextValues };
        });
        if (patched) return { ...old, pages };
        // No existing value row yet — append one to the first page.
        const [first, ...rest] = old.pages;
        if (!first) return old;
        return {
          ...old,
          pages: [
            {
              ...first,
              values: [...first.values, { itemId: input.itemId, columnId: input.columnId, value: input.value, version: input.expectedVersion + 1 }],
            },
            ...rest,
          ],
        };
      });

      return { previous };
    },
    onError: (err, _input, context) => {
      if (context?.previous) utils.item.list.setInfiniteData(queryInput, context.previous);
      setMutationError(err.data?.code === "CONFLICT" ? "Someone else edited this cell — refreshed." : err.message);
    },
    onSettled: () => utils.item.list.invalidate(queryInput),
  });

  const moveItem = trpc.item.move.useMutation({
    onMutate: async (input) => {
      setMutationError(null);
      await utils.item.list.cancel(queryInput);
      const previous = utils.item.list.getInfiniteData(queryInput);

      utils.item.list.setInfiniteData(queryInput, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((i) =>
              i.id === input.itemId ? { ...i, rank: input.rank, version: input.expectedVersion + 1 } : i,
            ),
          })),
        };
      });

      return { previous };
    },
    onError: (err, _input, context) => {
      if (context?.previous) utils.item.list.setInfiniteData(queryInput, context.previous);
      setMutationError(err.data?.code === "CONFLICT" ? "Someone else moved this item — refreshed." : err.message);
    },
    onSettled: () => utils.item.list.invalidate(queryInput),
  });

  function handleItemDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(items, oldIndex, newIndex);
    const targetIndex = reordered.findIndex((i) => i.id === active.id);
    const rank = rankBetween(reordered[targetIndex - 1]?.rank ?? null, reordered[targetIndex + 1]?.rank ?? null);

    const item = items.find((i) => i.id === active.id);
    if (!item) return;
    moveItem.mutate({ boardId, itemId: item.id, groupId: group.id, rank, expectedVersion: item.version });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleItemDragEnd}>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div ref={scrollRef} role="rowgroup" style={{ maxHeight: GROUP_MAX_HEIGHT, overflowY: "auto", position: "relative" }}>
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = items[virtualRow.index];
              if (!item) return null;
              return (
                <ItemRow
                  key={item.id}
                  item={item}
                  columns={columns}
                  valueFor={valueFor}
                  editingCell={editingCell}
                  onStartEdit={setEditingCell}
                  onCancelEdit={() => setEditingCell(null)}
                  onCommitValue={(targetItem, column, existing, nextValue) => {
                    setEditingCell(null);
                    setColumnValue.mutate({
                      boardId,
                      itemId: targetItem.id,
                      columnId: column.id,
                      value: nextValue,
                      expectedVersion: existing?.version ?? 0,
                    });
                  }}
                  style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${virtualRow.start}px)` }}
                />
              );
            })}
          </div>
        </div>
      </SortableContext>
      {itemsQuery.hasNextPage && (
        <button
          type="button"
          onClick={() => itemsQuery.fetchNextPage()}
          disabled={itemsQuery.isFetchingNextPage}
          style={{ margin: "0.25rem 0 0.75rem 2rem" }}
        >
          {itemsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </DndContext>
  );
}

// Board shell (Session 2/3) + cursor pagination and virtualization per
// group (Session 4). board.get is now shell-only (board/groups/columns);
// items are paginated per group via item.list. Every column cell is still
// dispatched through the registry's Cell/Editor — no per-type branching
// here (§1 rule 6).
export function BoardTable({ boardId }: { boardId: string }) {
  const utils = trpc.useUtils();
  const boardQuery = trpc.board.get.useQuery({ boardId });
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const groupSensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const moveGroupMutation = trpc.group.move.useMutation({
    onMutate: async (input) => {
      setMutationError(null);
      await utils.board.get.cancel({ boardId });
      const previous = utils.board.get.getData({ boardId });

      utils.board.get.setData({ boardId }, (old) => {
        if (!old) return old;
        return { ...old, groups: old.groups.map((g) => (g.id === input.groupId ? { ...g, rank: input.rank } : g)) };
      });

      return { previous };
    },
    onError: (err, _input, context) => {
      if (context?.previous) utils.board.get.setData({ boardId }, context.previous);
      setMutationError(err.message);
    },
    onSettled: () => utils.board.get.invalidate({ boardId }),
  });

  if (boardQuery.isLoading) return <p>Loading…</p>;
  if (!boardQuery.data) return <p>Board not found.</p>;

  const { columns } = boardQuery.data;
  const groups = sortByRank(boardQuery.data.groups);

  function handleGroupDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = groups.findIndex((g) => g.id === active.id);
    const newIndex = groups.findIndex((g) => g.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(groups, oldIndex, newIndex);
    const targetIndex = reordered.findIndex((g) => g.id === active.id);
    const rank = rankBetween(reordered[targetIndex - 1]?.rank ?? null, reordered[targetIndex + 1]?.rank ?? null);

    moveGroupMutation.mutate({ boardId, groupId: String(active.id), rank });
  }

  return (
    <div role="table" style={{ width: "100%" }}>
      {mutationError && <p style={{ color: "crimson" }}>{mutationError}</p>}
      <div role="row" style={{ ...rowStyle, gridTemplateColumns: gridTemplateColumns(columns.length) }}>
        <div role="columnheader" style={headerCellStyle} />
        <div role="columnheader" style={headerCellStyle}>#</div>
        <div role="columnheader" style={headerCellStyle}>Name</div>
        {columns.map((column) => (
          <div key={column.id} role="columnheader" style={headerCellStyle}>
            {column.name}
          </div>
        ))}
      </div>
      <DndContext sensors={groupSensors} collisionDetection={closestCenter} onDragEnd={handleGroupDragEnd}>
        <SortableContext items={groups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
          {groups.map((group) => (
            <Fragment key={group.id}>
              <GroupHeaderRow group={group} columnCount={columns.length} />
              <GroupItemList
                boardId={boardId}
                group={group}
                columns={columns}
                editingCell={editingCell}
                setEditingCell={setEditingCell}
                setMutationError={setMutationError}
              />
            </Fragment>
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}
