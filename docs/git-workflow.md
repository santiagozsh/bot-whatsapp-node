# Git Branching Strategy & Automated Release Workflow

> Operational guide and release runbook for `bot-whatsapp-node`.  
> Defines branch topologies, Conventional Commit standards, automated Semantic Versioning (SemVer 2.0.0), delivery boundaries, and instant production rollbacks.

---

## 1. Overview & Architecture

We follow a **Trunk-Based Development model with GitHub Flow pull request semantics**:
- **Trunk (`main`)**: The single protected source of truth. Direct commits are forbidden. Every merge to `main` constitutes a tested, versioned, and automatically deployed production release.
- **Short-Lived Branches**: Features, fixes, and chores live on isolated branches lasting hours to 1–2 days max.
- **Automated Gating**: CI executes on GitHub Cloud runners (`ubuntu-latest`) to validate TypeScript typing and test suites before code touches the host.
- **Zero-Touch Releases**: Semantic versions, Git tags, GitHub releases, and immutable container artifacts are generated automatically on merge from commit semantics.
- **Isolated Self-Hosted Runner**: The production server (`self-hosted`) is strictly reserved for deployment commands (`pull` and `up -d`). It never runs compilation or pull request code.

```
       [ Local Branch ]                      [ GitHub Cloud CI ]                  [ Production Server ]
 (feat/38-multiline-parser)                   (ubuntu-latest)                         (self-hosted)
            │                                        │                                      │
       git push origin ──────────────────────► PR Validation                                │
                                               - Docker multi-stage                         │
                                               - tsc --noEmit && vitest                     │
                                               - No GHCR push                               │
                                                     │                                      │
                                          [ Squash & Merge to main ]                        │
                                                     ▼                                      │
                                              CD Pipeline                                   │
                                              - Calculate SemVer via commits                │
                                              - Push GHCR :X.Y.Z & :latest                  │
                                              - gh release create vX.Y.Z                    │
                                                     │                                      │
                                                     └──────────────────────────────► Deploy Job
                                                                                      - Update .env IMAGE_TAG
                                                                                      - docker compose pull
                                                                                      - docker compose up -d (<3s)
```

---

## 2. Branch Naming Conventions

All branches must branch off an up-to-date `main` and use standard prefixes:

| Branch Pattern | Purpose | Example |
|---|---|---|
| `feat/<issue-id>-<slug>` | New features or user-facing business logic | `feat/38-multiline-parser` |
| `fix/<issue-id>-<slug>` | Bug fixes, edge case patches, timeout handling | `fix/33-socket-428-reconnect` |
| `chore/<issue-id>-<slug>` | Infrastructure, CI/CD, refactoring, dependencies | `chore/32-git-branching-release-workflow` |
| `docs/<issue-id>-<slug>` | Documentation and architectural runbooks | `docs/34-supplier-expenses-spec` |

### Branch Lifecycle Commands
```bash
# 1. Always start from latest main
git checkout main
git pull origin main

# 2. Cut a feature branch
git checkout -b feat/38-multiline-parser

# 3. Work, verify locally, and commit with Conventional Commits
npm test && npx tsc --noEmit
git commit -m "feat(parser): add multiline unit price extractor"

# 4. Push and open Pull Request
git push -u origin feat/38-multiline-parser
gh pr create --title "feat(parser): multiline product parser with unit prices (#38)" --body "Closes #38"
```

---

## 3. Conventional Commits & Automated SemVer

Version numbers are **never managed manually** in `package.json` or through `npm version`. The delivery pipeline derives the next Semantic Version (SemVer 2.0.0) automatically by analyzing commit messages since the previous Git tag.

### Commit Structure
```
<type>(<optional-scope>): <description>
```

### Bump Derivation Rules

