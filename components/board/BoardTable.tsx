"use client";

import { Fragment, useState, type CSSProperties } from "react";
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
import { trpc } from "@/lib/trpc/client";
import { getColumnType } from "@/lib/columnTypes/types";
import { columnTypeRegistry } from "@/lib/columnTypes/registry";
import { rankBetween } from "@/lib/ordering/rank";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";

type BoardData = inferRouterOutputs<AppRouter>["board"]["get"];
type BoardGroup = BoardData["groups"][number];
type BoardItem = BoardData["items"][number];
type BoardColumn = BoardData["columns"][number];
type BoardColumnValue = BoardData["values"][number];

function cellKey(itemId: string, columnId: string) {
  return `${itemId}:${columnId}`;
}

function sortByRank<T extends { rank: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
}

const dragHandleStyle: CSSProperties = { cursor: "grab", width: "1.5rem", textAlign: "center", touchAction: "none" };

function GroupRow({ group, columnCount }: { group: BoardGroup; columnCount: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.id,
    data: { type: "group" as const },
  });

  return (
    <tr ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}>
      <td {...attributes} {...listeners} style={dragHandleStyle} aria-label={`Reorder group ${group.name}`}>
        ⠿
      </td>
      <td colSpan={columnCount + 2} style={{ fontWeight: 600, paddingTop: "0.75rem" }}>
        {group.name}
      </td>
    </tr>
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
}: {
  item: BoardItem;
  columns: BoardColumn[];
  valueFor: (itemId: string, columnId: string) => BoardColumnValue | undefined;
  editingCell: string | null;
  onStartEdit: (key: string) => void;
  onCommitValue: (item: BoardItem, column: BoardColumn, existing: BoardColumnValue | undefined, nextValue: unknown) => void;
  onCancelEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { type: "item" as const, groupId: item.groupId },
  });

  return (
    <tr ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}>
      <td {...attributes} {...listeners} style={dragHandleStyle} aria-label={`Reorder item ${item.name}`}>
        ⠿
      </td>
      <td>{item.number}</td>
      <td>{item.name}</td>
      {columns.map((column) => {
        const columnType = getColumnType(columnTypeRegistry, column.key);
        const existing = valueFor(item.id, column.id);
        const key = cellKey(item.id, column.id);
        const isEditing = editingCell === key;
        const isReadOnly = Boolean(columnType.computed);
        const value = existing?.value ?? columnType.defaultValue(column.settings);

        return (
          <td
            key={column.id}
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
          </td>
        );
      })}
    </tr>
  );
}

// Minimal Table view (Session 2) + drag-to-reorder (Session 3). Every column
// cell is dispatched through the registry's Cell/Editor — no per-type
// branching here (§1 rule 6). Virtualization/pagination is Session 4.
export function BoardTable({ boardId }: { boardId: string }) {
  const utils = trpc.useUtils();
  const boardQuery = trpc.board.get.useQuery({ boardId });
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const setColumnValue = trpc.item.setColumnValue.useMutation({
    onMutate: async (input) => {
      setMutationError(null);
      await utils.board.get.cancel({ boardId });
      const previous = utils.board.get.getData({ boardId });

      utils.board.get.setData({ boardId }, (old) => {
        if (!old) return old;
        const key = cellKey(input.itemId, input.columnId);
        const index = old.values.findIndex((v) => cellKey(v.itemId, v.columnId) === key);
        const nextRow = {
          itemId: input.itemId,
          columnId: input.columnId,
          value: input.value,
          version: input.expectedVersion + 1,
        };
        const values =
          index === -1 ? [...old.values, nextRow] : old.values.map((v, i) => (i === index ? nextRow : v));
        return { ...old, values };
      });

      return { previous };
    },
    onError: (err, _input, context) => {
      if (context?.previous) utils.board.get.setData({ boardId }, context.previous);
      setMutationError(
        err.data?.code === "CONFLICT" ? "Someone else edited this cell — refreshed." : err.message,
      );
    },
    onSettled: () => utils.board.get.invalidate({ boardId }),
  });

  const moveItemMutation = trpc.item.move.useMutation({
    onMutate: async (input) => {
      setMutationError(null);
      await utils.board.get.cancel({ boardId });
      const previous = utils.board.get.getData({ boardId });

      utils.board.get.setData({ boardId }, (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((i) =>
            i.id === input.itemId
              ? { ...i, groupId: input.groupId, rank: input.rank, version: input.expectedVersion + 1 }
              : i,
          ),
        };
      });

      return { previous };
    },
    onError: (err, _input, context) => {
      if (context?.previous) utils.board.get.setData({ boardId }, context.previous);
      setMutationError(
        err.data?.code === "CONFLICT" ? "Someone else moved this item — refreshed." : err.message,
      );
    },
    onSettled: () => utils.board.get.invalidate({ boardId }),
  });

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

  const { columns, values } = boardQuery.data;
  const groups = sortByRank(boardQuery.data.groups);
  const items = boardQuery.data.items;
  const valueFor = (itemId: string, columnId: string) =>
    values.find((v) => v.itemId === itemId && v.columnId === columnId);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeType = active.data.current?.type as "group" | "item" | undefined;

    if (activeType === "group") {
      const oldIndex = groups.findIndex((g) => g.id === active.id);
      const newIndex = groups.findIndex((g) => g.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(groups, oldIndex, newIndex);
      const targetIndex = reordered.findIndex((g) => g.id === active.id);
      const rank = rankBetween(reordered[targetIndex - 1]?.rank ?? null, reordered[targetIndex + 1]?.rank ?? null);

      moveGroupMutation.mutate({ boardId, groupId: String(active.id), rank });
      return;
    }

    if (activeType === "item") {
      const groupId = active.data.current?.groupId as string;
      const itemsInGroup = sortByRank(items.filter((i) => i.groupId === groupId));
      const oldIndex = itemsInGroup.findIndex((i) => i.id === active.id);
      const newIndex = itemsInGroup.findIndex((i) => i.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(itemsInGroup, oldIndex, newIndex);
      const targetIndex = reordered.findIndex((i) => i.id === active.id);
      const rank = rankBetween(reordered[targetIndex - 1]?.rank ?? null, reordered[targetIndex + 1]?.rank ?? null);

      const item = items.find((i) => i.id === active.id);
      if (!item) return;
      moveItemMutation.mutate({ boardId, itemId: item.id, groupId: item.groupId, rank, expectedVersion: item.version });
    }
  }

  return (
    <>
      {mutationError && <p style={{ color: "crimson" }}>{mutationError}</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ borderBottom: "1px solid #ccc" }} />
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>#</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Name</th>
              {columns.map((column) => (
                <th key={column.id} style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                  {column.name}
                </th>
              ))}
            </tr>
          </thead>
          <SortableContext items={groups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
            <tbody>
              {groups.map((group) => {
                const itemsInGroup = sortByRank(items.filter((item) => item.groupId === group.id));

                return (
                  <Fragment key={group.id}>
                    <GroupRow group={group} columnCount={columns.length} />
                    <SortableContext items={itemsInGroup.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                      {itemsInGroup.map((item) => (
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
                        />
                      ))}
                    </SortableContext>
                  </Fragment>
                );
              })}
            </tbody>
          </SortableContext>
        </table>
      </DndContext>
    </>
  );
}
