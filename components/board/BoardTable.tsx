"use client";

import { Fragment, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { getColumnType } from "@/lib/columnTypes/types";
import { columnTypeRegistry } from "@/lib/columnTypes/registry";

function cellKey(itemId: string, columnId: string) {
  return `${itemId}:${columnId}`;
}

// Minimal Table view (Session 2). Every column cell is dispatched through
// the registry's Cell/Editor — no per-type branching here (§1 rule 6).
// Virtualization/pagination is Session 4; this is unpaginated on purpose.
export function BoardTable({ boardId }: { boardId: string }) {
  const utils = trpc.useUtils();
  const boardQuery = trpc.board.get.useQuery({ boardId });
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

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
      if (context?.previous) {
        utils.board.get.setData({ boardId }, context.previous);
      }
      setMutationError(
        err.data?.code === "CONFLICT" ? "Someone else edited this cell — refreshed." : err.message,
      );
    },
    onSettled: () => {
      utils.board.get.invalidate({ boardId });
    },
  });

  if (boardQuery.isLoading) return <p>Loading…</p>;
  if (!boardQuery.data) return <p>Board not found.</p>;

  const { groups, items, columns, values } = boardQuery.data;
  const valueFor = (itemId: string, columnId: string) =>
    values.find((v) => v.itemId === itemId && v.columnId === columnId);

  return (
    <>
      {mutationError && <p style={{ color: "crimson" }}>{mutationError}</p>}
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>#</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Name</th>
            {columns.map((column) => (
              <th key={column.id} style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.id}>
              <tr>
                <td colSpan={2 + columns.length} style={{ fontWeight: 600, paddingTop: "0.75rem" }}>
                  {group.name}
                </td>
              </tr>
              {items
                .filter((item) => item.groupId === group.id)
                .map((item) => (
                  <tr key={item.id}>
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
                            if (!isReadOnly && !isEditing) setEditingCell(key);
                          }}
                        >
                          {isEditing ? (
                            <columnType.Editor
                              value={value}
                              settings={column.settings}
                              onChange={(nextValue) => {
                                setEditingCell(null);
                                setColumnValue.mutate({
                                  boardId,
                                  itemId: item.id,
                                  columnId: column.id,
                                  value: nextValue,
                                  expectedVersion: existing?.version ?? 0,
                                });
                              }}
                              onCancel={() => setEditingCell(null)}
                            />
                          ) : (
                            <columnType.Cell value={value} settings={column.settings} readOnly={isReadOnly} />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </>
  );
}
