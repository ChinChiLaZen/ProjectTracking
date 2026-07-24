"use client";

import type { BoardMember } from "@/server/services/boardMembers";

// Presentational only — UpdatesPanel owns query-detection, filtering, and
// keyboard-nav state, matching how that file already owns its own
// interaction state rather than delegating it into child components.
// Positioned with a simple fixed offset near the textarea, not real
// pixel-perfect caret tracking — an accepted MVP simplification (Session 14),
// same discipline as Kanban's append-only drop and Calendar's read-only view.
export function MentionAutocomplete({
  members,
  activeIndex,
  onSelect,
}: {
  members: BoardMember[];
  activeIndex: number;
  onSelect: (member: BoardMember) => void;
}) {
  if (members.length === 0) {
    return (
      <div style={{ border: "1px solid #ccc", borderRadius: 4, background: "#fff", padding: "0.4rem", fontSize: "0.85rem", color: "#888" }}>
        No matching members
      </div>
    );
  }

  return (
    <ul
      role="listbox"
      aria-label="Mention suggestions"
      style={{
        listStyle: "none",
        margin: 0,
        padding: "0.25rem 0",
        border: "1px solid #ccc",
        borderRadius: 4,
        background: "#fff",
        maxHeight: "10rem",
        overflowY: "auto",
        boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
      }}
    >
      {members.map((member, index) => (
        <li
          key={member.userId}
          role="option"
          aria-selected={index === activeIndex}
          data-testid={`mention-option-${member.userId}`}
          onMouseDown={(e) => {
            e.preventDefault(); // keep the textarea focused, don't blur before onSelect runs
            onSelect(member);
          }}
          style={{
            padding: "0.3rem 0.6rem",
            cursor: "pointer",
            background: index === activeIndex ? "#e0edff" : "transparent",
          }}
        >
          <strong>{member.name ?? member.email}</strong>
          {member.name && <span style={{ color: "#888", marginLeft: "0.4rem" }}>{member.email}</span>}
        </li>
      ))}
    </ul>
  );
}
