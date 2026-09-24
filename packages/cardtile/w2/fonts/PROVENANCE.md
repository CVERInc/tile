# Porch-skin fonts — provenance

The Card editor shell's two faces, the same files feelreef.com self-hosts. Copied byte-for-byte
(2026-09-24) from the reef checkout's `apps/feelreef/node_modules` (read only); nothing re-subset.

| file | source (fontsource package @ version) | bytes | sha256 |
|---|---|---|---|
| NunitoVariable-latin.woff2 | @fontsource-variable/nunito@5.3.0 `files/nunito-latin-wght-normal.woff2` | 39128 | ba344451eab25b217a165363b1982048a5e5830a0daf36577973955a04cac793 |
| NunitoVariable-latin-ext.woff2 | @fontsource-variable/nunito@5.3.0 `files/nunito-latin-ext-wght-normal.woff2` | 35588 | 2c8d792869818ecb253a46bc3c63c7013df7aac2f69291c3c85e5cdc94160960 |
| YoungSerif-latin.woff2 | @fontsource/young-serif@5.3.0 `files/young-serif-latin-400-normal.woff2` | 26992 | 6ba68b9927ad2a640d32cbea050ffc2b5d0ae6cbaa785afe470da9d6bf0ef39f |
| YoungSerif-latin-ext.woff2 | @fontsource/young-serif@5.3.0 `files/young-serif-latin-ext-400-normal.woff2` | 17268 | 9e6eb8e5e38f9dcbab1ea58e2f30a4d6dfdb5b3bb602bfbff9305bca1d4060f6 |

Total 118,976 bytes (≈159 KB as base64 inside `serve/edit2-assets.mjs`).

Licence: SIL Open Font License 1.1 — `OFL-Nunito.txt` (The Nunito Project Authors) and
`OFL-YoungSerif.txt` (The Young Serif Project Authors), copied from each package's `LICENSE`.
Unicode ranges in `../porch-fonts.css` are fontsource's own. CJK and Korean are not shipped: they
fall through to the system stacks in `--font-body` / `--font-display-cjk`, exactly as on feelreef.
