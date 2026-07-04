import { ContextTracker, type Stack } from "@lezer/lr";

import {
  As, Globals, Export, Extensions, Import, Includes, Breed, To, End, Own, Command, Reporter, Constant
} from "./netlogo.terms.js";

export function keywords(name: string, stack: Stack): number {
  const nameLower: string = name.toLowerCase();

  switch (nameLower) {
    case "import": return Import;
    case "export": return Export;
    case "as": return As;
    case "globals": return Globals;
    case "extensions": return Extensions;
    case "__includes": return Includes;
    case "breed": return stack.context == 0 ? Breed : Reporter;
    case "directed-link-breed":
    case "undirected-link-breed": return Breed;
    case "to":
    case "to-report": return To;
    case "end": return End;
    default:
      switch (window.program.match(nameLower)?.type) {
        case "keyword": return nameLower.endsWith("-own") ? Own : -1;
        case "constant": return Constant;
        case "variable":
        case "reporter": return Reporter;
        case "command": return Command;
        default: return -1;
      }
  }
};

export const tracker = new ContextTracker<number>({
  start: 0,
  shift(depth: number, term: number, _, __): number {
    switch (term) {
      case To: return depth + 1;
      case End: return depth - 1;
      default: return depth;
    }
  }
});
