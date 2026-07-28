import { StreamLanguage, StringStream, type StreamParser } from "@codemirror/language";
import { Tag, tags } from "@lezer/highlight";

export const commandTag: Tag = Tag.define("command", tags.name);
export const reporterTag: Tag = Tag.define("reporter", tags.name);

interface ParserState {
  proc: boolean;
}

class NLParser implements StreamParser<ParserState> {
  tokenTable: { [name: string]: Tag; };

  constructor() {
    this.tokenTable = {
      "bracketOpen": tags.name,
      "bracketClose": tags.name,
      "parenOpen": tags.name,
      "parenClose": tags.name,
      "to": tags.keyword,
      "command": commandTag,
      "reporter": reporterTag,
      "variable": reporterTag,
      "global": tags.name,
      "constant": tags.literal
    };
  }

  startState(_: number): ParserState {
    return {
      proc: false
    };
  }

  token(stream: StringStream, state: ParserState): string {
    if (stream.eatSpace()) {
      return "default";
    }

    switch (stream.peek()) {
      case ";":
        stream.skipToEnd();

        return "comment";

      case "[":
        stream.next();

        return "bracketOpen";

      case "]":
        stream.next();

        return "bracketClose";

      case '"':
        stream.next();
        stream.eatWhile(/(?<!\\)[^"]/);
        stream.next();

        return "literal";

      case "(":
        stream.next();

        return "parenOpen";

      case ")":
        stream.next();

        return "parenClose";

      default:
        if (stream.match(/-?\d+(\.\d+)?(e[+-]?\d+)?/i)) {
          return "literal";
        }

        if (stream.match(/^breed/i)) {
          if (state.proc) {
            return "reporter";
          }

          return "keyword";
        }

        if (stream.match(/^to(-report)?/i)) {
          state.proc = true;

          return "to";
        }

        if (stream.match(/^end/i)) {
          state.proc = false;

          return "keyword";
        }

        if (stream.eatWhile(/\S/)) {
          return window.program.match(stream.current())?.type ?? "default";
        }

        return "default";
    }
  }
}

export const NLLanguage = StreamLanguage.define(new NLParser());
