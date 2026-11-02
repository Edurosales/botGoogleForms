/**
 * Link de Google Sheets → URL de exportación CSV. Solo hojas de Google: la URL
 * final la arma el servidor con el ID validado (nunca se pide una URL ajena).
 */
export function sheetCsvUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "docs.google.com") return null;
  const gidRaw = u.searchParams.get("gid") ?? new URLSearchParams(u.hash.replace(/^#/, "")).get("gid") ?? "0";
  const gid = /^\d{1,12}$/.test(gidRaw) ? gidRaw : "0";
  const pub = u.pathname.match(/^\/spreadsheets\/d\/e\/([A-Za-z0-9_-]{20,200})\//);
  if (pub) return `https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub?output=csv&gid=${gid}`;
  const id = u.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,200})/);
  if (id) return `https://docs.google.com/spreadsheets/d/${id[1]}/export?format=csv&gid=${gid}`;
  return null;
}
