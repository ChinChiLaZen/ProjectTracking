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
import { defaultViewConfig, type ViewConfig } from "@/lib/views/viewConfig";
import { isKanbanGroupable } from "@/lib/views/kanbanGroupKeyValue";
import { FilterSortBuilder } from "./FilterSortBuilder";
import { KanbanBoard } from "./KanbanBoard";
import { CalendarBoard } from "./CalendarBoard";
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

export function cellKey(itemId: string, columnId: string) {
  return `${itemId}:${columnId}`;
}

// Exported for KanbanBoard.tsx (Session 9), which reuses the exact same
// item.list query shape/pagination as GroupItemList and only differs in
// how the loaded items are rendered (§6: "presentation and grouping only").
export function sortByRank<T extends { rank: string }>(rows: T[]): T[] {
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
      data-testid={`group-row-${group.id}`}
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
  dataIndex,
  measureRef,
}: {
  item: BoardItem;
  columns: BoardColumn[];
  valueFor: (itemId: string, columnId: string) => BoardColumnValue | undefined;
  editingCell: string | null;
  onStartEdit: (key: string) => void;
  onCommitValue: (item: BoardItem, column: BoardColumn, existing: BoardColumnValue | undefined, nextValue: unknown) => void;
  onCancelEdit: () => void;
  style?: CSSProperties;
  dataIndex: number;
  // TanStack Virtual's dynamic-measurement callback ref — see the note
  // where it's passed in below for why this is required, not optional.
  measureRef: (node: Element | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { type: "item" as const },
  });

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        measureRef(node);
      }}
      data-index={dataIndex}
      role="row"
      data-testid={`item-row-${item.id}`}
      style={{
        ...rowStyle,
        ...style,
        gridTemplateColumns: gridTemplateColumns(columns.length),
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <div
        {...attributes}
        {...listeners}
        role="cell"
        data-testid={`drag-handle-${item.id}`}
        style={dragHandleStyle}
        aria-label={`Reorder item ${item.name}`}
      >
        ⠿
      </div>
      <div role="cell" data-testid={`item-number-${item.id}`}>{item.number}</div>
      <div role="cell" data-testid={`item-name-${item.id}`}>{item.name}</div>
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
            data-testid={`cell-${item.id}-${column.id}`}
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
  viewConfig,
  editingCell,
  setEditingCell,
  setMutationError,
}: {
  boardId: string;
  group: BoardGroup;
  columns: BoardColumn[];
  viewConfig: ViewConfig;
  editingCell: string | null;
  setEditingCell: (key: string | null) => void;
  setMutationError: (message: string | null) => void;
}) {
  const utils = trpc.useUtils();
  const queryInput = { boardId, groupId: group.id, viewConfig };
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

  const [newItemName, setNewItemName] = useState("");
  const createItem = trpc.item.create.useMutation({
    onSuccess: () => {
      setNewItemName("");
      utils.item.list.invalidate(queryInput);
    },
    onError: (err) => setMutationError(err.message),
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
    <>
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
                    style={{ position: "absolute", top: virtualRow.start, left: 0, right: 0 }}
                    dataIndex={virtualRow.index}
                    // Rows aren't a fixed height (form inputs, wrapped
                    // text) — estimateSize is only a first guess. Without
                    // dynamic measurement the virtualizer keeps using that
                    // guess for every row's offset, so taller-than-estimate
                    // rows overlap the next one (found via a real Playwright
                    // click failing on an intercepted pointer-events target,
                    // not by inspection).
                    measureRef={virtualizer.measureElement}
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
      <form
        aria-label={`Add item to ${group.name}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (newItemName.trim().length === 0) return;
          createItem.mutate({ boardId, groupId: group.id, name: newItemName.trim() });
        }}
        style={{ margin: "0.25rem 0 0.75rem 2rem", display: "flex", gap: "0.5rem" }}
      >
        <input
          value={newItemName}
          onChange={(e) => setNewItemName(e.target.value)}
          placeholder="+ Add item"
          disabled={createItem.isPending}
        />
        <button type="submit" disabled={createItem.isPending || newItemName.trim().length === 0}>
          Add
        </button>
      </form>
    </>
  );
}

// One saved view's config, or the default when no viewId is in the URL.
// This is the *base* config — BoardTable layers an editable draft on top of
// it (Session 8) before it's actually queried; see the draftConfig state
// in BoardTable below.
function useActiveViewConfig(boardId: string, viewId: string | undefined) {
  const viewQuery = trpc.view.get.useQuery(
    { boardId, viewId: viewId ?? "" },
    { enabled: Boolean(viewId) },
  );
  if (viewId && viewQuery.data) {
    // `config` is validated server-side at save time (viewConfigSchema in
    // server/services/views.ts) — trusted here, not re-parsed on every read.
    return viewQuery.data.config as ViewConfig;
  }
  return defaultViewConfig;
}

// "Views" panel: lists saved views as links to their shareable URL, plus an
// inline "save current view as…" form and (Session 8) an "Update" button
// that persists the current draft back onto the loaded view. `draftConfig`
// is whatever the filter/sort builder currently has live — not necessarily
// the view's own saved config, which is exactly what makes "save"/"update"
// meaningful. No client-side permission pre-check for Update — it's shown
// whenever a view is loaded and a FORBIDDEN response (if any) surfaces the
// same way every other mutation error does in this component.
function ViewsPanel({
  workspaceId,
  boardId,
  viewId,
  draftConfig,
}: {
  workspaceId: string;
  boardId: string;
  viewId?: string;
  draftConfig: ViewConfig;
}) {
  const utils = trpc.useUtils();
  const viewsQuery = trpc.view.list.useQuery({ boardId });
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"SHARED" | "PERSONAL">("SHARED");
  const [error, setError] = useState<string | null>(null);

  const createView = trpc.view.create.useMutation({
    onSuccess: () => {
      setName("");
      utils.view.list.invalidate({ boardId });
    },
    onError: (err) => setError(err.message),
  });

  const updateView = trpc.view.update.useMutation({
    onSuccess: () => {
      utils.view.list.invalidate({ boardId });
      utils.view.get.invalidate({ boardId, viewId: viewId ?? "" });
    },
    onError: (err) => setError(err.message),
  });

  const currentView = viewsQuery.data?.find((v) => v.id === viewId);

  return (
    <div style={{ margin: "0.5rem 0 1rem", padding: "0.5rem", border: "1px solid #ddd" }}>
      <strong>Views</strong>
      <ul style={{ margin: "0.5rem 0", paddingLeft: "1.25rem" }}>
        <li>
          <a href={`/${workspaceId}/boards/${boardId}`} aria-current={!viewId ? "page" : undefined}>
            Default
          </a>
        </li>
        {(viewsQuery.data ?? []).map((view) => (
          <li key={view.id}>
            <a href={`/${workspaceId}/boards/${boardId}/${view.id}`} aria-current={viewId === view.id ? "page" : undefined}>
              {view.name}
            </a>{" "}
            <span style={{ color: "#888" }}>({view.visibility.toLowerCase()})</span>
          </li>
        ))}
      </ul>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {viewId && currentView && (
        <p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              updateView.mutate({ boardId, viewId, config: draftConfig });
            }}
            disabled={updateView.isPending}
          >
            Update &ldquo;{currentView.name}&rdquo; with current filters/sort
          </button>
        </p>
      )}
      <form
        aria-label="Save current view as"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (name.trim().length === 0) return;
          createView.mutate({ boardId, name: name.trim(), visibility, config: draftConfig });
        }}
        style={{ display: "flex", gap: "0.5rem" }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Save current view as…"
          disabled={createView.isPending}
        />
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as "SHARED" | "PERSONAL")}>
          <option value="SHARED">Shared</option>
          <option value="PERSONAL">Personal</option>
        </select>
        <button type="submit" disabled={createView.isPending || name.trim().length === 0}>
          Save
        </button>
      </form>
    </div>
  );
}

// Board shell (Session 2/3) + cursor pagination and virtualization per
// group (Session 4) + saved views (Session 7). board.get is now shell-only
// (board/groups/columns); items are paginated per group via item.list.
// Every column cell is still dispatched through the registry's Cell/Editor —
// no per-type branching here (§1 rule 6).
export function BoardTable({ boardId, workspaceId, viewId }: { boardId: string; workspaceId: string; viewId?: string }) {
  const utils = trpc.useUtils();
  const boardQuery = trpc.board.get.useQuery({ boardId });
  // The loaded view's config (or default) is only the *base* — draftConfig
  // is what the filter/sort builder is actually editing and what every
  // group's item.list call queries against. Reset whenever the loaded view
  // changes, using React's "adjust state during render" pattern (comparing
  // against a mirrored previous value) rather than an effect — setState
  // synchronously inside a useEffect body causes an extra cascading render
  // the compiler flags; this variant bails out and re-renders once, before
  // commit, with no extra round trip. baseViewConfig is referentially
  // stable across re-renders that don't refetch (react-query / the
  // module-level defaultViewConfig constant), so this only fires on a real
  // view switch.
  const baseViewConfig = useActiveViewConfig(boardId, viewId);
  const [draftConfig, setDraftConfig] = useState<ViewConfig>(baseViewConfig);
  const [prevBaseViewConfig, setPrevBaseViewConfig] = useState(baseViewConfig);
  if (baseViewConfig !== prevBaseViewConfig) {
    setPrevBaseViewConfig(baseViewConfig);
    setDraftConfig(baseViewConfig);
  }
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
  const kanbanGroupByColumn = columns.find((c) => c.id === draftConfig.groupBy);
  const calendarDateColumn = columns.find((c) => c.id === draftConfig.dateColumnId);

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
    <div style={{ width: "100%" }}>
      <ViewsPanel workspaceId={workspaceId} boardId={boardId} viewId={viewId} draftConfig={draftConfig} />
      <FilterSortBuilder
        key={viewId ?? "default"}
        columns={columns}
        initialConfig={baseViewConfig}
        onChange={(delta) => setDraftConfig((prev) => ({ ...prev, ...delta }))}
      />
      <div style={{ margin: "0.5rem 0" }}>
        <label>
          View:{" "}
          <select
            value={draftConfig.type}
            onChange={(e) => setDraftConfig((prev) => ({ ...prev, type: e.target.value as ViewConfig["type"] }))}
          >
            <option value="table">Table</option>
            <option value="kanban">Kanban</option>
            <option value="calendar">Calendar</option>
          </select>
        </label>
        {draftConfig.type === "kanban" && (
          <label style={{ marginLeft: "1rem" }}>
            Group by:{" "}
            <select
              value={draftConfig.groupBy ?? ""}
              onChange={(e) => setDraftConfig((prev) => ({ ...prev, groupBy: e.target.value || null }))}
            >
              <option value="">— choose a column —</option>
              {columns.filter((c) => isKanbanGroupable(getColumnType(columnTypeRegistry, c.key).shadowField)).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {draftConfig.type === "calendar" && (
          <label style={{ marginLeft: "1rem" }}>
            Date column:{" "}
            <select
              value={draftConfig.dateColumnId ?? ""}
              onChange={(e) => setDraftConfig((prev) => ({ ...prev, dateColumnId: e.target.value || null }))}
            >
              <option value="">— choose a column —</option>
              {columns
                .filter((c) => getColumnType(columnTypeRegistry, c.key).shadowField === "valueDate")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
      {mutationError && <p style={{ color: "crimson" }}>{mutationError}</p>}
      {draftConfig.type === "kanban" ? (
        kanbanGroupByColumn ? (
          <KanbanBoard
            boardId={boardId}
            groups={groups}
            groupByColumn={kanbanGroupByColumn}
            viewConfig={draftConfig}
            setMutationError={setMutationError}
          />
        ) : (
          <p>Choose a column to group by.</p>
        )
      ) : draftConfig.type === "calendar" ? (
        calendarDateColumn ? (
          <CalendarBoard boardId={boardId} dateColumn={calendarDateColumn} viewConfig={draftConfig} />
        ) : (
          <p>Choose a date column.</p>
        )
      ) : (
        <div role="table" style={{ width: "100%" }}>
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
                    viewConfig={draftConfig}
                    editingCell={editingCell}
                    setEditingCell={setEditingCell}
                    setMutationError={setMutationError}
                  />
                </Fragment>
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  );
}
