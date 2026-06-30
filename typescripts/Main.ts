import { completionKeymap, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  cursorGroupBackward, cursorGroupForward, deleteGroupBackward, deleteGroupForward, history, indentLess, indentMore,
  moveLineDown, moveLineUp, redo, selectGroupBackward, selectGroupForward, undo
} from "@codemirror/commands";
import {
  HighlightStyle, bracketMatching, foldGutter, LRLanguage, LanguageSupport, syntaxHighlighting, defaultHighlightStyle,
  foldAll, foldEffect, foldService, unfoldAll, unfoldEffect
} from "@codemirror/language";
import { highlightSelectionMatches } from "@codemirror/search";
import { Compartment, EditorState, Line, SelectionRange, Text, Transaction } from "@codemirror/state";
import {
  EditorView, keymap, drawSelection, highlightActiveLine, rectangularSelection, crosshairCursor, lineNumbers,
  highlightActiveLineGutter, ViewUpdate
} from "@codemirror/view";
import { styleTags, Tag, tags } from "@lezer/highlight";

import { toggleComments } from "./comment.js";
import { executeIndentations } from "./indent.js";
import { parser } from "./netlogo.js";

interface ColorTheme {
  background: string;
  gutterBorder: string;
  scrollBarBackground: string;
  scrollBarForeground: string;
  scrollBarForegroundHover: string;
  caret: string;
  lineHighlight: string;
  selection: string;
  selectionError: string;
  default: string;
  comment: string;
  constant: string;
  keyword: string;
  command: string;
  reporter: string;
}

interface FoldRange {
  from: number;
  to: number;
}

const commandTag: Tag = Tag.define("command", tags.name);
const reporterTag: Tag = Tag.define("reporter", tags.name);

declare global {
  interface Window {
    view: EditorView;

    themeConfig: Compartment;
    selectionConfig: Compartment;
    highlightConfig: Compartment;
    syntaxConfig: Compartment;
    historyConfig: Compartment;
    fontConfig: Compartment;
    editableConfig: Compartment;
    readOnlyConfig: Compartment;
    lineNumbersConfig: Compartment;

    currentTheme: ColorTheme;

    overwriting: boolean;
    highlightActive: boolean;
    smartIndent: boolean;
    lineNumbers: boolean;

    getText: () => string;
    getSelectionStart: () => number;
    getSelectionEnd: () => number;
    getSelectedText: () => string;
    getCaretPosition: () => number;
    getTokenAtCaret: () => string;
    setText: (text: string) => void;
    undo: () => void;
    redo: () => void;
    resetHistory: () => void;
    copy: () => void;
    cut: () => void;
    paste: () => void;
    select: (start: number, end: number) => void;
    selectAll: () => void;
    replaceSelection: (text: string) => void;
    shiftLeft: () => void;
    shiftRight: () => void;
    indent: (view: EditorView) => boolean;
    unindent: (view: EditorView) => boolean;
    handleEnter: (view: EditorView) => boolean;
    handleOpenBracket: (view: EditorView) => boolean;
    handleCloseBracket: (view: EditorView) => boolean;
    handleEnd: (view: EditorView, char: string) => boolean;
    toggleComments: () => void;
    isEditable: () => boolean;
    setEditable: (editable: boolean) => void;
    setIndenter: (smart: boolean) => void;
    getLineNumbers: () => boolean;
    setLineNumbers: (visible: boolean) => void;
    setFont: (family: string, size: number) => void;
    setNormalSelection: () => void;
    setErrorSelection: () => void;
    setHighlight: (active: boolean) => void;
    getFold: (state: EditorState, start: number, end: number) => FoldRange | null;
    getFolds: (state: EditorState) => FoldRange[];
    foldSelected: () => void;
    unfoldSelected: () => void;
    foldAll: () => void;
    unfoldAll: () => void;
    syncTheme: (theme: ColorTheme) => void;
    nullHandler: (view: EditorView) => boolean;

    bridge: {
      log: (message: String) => void;
      textUpdated: (overwriting: boolean, canUndo: boolean, canRedo: boolean) => void;
      writeClipboard: (text: String) => void;
      readClipboard: () => string;
      jumpToDeclaration: () => void;
    };
  }
}

