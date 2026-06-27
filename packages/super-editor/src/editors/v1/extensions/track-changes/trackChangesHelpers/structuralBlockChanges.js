// @ts-check
/**
 * Structural tracked-change enumerator for whole-PARAGRAPH insert/delete.
 *
 * This is the paragraph-domain sibling of {@link enumerateStructuralRowChanges}
 * (which owns whole-table row revisions). A whole-paragraph suggestion — the
 * Google-Docs-style "re-suggest the entire paragraph" produced by the
 * paragraph/block diff — is encoded on the paragraph node's `trackChange`
 * attribute (`{ kind: 'insert' | 'delete', id, operationId? }`), NOT as inline
 * marks. The inline-mark enumerators (`getTrackChanges`) therefore never see
 * them, exactly like table rows.
 *
 * This module walks the block-level tracked changes (via
 * {@link getBlockTrackedChanges}) and emits decidable structural changes for
 * tracked paragraph blocks. Table rows are deliberately excluded here — they are
 * owned by `structuralRowChanges` and grouped at the table level — so the two
 * enumerators never double-count the same node.
 *
 * Grouping by `operationId` (Google-Docs "change in/out"): a changed paragraph
 * is applied as a delete of the old block + insert of the new block. When a
 * producer stamps BOTH halves with the same `operationId` (see
 * `applyHunks`/`computeStructuralDiff` `pairReplacements`), this enumerator
 * collapses them into ONE `paragraph-replace` entry — one bubble, one
 * accept/reject that resolves both nodes atomically via
 * `acceptTrackedChangeOperation`. Unpaired blocks (a pure insert or pure delete,
 * or halves without a shared `operationId`) still emit one entry each.
 *
 * The emitted shape mirrors {@link enumerateStructuralRowChanges} closely so the
 * document-api `groupTrackedChanges` append, the tracked-change index, and the
 * comments-store bubble path can treat both domains uniformly:
 *   - `id`          stable public id. For a replace it is the shared
 *                   `operationId`; for a singleton it is the node's tc id.
 *   - `commandRawId` id the v1 `acceptTrackedChangeById`/`rejectTrackedChangeById`
 *                   command resolves against. For a replace it is the
 *                   `operationId` (routes to the atomic operation accept/reject);
 *                   for a singleton it is the node's `getBlockTrackedChanges().id`.
 *   - `side`        `'insertion' | 'deletion'` (a replace reports `'insertion'`).
 *   - `subtype`     `'paragraph-insert' | 'paragraph-delete' | 'paragraph-replace'`.
 *   - `from`/`to`   the paragraph node PM range (for positioning + excerpt); a
 *                   replace spans both halves.
 *   - `excerpt`     the inserted (new) text, when known.
 *   - `deletedExcerpt` the deleted (old) text, set only for a replace.
 *   - `decidable`   always true — a whole-paragraph block change is one logical,
 *                   actionable suggestion.
 */

import { getBlockTrackedChanges } from './getBlockTrackedChanges.js';

const stringOf = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));

/**
 * @typedef {Object} StructuralBlockChange
 * @property {string} id
 * @property {string} commandRawId
 * @property {string} revisionId
 * @property {'insertion'|'deletion'} side
 * @property {'paragraph-insert'|'paragraph-delete'|'paragraph-replace'} subtype
 * @property {number} from
 * @property {number} to
 * @property {number} blockPos
 * @property {boolean} wholeBlock
 * @property {boolean} decidable
 * @property {string} [operationId]
 * @property {string} [excerpt]
 * @property {string} [deletedExcerpt]
 * @property {string} author
 * @property {string} authorEmail
 * @property {string} authorImage
 * @property {string} date
 * @property {string} importedAuthor
 * @property {string} sourceId
 */

const textOf = (node) => (node && typeof node.textContent === 'string' ? node.textContent : '');

