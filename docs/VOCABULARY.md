# Tile vocabulary

One word per concept across the Tile family, so code, docs, product copy and AI agents mean the same thing by the same word. This file is the shared glossary: packages, hosts and the platform that embeds Tile link here instead of keeping their own copies.

## The root

| Word | Meaning |
|---|---|
| **tile** | The unit. One content piece, the way a cell is the unit of a body. |
| **`<kind>tile`** | A kind of tile: `cardtile` (the tiles of REEF with Cards), `sitetile` (the tiles of a Site), `tugtile` (the board the family grew from). |
| **Tile** | The family: this repository and its engine. |

## Which word: Cards or cardtile

One question decides it: **who is the name for?**

| The name is for | Word | Examples |
|---|---|---|
| A person operating their own thing: an owner, an agent acting for one, a visitor, support, a console | **Cards** | tool names `verb_cards`; refusal codes `cards_<thing>_<state>`; the resource in a route between services, `cards` |
| The machinery that stores, parses, renders or serves it | **cardtile** | what is written inside the file: the line marker `%% cardtile: <type>` and the frontmatter claim `cardtile: <handle>`; packages, workers, modules and bindings that point at the engine |

Where both apply, the face a caller addresses is Cards and what implements it is cardtile. A route is addressed by a caller, so it says `cards`; the file it serves is the engine's, so its lines say `cardtile`.

Cards is an invariant plural and uncountable. What is counted is handles ("3 handles", "Cards: 2 of 3 in use"), never "3 Cards". The content unit is a tile, with a front and a back.

The table states where each name is going. The sections below say, name by name, which have arrived. A name that has not arrived keeps its current spelling until this file says otherwise.

Two spellings of one name coexist for a short time, and always in this order:

1. Readers accept the new name.
2. Writers switch to it.
3. One migration rewrites what is stored.
4. Readers drop the old name.

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
| The link tile the platform draws after the author's last tile, for Cards that are in the pool | the **closing reef.cards tile**: a tile, never "the closing card" | — |

Retired inside Cards (being phased out of code, docs and copy): the singular noun **card**, **cell**, **deck**, **spread**, **face**, **drawer**, and **grid** as a lane name.

## Lines and lanes on disk

- A line names the family namespace it belongs to: `%% <kind>tile: …`. Site lines already read `%% sitetile:`; a board's settings read `%% tugtile:settings`. Cards lines are moving to `%% cardtile: <type>`.
- **Readers in this repository accept `%% cardtile: <type>`**, exactly as they accept `%% card: <type>`: the parser, the renderer, both editors, the deck and the save path read the same tile from either spelling. So do the verification scripts under `packages/cardtile/verify/` that pick a line out by its marker.
- **Today, Cards lines are still written `%% card: <type>`.** Accepting the new marker is the first step and the only one taken. Until this file says the writers have switched, keep writing `%% card:`: a reader outside this repository may not accept the new marker yet.
- The front lane will be headed `## front` (planned). Today no writer heads it that: the serializer heads a front lane that has no name of its own `## grid`, and the editor starts an empty file from the seed `## cards`. A lane that already has a heading keeps it. Readers already accept all of these, because the first lane is the front lane whatever its heading says. The back lane is `## back: <id>` (`## drawer: <id>` is the older spelling).
- **Spellings are kept per token.** Each lane heading and each line marker keeps the spelling it was written with; a save never rewrites spelling behind its author's back, in either direction. An old word leaves a file only through one deliberate migration.
- **The two spellings are meant to coexist for a short time, not forever.** The switch goes in the order given under "Which word", one step at a time, and this file says when each step has happened:
  1. Readers accept the new spelling. *Done in this repository for `%% cardtile:`, `## front` and the frontmatter claim `cardtile:`.*
  2. Writers switch to the new spelling. *Not yet.*
  3. One deliberate migration rewrites every stored file. *Not yet.*
  4. Readers drop the old spelling. *Not yet.*

  The Cards line marker, the front lane heading and the frontmatter claim follow this path. So does `## drawer:`: its writers already write `## back:`, and it leaves with the same migration.