window.onload = () => {
  window.themeConfig = new Compartment();
  window.selectionConfig = new Compartment();
  window.highlightConfig = new Compartment();
  window.syntaxConfig = new Compartment();
  window.historyConfig = new Compartment();
  window.fontConfig = new Compartment();
  window.editableConfig = new Compartment();
  window.readOnlyConfig = new Compartment();
  window.lineNumbersConfig = new Compartment();

  window.currentTheme = {
    background: "",
    gutterBorder: "",
    scrollBarBackground: "",
    scrollBarForeground: "",
    scrollBarForegroundHover: "",
    caret: "",
    lineHighlight: "",
    selection: "",
    selectionError: "",
    default: "",
    comment: "",
    constant: "",
    keyword: "",
    command: "",
    reporter: "",
  };

  window.view = new EditorView({
    parent: document.body,
    extensions: [
      foldGutter(),
      drawSelection(),
      EditorState.allowMultipleSelections.of(true),
      bracketMatching(),
      rectangularSelection({
        eventFilter: (event: MouseEvent) => event.shiftKey && event.altKey
      }),
      crosshairCursor(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      highlightSelectionMatches({
        wholeWords: true
      }),
      new LanguageSupport(LRLanguage.define({
        parser: parser.configure({
          props: [
            styleTags({
              Comment: tags.comment,
              Import: tags.keyword,
              Export: tags.keyword,
              As: tags.keyword,
              Globals: tags.keyword,
              Breed: tags.keyword,
              Own: tags.keyword,
              Extensions: tags.keyword,
              Includes: tags.keyword,
              To: tags.keyword,
              End: tags.keyword,
              Identifier: tags.name,
              Number: tags.literal,
              String: tags.literal,
              Command: commandTag,
              Reporter: reporterTag,
              Var: reporterTag,
              Constant: tags.literal
            })
          ]
        })
      })),
      foldService.of(window.getFold),
      keymap.of([
        ...closeBracketsKeymap,
        ...completionKeymap,
        { key: "Mod-z", run: window.nullHandler },
        { key: "Mod-y", run: window.nullHandler },
        { key: "Mod-x", run: window.nullHandler },
        { key: "Mod-v", run: window.nullHandler },
        { key: "Mod-m", run: window.nullHandler },
        { key: "Mod-Backspace", mac: "Alt-Backspace", run: deleteGroupBackward },
        { key: "Mod-Delete", mac: "Alt-Delete", run: deleteGroupForward },
        { key: "Mod-ArrowLeft", mac: "Alt-ArrowLeft", run: cursorGroupBackward, shift: selectGroupBackward },
        { key: "Mod-ArrowRight", mac: "Alt-ArrowRight", run: cursorGroupForward, shift: selectGroupForward },
        { key: "Alt-ArrowUp", run: moveLineUp },
        { key: "Alt-ArrowDown", run: moveLineDown },
        { key: "Tab", run: window.indent, shift: window.unindent },
        { key: "Enter", run: window.handleEnter },
        { key: "[", run: window.handleOpenBracket },
        { key: "]", run: window.handleCloseBracket },
        { key: "e", run: (view: EditorView) => window.handleEnd(view, "e") },
        { key: "n", run: (view: EditorView) => window.handleEnd(view, "n") },
        { key: "d", run: (view: EditorView) => window.handleEnd(view, "d") }
      ]),
      EditorView.clickAddsSelectionRange.of((event: MouseEvent) => event.altKey),
      EditorView.domEventHandlers({
        click: (event: MouseEvent) => {
          if (event.ctrlKey && event.button == 0) {
            window.bridge.jumpToDeclaration();
          }
        }
      }),
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.docChanged) {
          const canUndo = undo({ state: update.view.state, dispatch: () => {} });
          const canRedo = redo({ state: update.view.state, dispatch: () => {} });

          window.bridge.textUpdated(window.overwriting, canUndo, canRedo);

          window.setHighlight(true);
        } else if (update.selectionSet) {
          window.setHighlight(update.state.selection.main.empty);
        }
      }),
      window.themeConfig.of(EditorView.theme({})),
      window.selectionConfig.of(EditorView.theme({})),
      window.highlightConfig.of(EditorView.theme({})),
      window.syntaxConfig.of(syntaxHighlighting(defaultHighlightStyle)),
      window.historyConfig.of(history()),
      window.fontConfig.of(EditorView.theme({})),
      window.editableConfig.of(EditorView.editable.of(true)),
      window.readOnlyConfig.of(EditorState.readOnly.of(false)),
      window.lineNumbersConfig.of([])
    ]
  });
};

