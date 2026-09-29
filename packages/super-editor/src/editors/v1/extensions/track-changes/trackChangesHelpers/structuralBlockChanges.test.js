import { afterEach, describe, expect, it } from 'vitest';
import { initTestEditor } from '@tests/helpers/helpers.js';
import { enumerateStructuralBlockChanges } from './structuralBlockChanges.js';

const ALICE = { name: 'Alice', email: 'alice@example.com' };

const setup = ({ content = '<p>Hello world</p>' } = {}) => {
  const { editor } = initTestEditor({ mode: 'text', content, user: ALICE, trackedChanges: {} });
  return editor;
};

/** Stamp a block-level `trackChange` attr on the first node of the given type. */
const stampBlockTrackChange = (editor, nodeTypeName, trackChange) => {
  let target = null;
  editor.state.doc.descendants((node, pos) => {
    if (target) return false;
    if (node.type.name === nodeTypeName) target = { node, pos };
    return true;
  });
  if (!target) throw new Error(`No ${nodeTypeName} node found`);
  const tr = editor.state.tr.setNodeMarkup(target.pos, undefined, {
    ...target.node.attrs,
    trackChange,
  });
  editor.view.dispatch(tr);
  return target.pos;
};

/** Stamp a block-level `trackChange` on the Nth (0-based) node of a type. */
const stampBlockTrackChangeAt = (editor, nodeTypeName, index, trackChange) => {
  const matches = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === nodeTypeName) matches.push({ node, pos });
    return true;
  });
  const target = matches[index];
  if (!target) throw new Error(`No ${nodeTypeName} node at index ${index}`);
  const tr = editor.state.tr.setNodeMarkup(target.pos, undefined, { ...target.node.attrs, trackChange });
  editor.view.dispatch(tr);
  return target.pos;
};

describe('enumerateStructuralBlockChanges', () => {
  let editor;
  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it('returns [] for a doc with no block tracked changes', () => {
    editor = setup();
    expect(enumerateStructuralBlockChanges(editor.state)).toEqual([]);
  });

  it('emits one decidable structural change for a whole-paragraph insert', () => {
    editor = setup();
    stampBlockTrackChange(editor, 'paragraph', {
      kind: 'insert',
      id: 'blk-ins-1',
      author: ALICE.name,
      authorEmail: ALICE.email,
      date: '2026-01-01T00:00:00.000Z',
    });

    const changes = enumerateStructuralBlockChanges(editor.state);
    expect(changes).toHaveLength(1);
    const [change] = changes;
    expect(change.id).toBe('blk-ins-1');
    expect(change.commandRawId).toBe('blk-ins-1');
    expect(change.side).toBe('insertion');
    expect(change.subtype).toBe('paragraph-insert');
    expect(change.decidable).toBe(true);
    expect(change.author).toBe(ALICE.name);
    expect(change.authorEmail).toBe(ALICE.email);
    expect(change.from).toBeTypeOf('number');
    expect(change.to).toBeGreaterThan(change.from);
  });

  it('maps the OOXML rowDelete-style shape (delete) to paragraph-delete', () => {
    editor = setup();
    stampBlockTrackChange(editor, 'paragraph', { kind: 'delete', id: 'blk-del-1' });

    const changes = enumerateStructuralBlockChanges(editor.state);
    expect(changes).toHaveLength(1);
    expect(changes[0].side).toBe('deletion');
    expect(changes[0].subtype).toBe('paragraph-delete');
  });

  it('does NOT emit table rows (owned by enumerateStructuralRowChanges)', () => {
    editor = setup();
    editor.commands.insertTable({ rows: 2, cols: 2 });
    // Stamp a row trackChange directly (OOXML shape) — must be ignored here.
    stampBlockTrackChange(editor, 'tableRow', { type: 'rowInsert', id: 'row-1' });

    const changes = enumerateStructuralBlockChanges(editor.state);
    expect(changes.every((c) => c.subtype === 'paragraph-insert' || c.subtype === 'paragraph-delete')).toBe(true);
    expect(changes.some((c) => c.id === 'row-1')).toBe(false);
  });

  it('tolerates a missing/empty state without throwing', () => {
    expect(enumerateStructuralBlockChanges(null)).toEqual([]);
    expect(enumerateStructuralBlockChanges(undefined)).toEqual([]);
    expect(enumerateStructuralBlockChanges({})).toEqual([]);
  });

  it('collapses a delete+insert sharing an operationId into ONE paragraph-replace', () => {
    editor = setup({ content: '<p>old title</p><p>new title</p>' });
    stampBlockTrackChangeAt(editor, 'paragraph', 0, { kind: 'delete', id: 'd1', operationId: 'op-1' });
    stampBlockTrackChangeAt(editor, 'paragraph', 1, { kind: 'insert', id: 'i1', operationId: 'op-1' });

    const changes = enumerateStructuralBlockChanges(editor.state);
    expect(changes).toHaveLength(1);
    const [change] = changes;
    expect(change.subtype).toBe('paragraph-replace');
    // The shared operationId is the public id AND the command id, so accept/
    // reject routes through the atomic acceptTrackedChangeOperation path.
    expect(change.id).toBe('op-1');
    expect(change.commandRawId).toBe('op-1');
    expect(change.operationId).toBe('op-1');
    expect(change.side).toBe('insertion');
    expect(change.decidable).toBe(true);
    expect(change.excerpt).toBe('new title');
    expect(change.deletedExcerpt).toBe('old title');
    // Range spans both halves.
    expect(change.to).toBeGreaterThan(change.from);
  });

  it('does NOT merge a separate insert and delete that lack a shared operationId', () => {
    editor = setup({ content: '<p>gone</p><p>added</p>' });
    stampBlockTrackChangeAt(editor, 'paragraph', 0, { kind: 'delete', id: 'd1' });
    stampBlockTrackChangeAt(editor, 'paragraph', 1, { kind: 'insert', id: 'i1' });

    const changes = enumerateStructuralBlockChanges(editor.state);
    expect(changes).toHaveLength(2);
    expect(changes.some((c) => c.subtype === 'paragraph-delete')).toBe(true);
    expect(changes.some((c) => c.subtype === 'paragraph-insert')).toBe(true);
    expect(changes.some((c) => c.subtype === 'paragraph-replace')).toBe(false);
  });
});
