/**
 * Shared ProseMirror addAttributes-compatible spec for block-level tracked
 * changes. Spread into a block node's addAttributes() to make whole-block
 * insert/delete a reviewable structural change.
 *
 * Primary target is the paragraph (whole-paragraph re-suggest / delete), so a
 * paragraph deletion is a structural change the reviewer can accept/reject
 * rather than an inline text-only delete that leaves an empty paragraph (and
 * its list bullet) behind. The same spec applies unchanged to other block
 * units (TableRow, TableCell, Image, PageBreak) when we extend beyond
 * paragraphs.
 *
 * Value shape:
 *   { kind: 'insert' | 'delete', id: string, operationId?: string } | null
 */
export const blockTrackedChangeAttrSpec = {
  trackChange: {
    default: null,
    parseDOM: (el) => {
      const kind = el.getAttribute('data-track-change');
      if (kind !== 'insert' && kind !== 'delete') return null;
      // Without an id, the entry can never be resolved by the accept/reject
      // resolver (which matches by id) and would just sit on the node as a
      // no-op attr. getBlockTrackedChanges already filters these out; reject
      // them at parse time so the doc never holds a half-formed trackChange
      // shape (also keeps the runtime type consistent with the documented
      // `id: string`).
      const id = el.getAttribute('data-track-change-id');
      if (!id) return null;
      return {
        kind,
        id,
        operationId: el.getAttribute('data-track-change-operation') ?? undefined,
      };
    },
    renderDOM: (attrs) => {
      const tc = attrs?.trackChange;
      if (!tc) return {};
      const out = { 'data-track-change': tc.kind };
      // Emit id + operationId so HTML round-trips (clipboard, getHTML/setContent,
      // collaboration patches) preserve enough to resolve the change via
      // getBlockTrackedChanges and accept/reject it.
      if (tc.id) out['data-track-change-id'] = tc.id;
      if (tc.operationId) out['data-track-change-operation'] = tc.operationId;
      return out;
    },
  },
};