window.getText = () => {
  return btoa(window.view.state.doc.toString());
};

window.getSelectionStart = () => {
  return window.view.state.selection.ranges[0]?.from ?? 0;
};

window.getSelectionEnd = () => {
  const ranges: readonly SelectionRange[] = window.view.state.selection.ranges;

  return ranges[ranges.length - 1]?.to ?? 0;
};

window.getSelectedText = () => {
  const state: EditorState = window.view.state;
  const selection: string = state.selection.ranges.map(range => state.sliceDoc(range.from, range.to)).join("\n");

  return btoa(selection);
};

window.getCaretPosition = () => {
  return window.view.state.selection.main.head;
};

window.getTokenAtCaret = () => {
  const caret: number = window.view.state.selection.main.head;
  const line: Line = window.view.state.doc.lineAt(caret);
  const text: string = line.text;
  const offset: number = caret - line.from;

  let start = offset;

  while (start > 0 && /\S/.test(text[start - 1] ?? "")) {
    start--;
  }

  let end = offset;

  while (end < text.length && /\S/.test(text[end] ?? "")) {
    end++;
  }

  return text.slice(start, end);
};

window.setText = (text: string) => {
  const state: EditorState = window.view.state;
  const transaction: Transaction = state.update({
    changes: { from: 0, to: state.doc.length, insert: atob(text) },
    selection: { anchor: 0, head: 0 },
    scrollIntoView: true
  });

  window.overwriting = true;
  window.view.dispatch([ transaction ]);
  window.overwriting = false;

  window.resetHistory();
};

window.undo = () => {
  undo(window.view);
};

window.redo = () => {
  redo(window.view);
};

window.resetHistory = () => {
  window.view.dispatch({
    effects: [
      window.historyConfig.reconfigure([])
    ]
  });

  window.view.dispatch({
    effects: [
      window.historyConfig.reconfigure(history())
    ]
  });
};

window.copy = () => {
  const state: EditorState = window.view.state;
  const selection: string = state.selection.ranges.map(range => state.sliceDoc(range.from, range.to)).join("\n");

  window.bridge.writeClipboard(selection);

  return true;
};

window.cut = () => {
  if (window.view.state.readOnly) {
    return false;
  }

  window.copy();

  window.view.dispatch(window.view.state.replaceSelection(""));

  return true;
};

window.paste = () => {
  if (window.view.state.readOnly) {
    return false;
  }

  window.view.dispatch(window.view.state.replaceSelection(window.bridge.readClipboard()));

  return true;
};

window.select = (start: number, end: number) => {
  const length: number = window.view.state.doc.length;

  window.view.dispatch({
    selection: { anchor: Math.min(start, length), head: Math.min(end, length) },
    scrollIntoView: true
  });
};

window.selectAll = () => {
  window.view.dispatch({
    selection: { anchor: 0, head: window.view.state.doc.length }
  });
};

