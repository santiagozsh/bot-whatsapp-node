# Platform Roadmap

> Operational direction for this project. The bot is real business software (Luxury Gotti
> bookkeeping automation); this roadmap hardens it into a production-grade system while building
> the owner's DevOps/SRE portfolio on top of a live application.

**Tracker:** work in this roadmap is tracked on GitHub Issues with the `platform:*` label prefix.
Extraction-accuracy feature work lives separately under `wayfinder:*` (see issue #11).

---

## Current state (August 2026)

- Runs on a friend's machine over SSH, supervised by **pm2** (basic config)
- Docker artifacts just landed (`Dockerfile`, `docker-compose.yml`) — not yet the runtime
- **No alerting** when the process dies · **no resource monitoring** · **no backups**
- Deploys are manual: SSH → pull → build → restart
- Tests: none (`npm test` is a stub) · Chat context and open transactions live in RAM

## Goals

1. Protect real business data — Google Sheets rows are money records
2. Know within minutes when anything breaks
3. Make deploys boring and reversible
4. Grow demonstrable infrastructure skills on a production system that matters

## Phases

| # | Phase | Deliverable | Skills evidenced |
|---|-------|-------------|------------------|
| 0 | **Containerize & harden** | Image builds reliably; compose with volumes for `auth_info/` + SQLite; healthcheck; runs under pm2 or container as decided | Docker, persistent state, image hygiene |
| 1 | **CI/CD** | GitHub Actions: typecheck → tests → build → registry → deploy | Pipelines, versioned images, automation |
| 2 | **Observability** | `/metrics` endpoint, Prometheus/Grafana/Loki (or Grafana Cloud free), dead man's switch alerting | SRE fundamentals, SLOs ("99% of receipts processed < 5 min") |
| 3 | **Cloud + IaC** | Terraform against a budget VPS; modules, remote state, automated backups, documented restore drill | IaC, networking basics, DR |
| 4 | **Kubernetes** | k3s on the same VPS: Secrets, Ingress + cert-manager, GitOps via Argo CD/Flux | k8s real-world, without managed-k8s cost |
| 5 | **SRE practices** | Runbooks, written postmortems (e.g., Baileys rc13→rc14 incident), backup-restore drills, image scanning (Trivy), secrets handling (SOPS) | Operational judgment — what most portfolios lack |

## Principles

- **Small diffs.** No big-bang rewrites; every change revertable.
- **Tests before refactors.** Extraction fixes (wayfinder map) ship with tests.
- **English for everything public** (ADR 0002); Spanish stays for domain strings.
- **Operate, don't just build.** Each phase ends with something broken-and-recovered on purpose,
  documented.

## Next actions

See open issues labeled `platform:*`. Suggested first three, blockers-first:
backups → dead man's switch → deploy script.
