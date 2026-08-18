import { EditorView, Decoration, type DecorationSet } from "@codemirror/view";
import { ChangeDesc, StateEffect, StateField, Transaction, type Extension } from "@codemirror/state";

interface Range {
  from: number;
  to: number;
}

const errorMark = Decoration.mark({
  class: "nl-underline"
});

const errorEffect = StateEffect.define<Range>({
  map: (range: Range, change: ChangeDesc): Range => ({
    from: change.mapPos(range.from),
    to: change.mapPos(range.to)
  })
});

export function errorExtension(): Extension {
  return [
    StateField.define<DecorationSet>({
      create() {
        return Decoration.none
      },
      update(decorations: DecorationSet, transaction: Transaction) {
        if (transaction.isUserEvent("clear")) {
          return Decoration.none;
        }

        decorations = decorations.map(transaction.changes);

        for (const effect of transaction.effects) {
          if (effect.is(errorEffect)) {
            decorations = Decoration.set(errorMark.range(effect.value.from, effect.value.to));
          }
        }

        return decorations;
      },
      provide: f => EditorView.decorations.from(f)
    }),
    EditorView.theme({
      ".nl-underline": {
        textDecoration: "underline",
        textDecorationThickness: "2px",
        textDecorationColor: "red"
      }
    })
  ];
}

export function markError(view: EditorView, from: number, to: number): void {
  if (to > from) {
    view.dispatch({
      effects: errorEffect.of({
        from: from,
        to: to
      })
    });
  }
}

export function clearErrors(view: EditorView): void {
  view.dispatch({
    userEvent: "clear"
  });
}
