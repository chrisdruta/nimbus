# Dev Container rules for agents

This project runs inside a hardened Dev Container. Constraints that will bite
you if ignored:

- **No root, no sudo.** The container runs as `vscode` with all capabilities
  dropped. `apt-get install` cannot work at runtime — OS packages go in the
  image via `devcontainer.json` build args or a Dev Container Feature, followed
  by a rebuild (`./.devcontainer/dev rebuild`, run on the HOST, not in here).
- **Never source `.env` into a shell.** Secrets load per-process only:
  `./.devcontainer/dev agent` / `dev run CMD` on the host, or
  `.devcontainer/harness/scripts/env-run.sh CMD` inside the container.
- **`.devcontainer/harness/` is a pinned git submodule — never edit it.**
  Project-specific behavior belongs in the project-owned files next to it:
  `devcontainer.json` (image args, mounts, features, extensions),
  `config.env` (behavior toggles), `project/post-create.sh` and
  `project/post-start.sh` (lifecycle hooks).
- **Edits to `devcontainer.json` or the Dockerfile do nothing until
  `dev rebuild`** — and that must run on the host. Say so instead of retrying
  in-container.
- **`~/.agents` is a persistent named volume** (agent logins, browser
  binaries); everything else in `$HOME` resets on rebuild. Install user-level
  tools to `~/.local/bin`.
- **Diagnostics**: `.devcontainer/harness/scripts/doctor.sh` checks the
  environment; its output from the last start is in `/tmp/dev-doctor.log`.

Reference docs live in `.devcontainer/harness/docs/` (configuration, usage,
security model, recipes).
