# Domain Docs

How engineering skills should consume this repo's domain documentation.

## Before exploring, read these

- `GLOSSARY.md` at the repo root, or `GLOSSARY-MAP.md` if it exists; read each glossary relevant to the topic.
- `docs/adr/`; read ADRs that touch the area. In multi-context repos, also check `src/<context>/docs/adr/`.

If these files don't exist, proceed silently. The domain-modeling skill creates them lazily when domain terms or decisions are resolved.

## File structure

This is a single-context repo:

/
├── GLOSSARY.md
├── docs/adr/
└── src/

## Use the glossary's vocabulary

When output names a domain concept, use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids. If a needed concept is missing, reconsider the terminology or note the gap for domain modeling.

## Flag ADR conflicts

If output contradicts an existing ADR, surface it explicitly rather than silently overriding it.
