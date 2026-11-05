// The card's own name, as the editor shows it in its tab, its business-card back and its backup file
// name: the first `title:` line. Read-only; `setTitle` (card-core.js) is the one that writes it.
export const cardTitle = (md) => /^title:\s*(.*)$/m.exec(String(md || ''))?.[1]?.trim() || '';
