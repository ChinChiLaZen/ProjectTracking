import { test, expect } from "@playwright/test";
import { createTestSession } from "./helpers/auth";

// Realistic Phase 1 scope: sign in -> create board -> add item (x2, so
// there's something to reorder) -> inline-edit a cell -> keyboard-reorder.
// CLAUDE.md §9's full critical-path line ("...-> switch to Kanban -> create
// an automation -> ...") describes the eventual full path once Kanban/
// automations/dashboards exist (Phases 2/4/5) — not available yet.
test("sign in, create a board, add items, inline-edit, and keyboard-reorder", async ({ page, context }) => {
  const { sessionToken, expires } = await createTestSession("owner@acme.test");

  await context.addCookies([
    {
      name: "next-auth.session-token",
      value: sessionToken,
      domain: "localhost",
      path: "/",
      expires: Math.floor(expires.getTime() / 1000),
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  await page.goto("/");
  await expect(page.getByText(/Signed in as/)).toBeVisible();

  // --- create board ---
  const boardName = `E2E Board ${Date.now()}`;
  await page.getByPlaceholder("New board name").first().fill(boardName);
  await page.getByRole("button", { name: "Create board" }).first().click();

  await page.waitForURL(/\/boards\//);
  await expect(page.getByText("Tasks")).toBeVisible(); // auto-created starter group

  // --- add items ---
  const addItemInput = page.getByPlaceholder("+ Add item").first();
  const addItemButton = page.getByRole("button", { name: "Add", exact: true }).first();

  await addItemInput.fill("First item");
  await addItemButton.click();
  await expect(page.locator('[data-testid^="item-row-"]').filter({ hasText: "First item" })).toBeVisible();

  await addItemInput.fill("Second item");
  await addItemButton.click();
  await expect(page.locator('[data-testid^="item-row-"]').filter({ hasText: "Second item" })).toBeVisible();

  // --- inline edit ---
  const firstRow = page.locator('[data-testid^="item-row-"]').filter({ hasText: "First item" });
  await firstRow.locator('[data-testid^="cell-"]').first().click();
  const editorInput = firstRow.locator("input").last();
  await editorInput.fill("Edited value");
  await editorInput.press("Enter");
  await expect(firstRow.locator('[data-testid^="cell-"]').first()).toContainText("Edited value");

  // --- keyboard reorder (dnd-kit's KeyboardSensor, built in Session 3) ---
  // Picks up "First item" (currently first) and moves it below "Second item".
  const firstHandle = firstRow.locator('[data-testid^="drag-handle-"]');
  await firstHandle.focus();
  await expect(firstHandle).toBeFocused();
  await page.keyboard.press("Space"); // pick up
  await page.waitForTimeout(200);
  await page.keyboard.press("ArrowDown"); // move down one position
  await page.waitForTimeout(200);
  await page.keyboard.press("Space"); // drop
  await page.waitForTimeout(200);

  const rows = page.locator('[data-testid^="item-row-"]');
  await expect(rows.nth(0)).toContainText("Second item");
  await expect(rows.nth(1)).toContainText("First item");
});
