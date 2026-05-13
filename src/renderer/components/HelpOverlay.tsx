import { useEffect, useRef } from "react";
import { X } from "lucide-react";

type Shortcut = { keys: string[]; label: string };
type Group = { title: string; shortcuts: Shortcut[] };

const GROUPS: Group[] = [
  {
    title: "Global",
    shortcuts: [
      { keys: ["⌘", "K"], label: "Focus search" },
      { keys: ["⌘", "L"], label: "Focus path list" },
      { keys: ["⌘", "F"], label: "Focus sources" },
      { keys: ["⌘", "D"], label: "Cycle date scope" },
      { keys: ["⌘", "R"], label: "Refresh all sources" },
      { keys: ["⌘", "1–4"], label: "Toggle Codex / Claude / Amp / Pi" },
      { keys: ["⌘", "."], label: "Toggle warnings-only" },
      { keys: ["⌘", ","], label: "Open settings" },
      { keys: ["?"], label: "Open this help" },
      { keys: ["Esc"], label: "Clear query → clear path → hide window" }
    ]
  },
  {
    title: "Results",
    shortcuts: [
      { keys: ["↑", "↓"], label: "Move selection" },
      { keys: ["PgUp", "PgDn"], label: "Jump 10" },
      { keys: ["Home", "End"], label: "First / last" },
      { keys: ["Enter"], label: "Copy resume command + hide window" },
      { keys: ["⌘", "C"], label: "Copy without hiding" },
      { keys: ["⌘", "⇧", "C"], label: "Copy session path" }
    ]
  },
  {
    title: "Rail",
    shortcuts: [
      { keys: ["↑", "↓"], label: "Move within a group" },
      { keys: ["←", "→"], label: "Move date scope" },
      { keys: ["Space", "Enter"], label: "Toggle / activate" },
      { keys: ["P"], label: "Pin / unpin focused path" },
      { keys: ["Tab"], label: "Leave rail" }
    ]
  }
];

export function HelpOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" || event.key === "?") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previousFocus.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="help-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "?") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="help-overlay__sheet" onClick={(event) => event.stopPropagation()}>
        <header className="help-overlay__header">
          <h2>Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            className="icon-button"
            onClick={onClose}
            aria-label="Close help"
          >
            <X size={13} />
          </button>
        </header>
        <div className="help-overlay__body">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3>{group.title}</h3>
              <dl>
                {group.shortcuts.map((shortcut) => (
                  <div key={shortcut.label}>
                    <dt>
                      {shortcut.keys.map((key, index) => (
                        <kbd key={`${shortcut.label}-${index}`}>{key}</kbd>
                      ))}
                    </dt>
                    <dd>{shortcut.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
