import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState, type Extension, Line, StateEffect, StateField, Text, Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

const identRegex: RegExp = /[\w\-:.?=*!<>#+/%$\^'&]+/;

export enum TokenType {
  Comment,
  OpenParen,
  CloseParen,
  OpenBracket,
  CloseBracket,
  OpenBrace,
  CloseBrace,
  Keyword,
  Literal,
  Command,
  Reporter,
  Ident
}

export interface TokenSpec {
  from: number;
  to: number;
  type: TokenType;
}

function stringClass(type: TokenType): string {
  switch (type) {
    case TokenType.Comment: return "nl-comment";
    case TokenType.Keyword: return "nl-keyword";
    case TokenType.Literal: return "nl-literal";
    case TokenType.Command: return "nl-command";
    case TokenType.Reporter: return "nl-reporter";
    default: return "nl-default";
  }
}

const highlightEffect = StateEffect.define<TokenSpec>();

const highlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations: DecorationSet, transaction: Transaction): DecorationSet {
    if (transaction.docChanged) {
      decorations = decorations.map(transaction.changes);
    }

    if (!transaction.isUserEvent("highlight")) {
      return decorations;
    }

    for (const effect of transaction.effects) {
      if (effect.is(highlightEffect)) {
        decorations = decorations.update({
          filter(from: number, to: number, _: Decoration) {
            return to <= effect.value.from || from >= effect.value.to;
          },
          add: [
            Decoration.mark({
              class: stringClass(effect.value.type)
            }).range(effect.value.from, effect.value.to)
          ]
        });
      }
    }

    return decorations;
  },
  provide(field: StateField<DecorationSet>): Extension {
    return EditorView.decorations.from(field);
  }
});

export interface LanguageServerOptions {
  port: number
}

export class LanguageServer {
  private readonly socket: WebSocket;

  private cachedLines: Map<number, TokenSpec[]> = new Map();

  constructor(options: LanguageServerOptions) {
    this.socket = new WebSocket(`ws://localhost:${options.port}`);

    this.socket.addEventListener("message", (event: MessageEvent<string>) => {
      const data: any = JSON.parse(event.data);

      const line: Line = window.view.state.doc.line(parseInt(data["line"]));
      const tokens: TokenSpec[] = data["tokens"];

      this.cachedLines.set(line.number, tokens);

      window.view.dispatch({
        userEvent: "highlight",
        effects: tokens.map(token => {
          return highlightEffect.of({
            from: line.from + token.from,
            to: line.from + token.to,
            type: token.type
          });
        })
      });
    });
  }

  processTransaction(transaction: Transaction): LanguageServer {
    if (this.socket.readyState == WebSocket.OPEN) {
      transaction.changes.iterChangedRanges((_, __, fromB, toB) => {
        const startLine: Line = transaction.state.doc.lineAt(fromB);
        const endLine: Line = transaction.state.doc.lineAt(toB);

        for (let i = startLine.number; i <= endLine.number; i++) {
          this.socket.send(JSON.stringify({
            line: i,
            text: transaction.state.doc.line(i).text
          }));
        }
      });
    }

    return this;
  }

  requestLine(line: Line): TokenSpec[] {
    const cached: TokenSpec[] | undefined = this.cachedLines.get(line.number);

    if (cached) {
      return cached;
    }

    this.socket.send(JSON.stringify({
      line: line.number,
      text: line.text
    }));

    return [];
  }

  createExtension(): Extension {
    return [
      languageServerField(this),
      highlightField,
      EditorState.languageData.of(() => [{
        autocomplete: autocomplete
      }]),
    ];
  }
}

function languageServerField(server: LanguageServer): Extension {
  return StateField.define<LanguageServer>({
    create(): LanguageServer {
      return server;
    },
    update(server: LanguageServer, transaction: Transaction): LanguageServer {
      if (transaction.docChanged) {
        return server.processTransaction(transaction);
      }

      return server;
    }
  });
}

function autocomplete(context: CompletionContext): CompletionResult | null {
  let inProc = false;

  // ensureSyntaxTree(window.view.state, context.pos)?.iterate({
  //   from: 0,
  //   to: context.pos,
  //   enter(node) {
  //     if (node.type.id == To) {
  //       inProc = true;
  //     } else if (node.type.id == End) {
  //       inProc = false;
  //     }
  //   }
  // });

  const match = context.matchBefore(identRegex);

  if (context.explicit) {
    return {
      from: match?.from ?? context.pos,
      options: window.program.matches(match?.text.toLowerCase() ?? "").filter((completion) => {
        return (completion.type == "keyword") != inProc;
      })
    };
  }

  const doc: Text = context.state.doc;

  if (match && window.completeOnType && doc.sliceString(match.from - 1, match.from) != '"') {
    const line: string = doc.sliceString(doc.lineAt(match.from).from, match.from).toLowerCase();

    const procMatch = line.match(`^\\s*(to|to-report)\\s+(${identRegex}\\s*\\[)?`);
    const modMatch = line.match(/^\s*(import|export)\s+\[?/);
    const declMatch = line.match(`^\\s*(${window.program.decls.join("|")})\\s*\\[`);
    const letMatch = line.match(/^\s*let\s+$/);
    const semiMatch = line.match(/^.*;/);
    const quoteMatch = line.match(/^.*"/);

    if (procMatch || modMatch || declMatch || letMatch ||
        (semiMatch && (semiMatch[0].match(/(?<!\\)"/g)?.length ?? 0) % 2 == 0) ||
        (quoteMatch && (quoteMatch[0].match(/(?<!\\)"/g)?.length ?? 0) % 2 != 0)) {
      return null;
    }

    return {
      from: match.from,
      options: window.program.matches(match.text.toLowerCase()).filter((completion) => {
        return (completion.type == "keyword") != inProc;
      })
    };
  }

  return null;
}
