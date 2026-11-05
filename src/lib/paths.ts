// App routes. The URL is the navigation state: a reload or a PWA resume returns to the same note or project.
export const projectPath = (id: string) => `/p/${id}`;
export const notePath = (id: string) => `/n/${id}`;

/** Where a deleted note leaves you: its project's list when it was filed in one, else all notes. */
export function afterDeletePath(projectId: string | null | undefined): string {
  return projectId ? projectPath(projectId) : "/";
}

/** One output of a code block's saved run, on its own page. */
export const outputPagePath = (noteId: string, snippetId: string, index: number) => `${notePath(noteId)}/out/${snippetId}/${index}`;

/** The landing's example note: its outputs open here (read-only, no sign-in), and go back to the landing. */
export const sampleOutputPath = (index: number) => `/example/out/${index}`;
