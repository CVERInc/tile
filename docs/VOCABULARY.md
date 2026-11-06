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
| How a visitor sees a Cards | the **views** `stack`, `list`, `wall` | Stack, List, Wall |

Retired inside Cards (being phased out of code, docs and copy): the singular noun **card**, **cell**, **deck**, **spread**, **face**, **drawer**, and **grid** as a lane name.

## Lines and lanes on disk

- A line names the family namespace it belongs to: `%% <kind>tile: …`. Site lines already read `%% sitetile:`; a board's settings read `%% tugtile:settings`. Cards lines will read `%% cardtile: <type>` (planned).
- **Today, Cards lines are still written `%% card: <type>`.** The new marker is planned and is not to be written yet: every reader has to accept it first. Until this file says the switch has happened, keep writing `%% card:`.
- The front lane will be headed `## front` (planned; today `## grid`). The back lane is `## back: <id>` (`## drawer: <id>` is the older spelling).
- **Spellings are kept per token.** Each lane heading and each line marker keeps the spelling it was written with; a save never rewrites spelling behind its author's back. An old word leaves a file only through one deliberate migration. Old spellings stay readable forever.

## Historic names that stay

Names that are stored, or that cross a deploy boundary, keep their old spelling unless a migration is planned for them: stored keys, routes such as `/_api/card…`, the frontmatter claim `card-page:`, refusal codes, message keys and rule ids. They are historic names, not current vocabulary; read `card` in them as "Cards".

## Site (sitetile)

Site's own vocabulary is not changed by this file. Today a Site's grid item renders with the classes `st-cell…`, and Site's grid coral is labelled "Tiles". Site keeps those words for now, but reads this file, so it can understand a Cards: a Cards line is a `cardtile` tile, and the namespaced markers let a Site tell a Cards line from its own. Keeping tile kinds compatible is a goal, so that a Cards could later be inherited by a Site.
