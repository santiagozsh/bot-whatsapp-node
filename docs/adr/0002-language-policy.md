# 0002 — Language policy: English for public artifacts, Spanish for private ones

**Status:** accepted

**Context:** The repository is public and doubles as the owner's professional portfolio
(DevOps/SRE direction). Historically, commits, code identifiers, comments, and documentation
mixed Spanish and English arbitrarily. This reduces readability for an international audience
and produces slightly worse AI-assisted output, since models have far more training data on
English technical text. The owner is a native Spanish speaker — producing prose directly in
English has high friction.

**Decision:** Language follows audience, not habit:

| Artifact | Language |
|----------|----------|
| Commit messages | English |
| README, public docs (`docs/*.md`), ADRs | English |
| GitHub issues | English |
| Roadmap | English |
| New code identifiers and comments | English |
| Internal notes (`docs/internal/`, gitignored) | Spanish |
| OpenAI prompts and domain strings (`'nequi'`, `'consignación'`, …) | Spanish — permanently; they process real Spanish-language input |
| Conversations with AI assistants | Any (Spanish preferred); outputs follow the table above |

Existing Spanish code identifiers are **not** renamed in a big-bang change; they migrate to
English as files are touched naturally.

**Consequences:**
- All new commits, public docs, and issues are written in English from now on.
- `docs/architecture.md` exists in two versions: English (tracked) and Spanish
  (`docs/internal/arquitectura.es.md`, gitignored, owner-only).
- Translating domain strings would break functionality — they stay in Spanish by design.
- Agents must follow this policy in every session without being reminded.
