# Tile vocabulary

One word per concept across the Tile family, so code, docs, product copy and AI agents mean the same thing by the same word. This file is the shared glossary: packages, hosts and the platform that embeds Tile link here instead of keeping their own copies.

## The root

| Word | Meaning |
|---|---|
| **tile** | The unit. One content piece, the way a cell is the unit of a body. |
| **`<kind>tile`** | A kind of tile: `cardtile` (the tiles of REEF with Cards), `sitetile` (the tiles of a Site), `tugtile` (the board the family grew from). |
| **Tile** | The family: this repository and its engine. |

## REEF with Cards (cardtile)

| Concept | Word in code and docs | Product copy (en) |
|---|---|---|
| One whole REEF with Cards (one handle, one Markdown file) | **Cards**: an invariant brand noun, never the plural of anything. There is no counting unit: "your Cards", never "a Cards" or "a set of Cards". A number follows a label ("Cards: 2 of 3 in use"), never the noun. | Cards (full name: REEF with Cards) |
| One content piece | **tile** | tile |
| A tile's visible side | **front** | Front |
| What a tile opens when it turns over | a **back**: a lane `## back: <id>` holding one or more tiles. A tile opens a back with `back=#id`. Several tiles, links and the frontmatter default `back:` may open the same back. | Back |
| The first lane | the **front lane** | — |
| Any later titled lane on the front | a **section** | (its title) |
| An entry of the assets lane | an **asset**: a stored entry, not a tile | — |
| A front tile plus the back it opens, in the editor | a **pair** | Pair as front and back |
| The editor's numbered place | a **slot** (editor only, never stored) | — |
| The file's leading block | **frontmatter** | — |
| How a visitor sees Cards | the **views** `stack`, `list`, `wall` | Stack, List, Wall |

Retired inside Cards (being phased out of code, docs and copy): the singular noun **card**, **cell**, **deck**, **spread**, **face**, **drawer**, and **grid** as a lane name.

## Lines and lanes on disk

- A line names the family namespace it belongs to: `%% <kind>tile: …`. Site lines already read `%% sitetile:`; a board's settings read `%% tugtile:settings`. Cards lines are moving to `%% cardtile: <type>`.
- **Readers in this repository accept `%% cardtile: <type>`**, exactly as they accept `%% card: <type>`: the parser, the renderer, both editors, the deck and the save path read the same tile from either spelling. So do the verification scripts under `packages/cardtile/verify/` that pick a line out by its marker.
- **Today, Cards lines are still written `%% card: <type>`.** Accepting the new marker is the first step and the only one taken. Until this file says the writers have switched, keep writing `%% card:`: a reader outside this repository may not accept the new marker yet.
- The front lane will be headed `## front` (planned). Today no writer heads it that: the serializer heads a front lane that has no name of its own `## grid`, and the editor starts an empty file from the seed `## cards`. A lane that already has a heading keeps it. Readers already accept all of these, because the first lane is the front lane whatever its heading says. The back lane is `## back: <id>` (`## drawer: <id>` is the older spelling).
- **Spellings are kept per token.** Each lane heading and each line marker keeps the spelling it was written with; a save never rewrites spelling behind its author's back, in either direction. An old word leaves a file only through one deliberate migration.
- **The two spellings are meant to coexist for a short time, not forever.** The switch goes in this order, one step at a time, and this file says when each step has happened:
  1. Readers accept the new spelling. *Done in this repository for `%% cardtile:` and `## front`.*
  2. Writers switch to the new spelling. *Not yet.*
  3. One deliberate migration rewrites every stored file. *Not yet.*
  4. Readers drop the old spelling. *Not yet.*

  The Cards line marker and the front lane heading follow this path. So does `## drawer:`: its writers already write `## back:`, and it leaves with the same migration.

## Historic names that stay

Names that are stored, or that cross a deploy boundary, keep their old spelling unless a migration is planned for them: stored keys, routes such as `/_api/card…`, the frontmatter claim `card-page:`, refusal codes, message keys and rule ids. They are historic names, not current vocabulary; read `card` in them as "Cards".

One group of names has moved:

- **The agent operations are named verb_noun with the product noun**: `get_cards`, `save_cards`, `preview_cards`, beside `list_cards`, which already was. `put_asset` and `delete_asset` are unchanged. The former names (`get_card`, `save_card`, `preview_card`) are no longer operations in this repository. A consumer that exposes the operations as tools keeps each former name callable as a temporary alias on its own side, from the map `OPS_FORMER_NAMES` in `packages/cardtile/ai-ops.mjs`. The alias window is short, and the map is deleted when it closes.

Two more are planned to follow and have not moved:

- **Routes.** `/_api/card/<handle>` is still the route. `/_api/cards/<handle>` is the proposal: proposed, not decided, and nothing serves it.
- **Refusal codes.** They keep their current spelling until this file names their new one.

The rest of the list above stays as it is, with no migration planned.

## Site (sitetile)

Site's own vocabulary is not changed by this file. Today a Site's grid item renders with the classes `st-cell…`, and the platform's Site editor labels its grid coral "Tiles". Site keeps those words for now, but reads this file, so it can understand Cards: a line of Cards is a `cardtile` tile, and the namespaced markers let a Site tell those lines from its own. Keeping tile kinds compatible is a goal, so that Cards could later be inherited by a Site.
