import { useEffect, useRef, useState } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, defaultHighlightStyle, indentOnInput, LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { MergeView } from '@codemirror/merge';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { Button } from './ui/button';

/*  Content of one side after editing: text, or null if the file is absent (deleted or never created)  */
export type EditedSides = { base?: string | null; variant?: string | null };

type Side = 'base' | 'variant';

type FileEditorProps = {
  fileName: string;
  baseLabel: string;
  variantLabel: string;
  baseContent: string | null;
  variantContent: string | null;
  allowCreateDelete: boolean;
  onSave: (sides: EditedSides) => Promise<void>;
  onCancel: () => void;
};

const editorTheme = EditorView.theme({
  '&': { fontSize: '12px' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
});

const editableExtension = (editable: boolean): Extension => [ EditorView.editable.of(editable), EditorState.readOnly.of(!editable) ];

/*  Keep a file's line endings, so saving does not rewrite every line of a CRLF file  */
const lineSeparatorOf = (content: string | null) => (content?.includes('\r\n') ? '\r\n' : '\n');

/*  Side-by-side editor of a base file and its variant file (CodeMirror merge view, per-chunk copy from base)  */
export function FileEditor({ fileName, baseLabel, variantLabel, baseContent, variantContent, allowCreateDelete, onSave, onCancel }: Readonly<FileEditorProps>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MergeView | null>(null);
  const language = useRef(new Compartment());
  const editable = useRef({ base: new Compartment(), variant: new Compartment() });
  const [ exists, setExists ] = useState({ base: baseContent !== null, variant: variantContent !== null });
  const [ saving, setSaving ] = useState(false);
  const [ error, setError ] = useState('');

  useEffect(() => {
    /*  Fresh contents (e.g. after a discard in the pending changes panel) reset the editor state, too  */
    setExists({ base: baseContent !== null, variant: variantContent !== null });
    setSaving(false);
    setError('');
    const extensions = (side: Side, content: string | null): Extension => [
      lineNumbers(),
      highlightActiveLine(),
      drawSelection(),
      history(),
      indentOnInput(),
      bracketMatching(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([ ...defaultKeymap, ...historyKeymap, indentWithTab ]),
      editorTheme,
      language.current.of([]),
      EditorState.lineSeparator.of(lineSeparatorOf(content)),
      editable.current[side].of(editableExtension(content !== null)),
    ];
    const view = new MergeView({
      a: { doc: baseContent ?? '', extensions: extensions('base', baseContent) },
      b: { doc: variantContent ?? '', extensions: extensions('variant', variantContent) },
      parent: parentRef.current!,
      revertControls: 'a-to-b',
      collapseUnchanged: { margin: 5, minSize: 10 },
    });
    viewRef.current = view;
    let disposed = false;
    LanguageDescription.matchFilename(languages, fileName)?.load().then((support) => {
      if (!disposed)
        for (const editor of [ view.a, view.b ])
          editor.dispatch({ effects: language.current.reconfigure(support) });
    }).catch((loadError: unknown) => console.warn('Syntax highlighting unavailable:', loadError));
    return () => {
      disposed = true;
      view.destroy();
      viewRef.current = null;
    };
  }, [ fileName, baseContent, variantContent ]);

  const editorOf = (side: Side) => (side === 'base' ? viewRef.current?.a : viewRef.current?.b);

  const setSideExists = (side: Side, value: boolean) => {
    editorOf(side)?.dispatch({ effects: editable.current[side].reconfigure(editableExtension(value)) });
    setExists((prev) => ({ ...prev, [side]: value }));
  };

  const copyWholeFile = () => {
    const base = viewRef.current?.a.state.doc.toString() ?? '';
    const variant = viewRef.current?.b;
    if (!variant)
      return;
    variant.dispatch({ changes: { from: 0, to: variant.state.doc.length, insert: base.split('\n').join(variant.state.lineBreak) } });
    setSideExists('variant', true);
  };

  const handleSave = async () => {
    const sides: EditedSides = {};
    const original = { base: baseContent, variant: variantContent };
    for (const side of [ 'base', 'variant' ] as const) {
      const content = exists[side] ? editorOf(side)?.state.sliceDoc() ?? '' : null;
      if (content !== original[side])
        sides[side] = content;
    }
    if (Object.keys(sides).length === 0) {
      onCancel();
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(sides);
    }
    catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
      setSaving(false);
    }
  };

  const sideControls = (side: Side, label: string) => (
    <div className="flex items-center justify-between gap-2">
      <p className="text-sm font-semibold text-slate-700">
        {label}
        {!exists[side] && <span className="ml-2 text-xs font-normal text-red-600">(file absent)</span>}
      </p>
      {allowCreateDelete && (exists[side]
        ? <Button variant="ghost" size="sm" className="h-7 text-xs text-red-700" onClick={() => setSideExists(side, false)}>Delete file</Button>
        : <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSideExists(side, true)}>Create file</Button>)}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4">
        {sideControls('base', baseLabel)}
        {sideControls('variant', variantLabel)}
      </div>
      <div ref={parentRef} className="max-h-[600px] overflow-auto rounded-md border border-slate-200 bg-white" />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button size="sm" variant="outline" onClick={copyWholeFile} disabled={saving || !exists.base}
          title={exists.base ? undefined : 'The base file is absent'}>
          Copy whole file from {baseLabel}
        </Button>
        <span className="text-xs text-muted-foreground">Arrows between the editors copy single changes from {baseLabel}. Saved edits stay local until written back.</span>
      </div>
    </div>
  );
}