window.replaceSelection = (text: string) => {
  if (!window.view.state.readOnly) {
    window.view.dispatch(window.view.state.replaceSelection(text));
  }
};

window.shiftLeft = () => {
  indentLess(window.view);
};

window.shiftRight = () => {
  indentMore(window.view);
};

window.indent = (view: EditorView) => {
  if (view.state.readOnly) {
    return false;
  }

  if (window.smartIndent) {
    executeIndentations(view);
  } else {
    indentMore(view);
  }

  return true;
};

window.unindent = (view: EditorView) => {
  if (view.state.readOnly) {
    return false;
  }

  if (window.smartIndent) {
    executeIndentations(view);
  } else {
    indentLess(view);
  }

  return true;
};

window.handleEnter = (view: EditorView) => {
  if (view.state.readOnly || !window.smartIndent) {
    return false;
  }

  view.dispatch(view.state.replaceSelection("\n"), { scrollIntoView: true });

  executeIndentations(view);

  return true;
};

window.handleOpenBracket = (view: EditorView) => {
  if (view.state.readOnly || !window.smartIndent) {
    return false;
  }

  view.dispatch(view.state.replaceSelection("["));

  executeIndentations(view);

  return true;
};

window.handleCloseBracket = (view: EditorView) => {
  if (view.state.readOnly || !window.smartIndent) {
    return false;
  }

  view.dispatch(view.state.replaceSelection("]"));

  executeIndentations(view);

  return true;
};

window.handleEnd = (view: EditorView, char: string) => {
  if (view.state.readOnly || !window.smartIndent) {
    return false;
  }

  view.dispatch(view.state.replaceSelection(char));

  if (view.state.doc.lineAt(view.state.selection.main.head).text.trimStart().toLowerCase().startsWith("end")) {
    executeIndentations(view);
  }

  return true;
};

window.toggleComments = () => {
  if (window.view.state.readOnly) {
    return false;
  }

  toggleComments(window.view);

  return true;
};

window.isEditable = () => {
  return !window.view.state.readOnly;
};

window.setEditable = (editable: boolean) => {
  window.view.dispatch({
    effects: [
      window.editableConfig.reconfigure(EditorView.editable.of(editable)),
      window.readOnlyConfig.reconfigure(EditorState.readOnly.of(!editable))
    ]
  });
};

window.setIndenter = (smart: boolean) => {
  window.smartIndent = smart;
};

window.getLineNumbers = () => {
  return window.lineNumbers;
};

window.setLineNumbers = (visible: boolean) => {
  window.lineNumbers = visible;

  if (visible) {
    window.view.dispatch({
      effects: [
        window.lineNumbersConfig.reconfigure(lineNumbers())
      ]
    });
  } else {
    window.view.dispatch({
      effects: [
        window.lineNumbersConfig.reconfigure([])
      ]
    });
  }
};

window.setFont = (family: string, size: number) => {
  window.view.dispatch({
    effects: [
      window.fontConfig.reconfigure(EditorView.theme({
        "&, .cm-content, .cm-gutters": {
          fontSize: size + "pt",
          fontFamily: family + ", monospace"
        }
      }))
    ]
  })
};

window.setNormalSelection = () => {
  window.view.dispatch({
    effects: [
      window.selectionConfig.reconfigure(EditorView.theme({
        "&.cm-focused .cm-selectionBackground, & .cm-selectionBackground": {
          backgroundColor: window.currentTheme.selection + " !important"
        }
      }))
    ]
  });
};

window.setErrorSelection = () => {
  window.view.dispatch({
    effects: [
      window.selectionConfig.reconfigure(EditorView.theme({
        "&.cm-focused .cm-selectionBackground, & .cm-selectionBackground": {
          backgroundColor: window.currentTheme.selectionError + " !important"
        }
      }))
    ]
  });
};

