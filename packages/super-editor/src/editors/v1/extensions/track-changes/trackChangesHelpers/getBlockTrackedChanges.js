/**
 * Walk the doc collecting block-level tracked changes — PM nodes whose
 * `trackChange` attribute is set. Mirror of `getTrackChanges` (mark-based).
 *
 * Returned entries: `{ id, kind, operationId?, nodeType, from, to, node }`.
 *
 * @param {{ doc: import('prosemirror-model').Node } | import('prosemirror-state').EditorState | null | undefined} stateOrDoc
 * @returns {Array<{
 *   id: string,
 *   kind: 'insert' | 'delete',
 *   operationId?: string,
 *   nodeType: string,
 *   from: number,
 *   to: number,
 *   node: import('prosemirror-model').Node,
 * }>}
 */
// Normalize the node's stored trackChange shape into the canonical `kind`
// value resolvers expect. The paragraph/block path this extension writes uses
// `{ kind: 'insert' | 'delete' }`. The OOXML-aligned table-row shape uses
// `{ type: 'rowInsert' | 'rowDelete' }`. Accept both so the resolver works
// across paragraph changes and any docs imported with the row-spec names.
const resolveKind = (tc) => {
  if (!tc || typeof tc !== 'object') return undefined;
  if (tc.kind === 'insert' || tc.kind === 'delete') return tc.kind;
  if (tc.type === 'rowInsert') return 'insert';
  if (tc.type === 'rowDelete') return 'delete';
  return undefined;
};

export const getBlockTrackedChanges = (stateOrDoc) => {
  const doc = stateOrDoc?.doc ?? stateOrDoc;
  const out = [];
  if (!doc || typeof doc.descendants !== 'function') return out;
  doc.descendants((node, pos) => {
    const tc = node?.attrs?.trackChange;
    const kind = resolveKind(tc);
    if (tc && tc.id && kind) {
      out.push({
        id: tc.id,
        kind,
        operationId: tc.operationId,
        nodeType: node.type.name,
        from: pos,
        to: pos + node.nodeSize,
        node,
      });
    }
  });
  return out;
};
