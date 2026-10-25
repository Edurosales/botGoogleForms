/** ID estable de un Google Form (igual con link largo, corto forms.gle o de edición). */
export function formIdOf(viewUrl: string): string | null {
  const m = viewUrl.match(/\/forms\/d\/(?:e\/)?([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : null;
}
