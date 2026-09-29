// @ts-check
/**
 * Compute structural hunks describing whole-block add/removes between two docs.
 *
 * Walks both docs at depth 1, matches blocks by `identityKey` (default: a
 * content fingerprint built from the block's normalized `textContent` and
 * node type). For each base block absent from proposal: emit
 * `{ kind: 'remove' }`. For each proposal block (of allowed type) absent from
 * base: emit `{ kind: 'insert' }`.
 *
 * Why content fingerprint instead of sdBlockId: the docx importer assigns a
 * fresh sdBlockId on every load — there's no standard OOXML attribute for
 * tables to persist a stable id. So two independently-loaded copies of the
 * same document have different ids; matching by id would flag every block
 * as changed. Content fingerprinting matches identical blocks across
 * imports.
 *
 * Limitations of the default fingerprint:
 * - Two truly-identical blocks (e.g. empty placeholder paragraphs) share a
 *   fingerprint; the algorithm treats them as one. Pass a custom
 *   `identityKey` if your domain has identical blocks that must be
 *   distinguished.
 * - A block whose content changed (same structure, different text) is
 *   treated as a remove of the old + insert of the new — visually rendered
 *   as "old red + new green." Consumers wanting "modified in-place"
 *   semantics should pass a structural fingerprint.
 *
 * Consumers whose proposal is a true in-place edit (sdBlockIds preserved
 * across base/proposal) can opt back into id-based matching:
 *   computeStructuralDiff(base, proposal, {
 *     identityKey: (n) => n.attrs?.sdBlockId ?? null,
 *   })
 *
 * Replace pairing (`pairReplacements`): by default a changed block is emitted
 * as an independent remove(old) + insert(new) with DIFFERENT `changeId`s, so
 * each surfaces as its own review bubble. Pass `pairReplacements: true` to
 * ordinally pair each remove with the insert at the same position and stamp
 * BOTH with a shared `operationId`. Downstream that collapses the pair into a
 * single "Replaced X with Y" bubble that accepts/rejects as ONE action (the
 * Google-Docs "change in/out" UX). Ordinal pairing is a heuristic — accurate
 * for in-place edits (where base order and proposal order align) and a no-op
 * for pure inserts / pure deletes; a delete-here + unrelated-insert-there would
 * be mis-paired, so callers with richer alignment should set `operationId`
 * themselves and leave this off.
 *
 * @param {import('prosemirror-model').Node} baseDoc
 * @param {import('prosemirror-model').Node} proposalDoc
 * @param {{ blockTypes?: readonly string[], identityKey?: (n: any) => string | null, pairReplacements?: boolean }} [opts]
 * @returns {Array<{
 *   kind: 'remove' | 'insert',
 *   changeId: string,
 *   operationId?: string,
 *   basePos?: number,
 *   baseNodeSize?: number,
 *   proposalNode?: import('prosemirror-model').Node,
 *   anchorBasePos?: number,
 * }>}
 */
const DEFAULT_BLOCK_TYPES = Object.freeze(['table']);
const defaultIdentityKey = (node) => {
  if (!node) return null;
  const typeName = node.type?.name ?? 'node';
  const text = typeof node.textContent === 'string' ? node.textContent : '';
  return `${typeName}:${text.replace(/\s+/g, ' ').trim()}`;
};

export const computeStructuralDiff = (baseDoc, proposalDoc, opts = {}) => {
  const blockTypes = opts.blockTypes ?? DEFAULT_BLOCK_TYPES;
  const identityKey = opts.identityKey ?? defaultIdentityKey;
  const blockTypeSet = new Set(blockTypes);

  const collectTopLevel = (doc) => {
    const entries = [];
    doc.forEach((node, offset) => {
      const id = identityKey(node);
      if (id != null) entries.push({ id, node, pos: offset, end: offset + node.nodeSize });
    });
    return entries;
  };

  const baseEntries = collectTopLevel(baseDoc);
  const proposalEntries = collectTopLevel(proposalDoc);
  const baseById = new Map(baseEntries.map((e) => [e.id, e]));
  const proposalIds = new Set(proposalEntries.map((e) => e.id));

  const hunks = [];

  for (const entry of baseEntries) {
    if (!proposalIds.has(entry.id) && blockTypeSet.has(entry.node.type.name)) {
      hunks.push({
        kind: 'remove',
        changeId: entry.id,
        basePos: entry.pos,
        baseNodeSize: entry.node.nodeSize,
      });
    }
  }

  let lastSharedBaseEnd = null;
  for (const entry of proposalEntries) {
    const sharedInBase = baseById.get(entry.id);
    if (sharedInBase) {
      lastSharedBaseEnd = sharedInBase.end;
      continue;
    }
    if (!blockTypeSet.has(entry.node.type.name)) continue;
    hunks.push({
      kind: 'insert',
      changeId: entry.id,
      proposalNode: entry.node,
      anchorBasePos: lastSharedBaseEnd ?? 0,
    });
  }

  if (opts.pairReplacements) pairReplaceHunks(hunks);

  return hunks;
};

/**
 * Ordinally pair remove + insert hunks into shared-`operationId` replaces, and
 * re-anchor each paired insert to the END of its removed block so the new
 * (green) block lands immediately after the struck (red) one rather than
 * drifting to `lastSharedBaseEnd`. Removes stamp markup in place (no length
 * change), so anchoring to `basePos + baseNodeSize` is stable across the batch.
 * Mutates `hunks` in place. Leftover removes / inserts (no partner) are left
 * untouched and remain independent delete / insert changes.
 *
 * @param {Array<{ kind: string, changeId: string, operationId?: string, basePos?: number, baseNodeSize?: number, anchorBasePos?: number }>} hunks
 */
const pairReplaceHunks = (hunks) => {
  const removes = hunks.filter((h) => h.kind === 'remove' && typeof h.basePos === 'number');
  const inserts = hunks.filter((h) => h.kind === 'insert');
  const pairCount = Math.min(removes.length, inserts.length);
  for (let i = 0; i < pairCount; i += 1) {
    const remove = removes[i];
    const insert = inserts[i];
    const operationId = `op:${i}:${remove.changeId}`;
    remove.operationId = operationId;
    insert.operationId = operationId;
    insert.anchorBasePos = (remove.basePos ?? 0) + (remove.baseNodeSize ?? 0);
  }
};