window.setHighlight = (active: boolean) => {
  if (window.highlightActive != active) {
    window.highlightActive = active;

    window.view.dispatch({
      effects: [
        window.highlightConfig.reconfigure(EditorView.theme({
          ".cm-activeLine": {
            backgroundColor: active ? window.currentTheme.lineHighlight : "transparent"
          }
        }))
      ]
    });
  }
}

window.getFold = (state: EditorState, start: number, end: number) => {
  const doc: Text = state.doc;
  const startLine: Line = doc.lineAt(start);

  if (startLine.text.trimStart().toLowerCase().startsWith("to")) {
    let endLine: number = startLine.number + 1;

    while (endLine <= doc.lines) {
      const line: string = doc.line(endLine).text.trimStart().toLowerCase();

      if (line.startsWith("end")) {
        break;
      }

      if (line.startsWith("to")) {
        return null;
      }

      endLine++;
    }

    if (endLine > doc.lines) {
      return null;
    }

    const to: number = doc.line(endLine).to;

    if (end == to) {
      return null;
    }

    return { from: end, to: to };
  }

  return null;
};

window.getFolds = (state: EditorState) => {
  const doc: Text = state.doc;

  return state.selection.ranges.flatMap((range: SelectionRange) => {
    const end: number = doc.lineAt(range.to).number;
    const folds: FoldRange[] = [];

    let current: number = doc.lineAt(range.from).number;

    while (current <= end) {
      const line: Line = doc.line(current);
      const fold: FoldRange | null = window.getFold(state, line.from, line.to);

      if (fold) {
        folds.push(fold);

        current = doc.lineAt(fold.to).number + 1;
      } else {
        current++;
      }
    }

    return folds;
  });
}

window.foldSelected = () => {
  window.getFolds(window.view.state).forEach((fold) => {
    window.view.dispatch({
      effects: foldEffect.of(fold)
    });
  });
};

window.unfoldSelected = () => {
  window.getFolds(window.view.state).forEach((fold) => {
    window.view.dispatch({
      effects: unfoldEffect.of(fold)
    });
  });
};

window.foldAll = () => {
  foldAll(window.view);
};

window.unfoldAll = () => {
  unfoldAll(window.view);
};

window.syncTheme = (theme: ColorTheme) => {
  document.body.style.background = theme.background;

  const root = document.querySelector(":root") as HTMLElement;

  root.style.setProperty("--scrollbar-background", theme.scrollBarBackground);
  root.style.setProperty("--scrollbar-foreground", theme.scrollBarForeground);
  root.style.setProperty("--scrollbar-foreground-hover", theme.scrollBarForegroundHover);

  window.currentTheme = theme;

  window.view.dispatch({
    effects: [
      window.themeConfig.reconfigure(EditorView.theme({
        "&.cm-focused": {
          outline: "none"
        },
        "&, .cm-gutters, .cm-gutter, .cm-gutterElement": {
          backgroundColor: theme.background,
          color: theme.default
        },
        ".cm-gutters": {
          height: "100vh",
          borderRightColor: theme.gutterBorder
        },
        "& .cm-cursor, & .cm-dropCursor": {
          borderLeftColor: theme.caret
        },
        ".cm-selectionMatch": {
          backgroundColor: theme.selection + " !important"
        }
      })),
      window.highlightConfig.reconfigure(EditorView.theme({
        ".cm-activeLine": {
          backgroundColor: theme.lineHighlight
        }
      })),
      window.syntaxConfig.reconfigure(syntaxHighlighting(HighlightStyle.define([
        { tag: tags.name, color: theme.default },
        { tag: tags.comment, color: theme.comment },
        { tag: tags.keyword, color: theme.keyword, fontWeight: "bold" },
        { tag: tags.literal, color: theme.constant },
        { tag: commandTag, color: theme.command },
        { tag: reporterTag, color: theme.reporter }
      ])))
    ]
  });
};

window.nullHandler = (_: EditorView) => {
  return true;
};