/**
 * Enumerate structural paragraph block changes (whole-paragraph insert/delete).
 *
 * Tolerates a missing/partial state and returns `[]` instead of throwing, to
 * match the inline + row enumerators' bootstrap-safety contract.
 *
 * @param {import('prosemirror-state').EditorState | { doc?: import('prosemirror-model').Node } | null | undefined} state
 * @returns {Array<StructuralBlockChange>}
 */
export const enumerateStructuralBlockChanges = (state) => {
  /** @type {Array<StructuralBlockChange>} */
  const out = [];

  let entries = [];
  try {
    entries = getBlockTrackedChanges(state);
  } catch {
    return out;
  }

  // Table rows are owned by `enumerateStructuralRowChanges` (grouped at the
  // table level). Only paragraph-domain blocks participate here.
  const paragraphEntries = entries.filter((entry) => entry.nodeType === 'paragraph');

  // Group by operationId so the two halves of a replace collapse into one
  // entry. Key by the node's own id when no operationId is present so unrelated
  // singletons are never accidentally merged.
  /** @type {Map<string, Array<typeof paragraphEntries[number]>>} */
  const groups = new Map();
  const order = [];
  for (const entry of paragraphEntries) {
    const key = stringOf(entry.operationId) || stringOf(entry.id) || `block:${entry.from}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key).push(entry);
  }

  for (const key of order) {
    const group = groups.get(key);
    const inserts = group.filter((e) => e.kind === 'insert');
    const deletes = group.filter((e) => e.kind === 'delete');
    const operationId = stringOf(group[0].operationId);

    // A replace: this operation deletes the old block AND inserts the new one.
    // Collapse into ONE decidable entry whose accept/reject resolves both nodes
    // atomically (commandRawId === operationId → acceptTrackedChangeOperation).
    if (inserts.length > 0 && deletes.length > 0 && operationId) {
      const insert = inserts[0];
      const del = deletes[0];
      const tc = insert.node?.attrs?.trackChange ?? del.node?.attrs?.trackChange ?? {};
      const from = Math.min(...group.map((e) => e.from));
      const to = Math.max(...group.map((e) => e.to));
      out.push({
        id: operationId,
        commandRawId: operationId,
        revisionId: operationId,
        side: 'insertion',
        subtype: 'paragraph-replace',
        from,
        to,
        blockPos: insert.from,
        wholeBlock: true,
        decidable: true,
        operationId,
        excerpt: textOf(insert.node),
        deletedExcerpt: textOf(del.node),
        author: stringOf(tc.author),
        authorEmail: stringOf(tc.authorEmail),
        authorImage: stringOf(tc.authorImage),
        date: stringOf(tc.date),
        importedAuthor: stringOf(tc.importedAuthor),
        sourceId: stringOf(tc.sourceId),
      });
      continue;
    }

    // Otherwise emit each block on its own (pure insert / pure delete, or halves
    // without a shared operationId), preserving the per-block bubble behavior.
    for (const entry of group) {
      const tc = entry.node?.attrs?.trackChange ?? {};
      const side = entry.kind === 'insert' ? 'insertion' : 'deletion';
      const publicId = stringOf(entry.id) || `block:${entry.from}:${side}`;
      out.push({
        id: publicId,
        // The v1 accept/reject command resolves a paragraph block by its
        // tracked-change id (`getBlockTrackedChanges().id`). Keep it distinct
        // from the (currently identical) public id so the contract is explicit
        // and a future public-id rewrite cannot silently break command routing.
        commandRawId: stringOf(entry.id),
        revisionId: stringOf(entry.id),
        side,
        subtype: side === 'insertion' ? 'paragraph-insert' : 'paragraph-delete',
        from: entry.from,
        to: entry.to,
        blockPos: entry.from,
        wholeBlock: true,
        decidable: true,
        operationId: stringOf(entry.operationId),
        excerpt: textOf(entry.node),
        author: stringOf(tc.author),
        authorEmail: stringOf(tc.authorEmail),
        authorImage: stringOf(tc.authorImage),
        date: stringOf(tc.date),
        importedAuthor: stringOf(tc.importedAuthor),
        sourceId: stringOf(tc.sourceId),
      });
    }
  }

  return out;
};
