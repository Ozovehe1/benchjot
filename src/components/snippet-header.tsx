// A code block's header row: file name and language on the left, actions
// (Run, Stop, ...) on the right. Shared by the editable block (snippet-block.tsx)
// and the read-only one (note-preview.tsx). No hooks, so it renders on the server too.

export function SnippetHeader({ filename, language, actions }: { filename?: string; language: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-h-12 min-w-0 items-center gap-3 font-mono text-xs text-muted">
        {filename && <span className="min-w-0 truncate">{filename}</span>}
        {language}
      </div>
      {actions}
    </div>
  );
}
