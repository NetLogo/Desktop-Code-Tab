import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { history, indentLess, indentMore, redo, undo } from "@codemirror/commands";
import {
  HighlightStyle, indentOnInput, bracketMatching, foldGutter, LRLanguage, LanguageSupport, syntaxHighlighting,
  defaultHighlightStyle, foldAll, foldCode, foldService, unfoldAll, unfoldCode
} from "@codemirror/language";
import { highlightSelectionMatches } from "@codemirror/search";
import { Compartment, EditorState, Line, SelectionRange, Text, Transaction } from "@codemirror/state";
import {
  EditorView, keymap, highlightSpecialChars, drawSelection, highlightActiveLine, dropCursor, rectangularSelection,
  crosshairCursor, lineNumbers, highlightActiveLineGutter, ViewUpdate
} from "@codemirror/view";
import { styleTags, Tag, tags } from "@lezer/highlight";

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
    getFolds: (state: EditorState, start: number, end: number) => { from: number, to: number } | null;
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
      highlightSpecialChars(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      highlightSelectionMatches(),
      new LanguageSupport(LRLanguage.define({
        parser: parser.configure({
          props: [
            styleTags({
              Comment: tags.comment,
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
      foldService.of(window.getFolds),
      keymap.of([
        ...closeBracketsKeymap,
        ...completionKeymap,
        { key: "Mod-z", run: window.nullHandler },
        { key: "Mod-y", run: window.nullHandler },
        { key: "Mod-x", run: window.nullHandler },
        { key: "Mod-v", run: window.nullHandler },
        { key: "Tab", run: window.indent, shift: window.unindent },
        { key: "Enter", run: window.handleEnter },
        { key: "[", run: window.handleOpenBracket },
        { key: "]", run: window.handleCloseBracket },
        { key: "e", run: (view: EditorView) => window.handleEnd(view, "e") },
        { key: "n", run: (view: EditorView) => window.handleEnd(view, "n") },
        { key: "d", run: (view: EditorView) => window.handleEnd(view, "d") }
      ]),
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.docChanged) {
          const canUndo = undo({ state: update.view.state, dispatch: () => {} });
          const canRedo = redo({ state: update.view.state, dispatch: () => {} });

          window.bridge.textUpdated(window.overwriting, canUndo, canRedo);
        } else if (update.selectionSet) {
          if (update.state.selection.main.empty && !window.highlightActive) {
            window.highlightActive = true;

            update.view.dispatch({
              effects: [
                window.highlightConfig.reconfigure(EditorView.theme({
                  ".cm-activeLine": {
                    backgroundColor: window.currentTheme.lineHighlight
                  }
                }))
              ]
            });
          } else if (!update.state.selection.main.empty && window.highlightActive) {
            window.highlightActive = false;

            update.view.dispatch({
              effects: [
                window.highlightConfig.reconfigure(EditorView.theme({
                  ".cm-activeLine": {
                    backgroundColor: "transparent"
                  }
                }))
              ]
            });
          }
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
  window.view.dispatch({
    selection: { anchor: start, head: end },
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

  view.dispatch(view.state.replaceSelection("\n"));

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

  const doc: Text = window.view.state.doc;

  const lines: number[] = window.view.state.selection.ranges.flatMap((range: SelectionRange) => {
    const startLine: number = doc.lineAt(range.from).number;
    const endLine: number = doc.lineAt(range.to).number;

    const lines: number[] = [];

    for (let i = startLine; i <= endLine; i++) {
      lines.push(i);
    }

    return lines;
  });

  const nonEmptyLines: string[] = [];

  for (const i of lines) {
    const line: string = doc.line(i).text;

    if (line.trim().length > 0) {
      nonEmptyLines.push(line);
    }
  }

  if (nonEmptyLines.length == 0) {
    window.view.dispatch({
      changes: lines.map((i: number) => {
        const offset: number = doc.line(i).from;

        return {
          from: offset,
          to: offset,
          insert: "; "
        };
      })
    });
  } else if (nonEmptyLines.every((line: string) => line.trimStart().startsWith(";"))) {
    window.view.dispatch({
      changes: lines.map((i: number) => {
        const line: Line = doc.line(i);

        const text: string = line.text;
        const index: number = text.indexOf(";");

        if (index == -1) {
          return [];
        }

        const offset: number = line.from + index;

        if (text.length > index + 1 && /\s/.test(text[index + 1] ?? "")) {
          return {
            from: offset,
            to: offset + 2,
            insert: ""
          };
        }

        return {
          from: offset,
          to: offset + 1,
          insert: ""
        };
      })
    });
  } else {
    const offset: number = Math.min(...nonEmptyLines.map((line: string) => line.search(/\S/)));

    window.view.dispatch({
      changes: lines.map((i: number) => {
        const line: Line = doc.line(i);

        if (line.text.trim().length == 0) {
          return [];
        }

        const start: number = line.from + offset;

        return {
          from: start,
          to: start,
          insert: "; "
        };
      })
    });
  }

  return true;
};

window.isEditable = () => {
  return window.view.state.readOnly;
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

window.getFolds = (state: EditorState, start: number, end: number) => {
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

    return { from: end, to: doc.line(endLine).to };
  }

  return null;
};

window.foldSelected = () => {
  foldCode(window.view);
};

window.unfoldSelected = () => {
  unfoldCode(window.view);
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
        { tag: tags.keyword, color: theme.keyword, fontStyle: "bold" },
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