### The frontmatter claim

- The claim is the frontmatter line that says which handle a file is. It is written inside the file, so it is in the cardtile namespace, like the line marker: `cardtile: <handle>`.
- **`cardtile: <handle>` is accepted now**, exactly as `card-page: <handle>` is. The rule is in one place, `packages/cardtile/claim.mjs`: `readClaim` reads either key, and `rekeyClaim` gives a file a new handle and keeps the key the file was written with.
- **Today, the claim is still written `card-page: <handle>`.** Every writer in this repository writes that key: the editor's starter, the sandbox's starter and the specimen generator. Keep writing `card-page:` until this file says the writers have switched: a reader outside this repository may not accept the new key yet.
- **A file with both keys claims what `cardtile:` says**, whichever line comes first. It is the one answer that does not change on the day readers drop `card-page:`.
- A save keeps the claim as it was written. Nothing rewrites one key into the other, in either direction.
- Nothing else in this repository reads the claim. The parser keeps it as text, the renderer and the API take the handle from the address they were called on, and to the Site and board parsers `cardtile` is an ordinary frontmatter key.

## Names that are stored or cross a deploy boundary

Stored keys, routes, refusal codes, message keys and rule ids are no longer "historic names that stay". Each follows the layer it belongs to, by the test under "Which word", and each moves by the same four steps. They move last, because a name that is stored or called from another deployment cannot change in one commit: each has its own migration.

Until this file names a new spelling, the current one is the name. Read `card` in it as "Cards".

Moved:

- **The agent operations are named verb_noun with the product noun**: `get_cards`, `save_cards`, `preview_cards`, beside `list_cards`, which already was. `put_asset` and `delete_asset` are unchanged. The former names (`get_card`, `save_card`, `preview_card`) are no longer operations in this repository. A consumer that exposes the operations as tools keeps each former name callable as a temporary alias on its own side, from the map `OPS_FORMER_NAMES` in `packages/cardtile/ai-ops.mjs`. The alias window is short, and the map is deleted when it closes.

Moving:

- **Routes.** A route between services names the resource `cards`. Every route under `/_api/card/<handle>` is also served at `/_api/cards/<handle>`: the read, save and delete of the handle itself, `/full`, `/lifetime`, `/stop`, `/asset/<id>`, `/asset/<id>/fenced`, `/lang/<tag>` and `/lang/<tag>/full`, with the same methods, the same authorization and the same answers. An answer that names a path names the one it was called on.
  1. The API accepts the new prefix. *Done.*
  2. Callers switch to it. *Not yet: the tools in this repository still call `/_api/card/…`.*
  3. Nothing is stored under a route, so there is no migration step.
  4. The API drops `/_api/card/<handle>`. *Not yet, and not before every caller has switched.*

  `POST /_api/cards`, with no handle, is the list, and is unchanged. A handle is never empty, so the list and one handle's route cannot be confused. `/_api/preview`, `/_api/try/<id>` and `/_api/vanity/<handle>` are unchanged.

Planned, not moved:

- **Refusal codes.** The pattern is `cards_<thing>_<state>`. No code has moved: each keeps its current spelling until this file names its new one.
- **Stored keys.** They follow the engine's layer and move last, each with its own migration. Their new spellings are not decided here; until they are, the keys are what they are today.
- **Message keys and rule ids.** The same: current spelling until this file names a new one.

## Site (sitetile)

Site's own vocabulary is not changed by this file. Today a Site's grid item renders with the classes `st-cell…`, and the platform's Site editor labels its grid coral "Tiles". Site keeps those words for now, but reads this file, so it can understand Cards: a line of Cards is a `cardtile` tile, and the namespaced markers let a Site tell those lines from its own. Keeping tile kinds compatible is a goal, so that Cards could later be inherited by a Site.