| Commit Keyword | SemVer Bump | Example Commit | Before -> After |
|---|---|---|---|
| `fix:` or `fix(...):` | **PATCH** | `fix(whatsapp): handle socket reconnect 428 burst` | `3.2.0` -> `3.2.1` |
| `feat:` or `feat(...):` | **MINOR** | `feat(parser): add multiline product parser` | `3.2.0` -> `3.3.0` |
| `BREAKING CHANGE:` or `feat!:` | **MAJOR** | `feat!(db): drop legacy ram maps for sqlite state` | `3.2.0` -> `4.0.0` |
| `chore:`, `test:`, `docs:` | **PATCH** *(default)* | `chore(ci): update runner caching rules` | `3.2.0` -> `3.2.1` |

> **Pro Tip:** When squash-merging via the GitHub UI, ensure the **Pull Request Title** adheres to Conventional Commits (e.g. `feat(parser): multiline product pricing (#38)`). The squash commit message on `main` will determine the automatic SemVer bump.

---

## 4. CI/CD Delivery Pipeline Details

The pipeline is defined in `.github/workflows/deploy.yml`:

### Stage 1: Build, Test & Push to GHCR (`ubuntu-latest`)
1. **Full History Checkout (`fetch-depth: 0`)**: Ensures Git history and existing tags (`v3.2.0`, etc.) are available.
2. **Version Calculation (`paulhatch/semantic-version@v5.4.0`)**: Analyzes commits and outputs both `${VERSION}` (e.g., `3.3.0`) and `${TAG}` (e.g., `v3.3.0`).
3. **In-Engine Test Gating**: Docker Buildx builds the container targeting stage `runner`. The intermediate `builder` stage executes `tsc --noEmit && npm test && tsc`. Any type error or test failure aborts the run before publication.
4. **Artifact Publication**: On `main` merge, pushes two immutable references:
   - `ghcr.io/santiagozsh/bot-whatsapp-node:${VERSION}`
   - `ghcr.io/santiagozsh/bot-whatsapp-node:latest`
5. **Git Tag & GitHub Release**: Calls `gh release create "${TAG}" --generate-notes` creating the Git Tag and GitHub Release notes simultaneously.

### Stage 2: Production Deployment (`self-hosted`)
1. **Gating**: Guarded strictly by `if: github.ref == 'refs/heads/main'`. PRs never execute on the host.
2. **Persistence**: Updates `IMAGE_TAG=${VERSION}` in the server's persistent `.env` file (preventing failures if Docker restarts after a host reboot).
3. **Graceful Container Rollout**: Executes `docker compose pull` followed by `docker compose up -d --remove-orphans`.
   - The running container receives `SIGTERM`.
   - Node.js traps `SIGTERM` in `src/index.ts`, closes open database transactions, disconnects Baileys, and stops cleanly.
   - The new container binds existing persistent volumes (`./auth_info`, `./bot_memory.db`, `./google-keys.json`) and starts in **< 3 seconds**.

---

## 5. Instant Rollback Runbook (< 5 Seconds)

Because every container image tag is immutable in GHCR, rolling back to any previous version is deterministic and requires zero rebuilds.

### When to Rollback
- Critical uncaught exceptions or crash loops immediately post-deploy.
- WhatsApp socket rejection or unrecoverable credential loop.
- Accounting discrepancy in Google Sheets ingestion caused by a newly merged parser.

### Emergency Rollback Procedure
```bash
# 1. SSH into the production server
ssh jose@100.70.70.48
cd /home/jose/santiago/bot-whatsapp-node

# 2. Inspect current running state and identify the target stable version (e.g. 3.2.0)
docker compose -f docker-compose.prod.yml ps

# 3. Update IMAGE_TAG in the host environment file
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=3.2.0/" .env
export IMAGE_TAG="3.2.0"

# 4. Rollback container (uses local Docker image cache if available, or pulls from GHCR)
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d

# 5. Verify service health and real-time logs
docker compose -f docker-compose.prod.yml ps
docker logs -f --tail 50 node-bot-prod
```

### Rollback Recovery Timeline
- **Image in local cache:** Rollback duration is **~2–3 seconds**.
- **Image pulled from GHCR:** Rollback duration is **~10–15 seconds** (depending on VPS network bandwidth).
- **Zero data loss:** Session tokens (`auth_info/`) and SQLite tables (`bot_memory.db`) remain mounted on the host and untouched across container recreations.
