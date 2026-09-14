import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FileTree from "./FileTree";
import type { Entry } from "./types";
afterEach(cleanup);
const entry = (path: string, directory: boolean, size = 0): Entry => ({
  path,
  directory,
  size,
  modifiedMs: 0,
  repository: false,
  agentConfig: false,
});
const entries = [
  entry("src", true),
  entry("src/nested", true),
  entry("src/a.txt", false, 10),
  entry("src/nested/b.txt", false, 20),
  entry("readme.txt", false, 5),
];
it("expands folders and reports descendant file totals without counting folders as files", async () => {
  let opened = "";
  render(
    <FileTree entries={entries} query="" onOpen={(path) => (opened = path)} />,
  );
  expect(screen.queryByRole("button", { name: /src\/a.txt/ })).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: /src.*2 files.*30 B/ }),
  );
  await userEvent.click(screen.getByRole("button", { name: /src\/a.txt/ }));
  expect(opened).toBe("src/a.txt");
  await userEvent.click(
    screen.getByRole("button", { name: /src.*2 files.*30 B/ }),
  );
  expect(screen.queryByRole("button", { name: /src\/a.txt/ })).toBeNull();
});
it("finds nested files without requiring folder expansion", async () => {
  render(<FileTree entries={entries} query="b.txt" onOpen={() => {}} />);
  expect(
    screen.getByRole("button", { name: /src\/nested\/b.txt/ }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: /readme/ })).toBeNull();
});
it("keeps every entry reachable beyond the first page", async () => {
  const many = Array.from({ length: 201 }, (_, i) =>
    entry(`file-${String(i).padStart(3, "0")}.txt`, false),
  );
  render(<FileTree entries={many} query="" onOpen={() => {}} />);
  expect(screen.queryByRole("button", { name: /file-200.txt/ })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: /Show more/ }));
  expect(screen.getByRole("button", { name: /file-200.txt/ })).toBeTruthy();
});

it("shows a machine-readable modified date and marks the selected file", async () => {
  const modifiedMs = Date.UTC(2026, 8, 11, 10, 20);
  render(<FileTree entries={[{ ...entry('readme.txt', false, 5), modifiedMs }, entry('unknown.txt', false)]} query="" onOpen={() => {}} />);
  const date = document.querySelector('time');
  expect(date?.getAttribute('datetime')).toBe('2026-09-11T10:20:00.000Z');
  expect(date?.textContent).toBeTruthy();
  const file = screen.getByRole('button', { name: /^readme.txt,/ });
  await userEvent.click(file);
  expect(file.getAttribute('aria-current')).toBe('true');
  await userEvent.click(screen.getByRole('button', { name: /^unknown.txt,/ }));
  expect(file.hasAttribute('aria-current')).toBe(false);
  expect(screen.getByText('Modified date unavailable')).toBeTruthy();
});

it("handles out-of-range timestamps without crashing the file list", () => {
  render(<FileTree entries={[{ ...entry('invalid-date.txt', false), modifiedMs: Number.MAX_VALUE }]} query="" onOpen={() => {}} />);
  expect(document.querySelector('time')).toBeNull();
  expect(screen.getByText('Modified date unavailable')).toBeTruthy();
});
