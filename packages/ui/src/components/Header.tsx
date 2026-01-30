interface HeaderProps {
  showCompleted: boolean;
  onToggleCompleted: () => void;
}

export function Header({ showCompleted, onToggleCompleted }: HeaderProps) {
  return (
    <header className="border-b bg-card">
      <div className="px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">Task Tracker</h1>
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={onToggleCompleted}
            className="rounded border-border"
          />
          Show completed
        </label>
      </div>
    </header>
  );
}
