import type { Entry } from "./types";
import type { changeStyle } from './repositoryPresentation';
import { useEffect, useId, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderGit2,
} from "lucide-react";

export default function FileTree({
  entries,
  query,
  onOpen,
  statuses,
}: {
  entries: Entry[];
  query: string;
  onOpen: (path: string) => void;
  statuses?: Map<string, ReturnType<typeof changeStyle>>;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const metadataId = useId();
  const [limit, setLimit] = useState(200);
  useEffect(() => setLimit(200), [query]);
  const { children, totals } = useMemo(() => {
    const children = new Map<string, Entry[]>();
    const totals = new Map<string, { count: number; size: number }>();
    const directories = new Set(
      entries.filter((e) => e.directory).map((e) => e.path),
    );
    for (const entry of entries) {
      if (entry.path === ".") continue;
      const parts = entry.path.split("/");
      const parent = parts.slice(0, -1).join("/");
      const key = directories.has(parent) ? parent : "";
      const siblings = children.get(key) ?? [];
      siblings.push(entry);
      children.set(key, siblings);
      if (!entry.directory) {
        for (let i = 1; i < parts.length; i++) {
          const path = parts.slice(0, i).join("/");
          const total = totals.get(path) ?? { count: 0, size: 0 };
          total.count++;
          total.size += entry.size;
          totals.set(path, total);
        }
      }
    }
    for (const siblings of children.values())
      siblings.sort(
        (a, b) =>
          Number(b.directory) - Number(a.directory) ||
          a.path.localeCompare(b.path),
      );
    return { children, totals };
  }, [entries]);
  const visible: { entry: Entry; depth: number }[] = [];
  if (normalizedQuery) {
    for (const entry of entries)
      if (entry.path.toLowerCase().includes(normalizedQuery))
        visible.push({ entry, depth: 0 });
    visible.sort((a, b) => a.entry.path.localeCompare(b.entry.path));
  } else {
    const stack = [...(children.get("") ?? [])]
      .reverse()
      .map((entry) => ({ entry, depth: 0 }));
    while (stack.length) {
      const item = stack.pop()!;
      visible.push(item);
      if (expanded.has(item.entry.path))
        for (const entry of [
          ...(children.get(item.entry.path) ?? []),
        ].reverse())
          stack.push({ entry, depth: item.depth + 1 });
    }
  }
  return (
    <div aria-label="Workspace files">
      {visible.slice(0, limit).map(({ entry, depth }) => {
        const total = totals.get(entry.path) ?? { count: 0, size: 0 };
        const detail = entry.directory
          ? `${total.count} files; ${total.size.toLocaleString()} B scanned`
          : `${entry.size.toLocaleString()} B`;
        const open = expanded.has(entry.path);
        const date = new Date(entry.modifiedMs);
        const hasDate = entry.modifiedMs > 0 && Number.isFinite(date.getTime());
        const descriptionId = `${metadataId}-${encodeURIComponent(entry.path)}`;
        return (
          <button
            className={`file-row ${statuses?.get(entry.path)?.tone ?? ''}${selected === entry.path ? " selected" : ""}`}
            key={entry.path}
            aria-label={`${entry.path}, ${detail}${statuses?.get(entry.path) ? `, ${statuses.get(entry.path)!.label}` : ''}`}
            aria-current={!entry.directory && selected === entry.path ? true : undefined}
            aria-describedby={descriptionId}
            aria-expanded={entry.directory ? open : undefined}
            title={
              hasDate
                ? `Modified ${date.toLocaleString()}`
                : entry.path
            }
            style={{ paddingLeft: 12 + Math.min(depth, 10) * 12 }}
            onClick={() => {
              if (entry.directory) {
                setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(entry.path)) next.delete(entry.path);
                    else next.add(entry.path);
                    return next;
                });
              } else {
                setSelected(entry.path);
                onOpen(entry.path);
              }
            }}
          >
            <span>
              {entry.directory ? (
                <>
                  {open ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                  {entry.repository ? (
                    <FolderGit2 size={16} />
                  ) : (
                    <Folder size={16} />
                  )}
                </>
              ) : (
                <FileText size={16} />
              )}
              {normalizedQuery ? entry.path : entry.path.split("/").at(-1)}
            </span>
            <small className="file-metadata">
              {statuses?.get(entry.path) && <span className={`file-status ${statuses.get(entry.path)!.tone}`}>{statuses.get(entry.path)!.label}</span>}
              <span>{entry.directory ? <><strong className="file-count">{total.count}</strong> files; {total.size.toLocaleString()} B scanned</> : detail}</span>
              {hasDate ? <time id={descriptionId} dateTime={date.toISOString()} aria-label={`Modified ${date.toLocaleString()}`}>
                {date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
              </time> : <span id={descriptionId}>Modified date unavailable</span>}
            </small>
          </button>
        );
      })}
      {visible.length > limit && (
        <button onClick={() => setLimit((n) => n + 200)}>
          Show more ({visible.length - limit})
        </button>
      )}
    </div>
  );
}
