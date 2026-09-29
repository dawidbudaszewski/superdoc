import { getBlockTrackedChanges } from './getBlockTrackedChanges.js';

/**
 * Apply accept or reject to one or more block-level tracked changes by id.
 * Block changes live on a node's `trackChange` attribute (paragraphs today;
 * table rows reuse the same path), as opposed to inline mark-based changes.
 *
 * Resolution rules (Google-Docs-like):
 *   insert + accept → strip attr (node stays in the doc)
 *   insert + reject → delete the node
 *   delete + accept → delete the node
 *   delete + reject → strip attr (node stays in the doc)
 *
 * Edge case: if deleting a node leaves a table with zero rows, the parent
 * table is removed too (PM's `tableRow+` content schema would reject an empty
 * table). A top-level block (e.g. a paragraph) resolves at depth 0 where
 * `$pos.before(0)` throws, so the parent is only consulted for nested nodes.
 *
 * Steps are appended to the provided transaction in descending position order
 * so deletions don't invalidate earlier positions in the same batch.
 *
 * @param {{
 *   tr: import('prosemirror-state').Transaction,
 *   state: import('prosemirror-state').EditorState,
 *   ids: string[],
 *   decision: 'accept' | 'reject',
 * }} args
 * @returns {{ applied: number, notFound: string[] }}
 */
export const applyBlockTrackedChangeResolution = ({ tr, state, ids, decision }) => {
  const all = getBlockTrackedChanges(state);
  const wanted = new Set(ids);
  const entries = all.filter((e) => wanted.has(e.id));
  const foundIds = new Set(entries.map((e) => e.id));
  const notFound = ids.filter((id) => !foundIds.has(id));
  if (!entries.length) return { applied: 0, notFound };

  // Descending position order so earlier deletions don't invalidate later
  // positions within this single transaction.
  const sorted = [...entries].sort((a, b) => b.from - a.from);

  let applied = 0;
  for (const entry of sorted) {
    const stripAttr =
      (entry.kind === 'insert' && decision === 'accept') || (entry.kind === 'delete' && decision === 'reject');

    const livePos = tr.mapping.map(entry.from);
    const liveNode = tr.doc.nodeAt(livePos);
    if (!liveNode || liveNode.type.name !== entry.nodeType) continue;

    if (stripAttr) {
      tr.setNodeMarkup(livePos, null, { ...liveNode.attrs, trackChange: null });
      applied += 1;
      continue;
    }

    // Delete the node. For a nested node (e.g. a table row), if it's the only
    // child of its parent table, delete the table too. A top-level block
    // resolves at depth 0 — only consult the parent when the node is nested.
    const $pos = tr.doc.resolve(livePos);
    const depth = $pos.depth;
    const parent = depth > 0 ? $pos.node(depth) : null;
    const isLastRowInTable = parent?.type.name === 'table' && parent.childCount === 1;

    if (isLastRowInTable) {
      const parentPos = $pos.before(depth);
      tr.delete(parentPos, parentPos + parent.nodeSize);
    } else {
      tr.delete(livePos, livePos + liveNode.nodeSize);
    }
    applied += 1;
  }

  return { applied, notFound };
};
