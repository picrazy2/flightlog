import { Popover } from "@/components/ui/Popover";
import { useStore } from "@/state/store";
import { useUsers } from "@/data/useUsers";
import { cn } from "@/lib/cn";

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

// Header account switcher: shows the current user's name and lets you switch
// between logs (changes the URL to /<id>).
export function UserMenu() {
  const userId = useStore((s) => s.userId);
  const setUserId = useStore((s) => s.setUserId);
  const { data: users = [] } = useUsers();
  const current = users.find((u) => u.id === userId);
  const name = current?.name ?? userId;

  return (
    <Popover
      align="end"
      trigger={({ toggle, open }) => (
        <button
          onClick={toggle}
          className={cn(
            "focus-ring inline-flex h-[34px] items-center gap-2 rounded-full border border-border bg-surface-2 py-0.5 pl-1 pr-3 text-label text-ink hover:bg-surface-3",
            open && "border-border-strong",
          )}
        >
          <span className="grid h-[24px] w-[24px] place-items-center rounded-full bg-accent text-caption font-semibold text-[var(--accent-ink)]">
            {initialsOf(name)}
          </span>
          <span className="font-medium">{name}</span>
          <span className="text-ink-faint">▾</span>
        </button>
      )}
    >
      {(close) => (
        <div className="w-[190px]">
          <div className="px-2.5 pb-1 pt-0.5 text-eyebrow tracking-[0.01em] text-ink-faint">Switch log</div>
          {users.map((u) => (
            <button
              key={u.id}
              onClick={() => {
                setUserId(u.id);
                close();
              }}
              className={cn(
                "focus-ring flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-label hover:bg-surface-2",
                u.id === userId ? "text-accent" : "text-ink",
              )}
            >
              <span className="grid h-[20px] w-[20px] place-items-center rounded-full bg-surface-3 text-[10px] font-semibold text-ink-muted">
                {initialsOf(u.name)}
              </span>
              <span className="min-w-0 flex-1 truncate">{u.name}</span>
              {u.id === userId && <span className="text-accent">✓</span>}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
