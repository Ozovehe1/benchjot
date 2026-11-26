# Design rules

Benchjot's screens follow these rules, taken from products and research rather than taste
(sources at the end). Android follows the same rules; its colours are tested against the web's.

## Content leads, chrome recedes
- The note is the screen. The sidebar sits a step darker (`--shell`) and its items are dim until
  hovered or current. Nothing in the chrome competes for attention it hasn't earned (Linear).
- Structure is felt, not drawn: surfaces are a raised fill (`card`), not bordered boxes. A
  hairline only where a list needs one (Linear's refresh removed borders that had "quietly proliferated").

## Colour only where it means something
- Neutral everywhere else (Things: about 95% neutral).
- `--ok` green: it worked. `--fail` red: it failed. `--run` amber: it's running. Nothing decorative.
- Three text steps, each readable (≥4.5:1): `--fg` content, `--muted` secondary, `--faint` metadata.

## Organise features by frequency
- One primary action per place (Run on a cell, New note on the list). Everything occasional goes
  in that place's ⋮ menu, always in the same spot (Linear: actions in "predictable places").
- Secondary detail is a tap away, never shown by default: folders (`<details>`) on the reading
  pages, "Show all" on long code, the output menu (progressive disclosure; Notion's slash menu).
- Reading pages: the answer first (one line, then the key facts as numbers), then each topic as
  a folder whose icon names it (NN/g: people scan the top and the left edge).

## Notebook-specific (CHI 2020, "What's wrong with computational notebooks?")
- Show run state on every cell: ran, failed, running, or changed since (the cell's left edge).
- Long notebooks are hard to navigate: keep cells short by default, and say how many there are.

## Type and space
- One interface face (Inter), one code face (JetBrains Mono); the serif only for page and note titles.
- Generous rhythm: 40px between cells, 16 between their parts; body line-height 1.7.

Sources: linear.app/now/behind-the-latest-design-refresh · nngroup.com/articles/f-shaped-pattern-reading-web-content ·
nngroup.com/articles/accordions-complex-content · Chattopadhyay et al., CHI 2020 · design studies of Things 3 and Notion (blakecrosley.com).
