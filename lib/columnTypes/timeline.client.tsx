"use client";

import { useState } from "react";
import type { CellProps, EditorProps } from "./types";
import type { TimelineValue, TimelineSettings } from "./timeline";

export function TimelineCell({ value, readOnly }: CellProps<TimelineValue, TimelineSettings>) {
  return (
    <div style={{ minHeight: "1.2em", opacity: readOnly ? 0.6 : 1, cursor: readOnly ? "default" : "text" }}>
      {value ? `${value.start} → ${value.end}` : ""}
    </div>
  );
}

export function TimelineEditor({ value, onChange, onCancel }: EditorProps<TimelineValue, TimelineSettings>) {
  const [start, setStart] = useState(value?.start ?? "");
  const [end, setEnd] = useState(value?.end ?? "");

  function commit() {
    if (start === "" || end === "") {
      onChange(null);
      return;
    }
    if (end < start) return; // leave the editor open rather than commit an invalid range
    onChange({ start, end });
  }

  return (
    <span onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      <input type="date" autoFocus value={start} onChange={(e) => setStart(e.target.value)} onBlur={commit} aria-label="Start date" />
      {" – "}
      <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} onBlur={commit} aria-label="End date" />
    </span>
  );
}
