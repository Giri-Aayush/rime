# syntax=docker/dockerfile:1
#
# Rime — Zcash FROST treasury — container image.
#
# ─────────────────────────────────────────────────────────────────────────────
#  ⚠️  THIS IS A LONG BUILD (tens of minutes, cold).  It compiles the Zcash
#      Foundation's FROST reference tooling AND zcash-devtool from source, plus
#      the Rime Rust workspace, plus a Next.js static export. The zcash/frost
#      Rust dependency graph is large; expect a heavy first build. Use
#      BuildKit's cache mounts (enabled by the `# syntax` line above) so repeat
#      builds only recompile what changed.
#
#  SECURITY: this image contains ONLY code and public assets. It NEVER contains
#      anything from runtime/ — that directory holds cleartext FROST key shares,
#      the watch-only wallet, and TLS keys, and is mounted at run time (see
#      docker-compose.yml). runtime/ is excluded via .dockerignore; do not COPY
#      it in and do not bake key material into any layer.
# ─────────────────────────────────────────────────────────────────────────────

########################################################################
# Stage 1 — rust-builder                                               #
#   Compiles the ZF reference tools (frost-client, frostd, zcash-sign  #
#   from ZcashFoundation/frost-tools; zcash-devtool from zcash) and    #
#   the Rime workspace binaries (rime-server, rime-signer, rime-repair)#
########################################################################
# Pinned toolchain for reproducibility. Bump this if an upstream crate
# raises its MSRV and the build complains about the Rust version.
FROM rust:1.85-bookworm AS rust-builder

# Native build dependencies for the zcash/frost dependency graph:
#   - build-essential / clang / cmake : C/C++ deps (aws-lc-rs used by rustls,
#     bundled SQLite via rusqlite, ring, etc.)
#   - protobuf-compiler (protoc)      : zcash-devtool's lightwalletd gRPC (tonic/prost)
#   - pkg-config / libssl-dev / perl  : misc *-sys crates
#   - git                             : cargo installs the tools straight from git
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        pkg-config \
        cmake \
        clang \
        libclang-dev \
        protobuf-compiler \
        libssl-dev \
        perl \
        git \
    && rm -rf /var/lib/apt/lists/*

# --- ZF FROST reference tools -------------------------------------------------
# These are the exact binaries rime-server shells out to (see rime-server/src/
# pipeline.rs and recovery.rs) and that the scripts/ pipeline drives. Installed
# into $CARGO_HOME/bin (=/usr/local/cargo/bin) so they land on PATH.
#
# frost-client / frostd / zcash-sign all live in the frost-tools workspace, so a
# single `cargo install --git` names all three packages. `--locked` honors the
# upstream Cargo.lock for reproducibility — drop it if that repo ships no
# lockfile or if resolution fails.
#
# The BuildKit cache mounts keep the git checkout and the cargo registry warm
# across builds — critical given how heavy this compile is.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    cargo install --locked --git https://github.com/ZcashFoundation/frost-tools \
        frost-client frostd zcash-sign

# zcash-devtool builds the PCZTs and drives the watch-only wallet / broadcast.
# It lives in its own repo. If the default package/bin resolution ever changes
# upstream, pin with `--bin zcash-devtool` and/or a `--rev`/`--tag`.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    cargo install --locked --git https://github.com/zcash/zcash-devtool zcash-devtool

# --- Rime workspace -----------------------------------------------------------
# Copy the workspace manifests and member crates, then build the release bins.
# (.dockerignore keeps target/, runtime/, node_modules, etc. out of context.)
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY rime-server rime-server
COPY rime-signer rime-signer
COPY rime-repair rime-repair
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked \
    # Cache mounts don't survive into later stages, so copy the bins out of the
    # cached target/ dir to a plain path the runtime stage can COPY from.
    && mkdir -p /out \
    && cp target/release/rime-server target/release/rime-signer target/release/rime-repair /out/

########################################################################
# Stage 2 — frontend-builder                                           #
#   Builds the Next.js static export (frontend/out) that rime-server   #
#   serves. output: "export" + images.unoptimized (see next.config.ts).#
########################################################################
FROM node:22-bookworm-slim AS frontend-builder

# CI keeps pnpm/next non-interactive; disable Next telemetry in the build.
ENV CI=true
ENV NEXT_TELEMETRY_DISABLED=1

# pnpm 10 (the repo's pnpm-workspace.yaml uses v10-only keys). Installed
# globally to avoid corepack dist-tag ambiguity. Match the major to the one
# that produced pnpm-lock.yaml.
RUN npm install -g pnpm@10

WORKDIR /app/frontend

# Install deps against the lockfile first for layer caching.
#
# THE SHARP QUIRK: `sharp` (and `unrs-resolver`) ship native build scripts.
# pnpm 10 does NOT run dependency build scripts by default — it just prints
# "Ignored build scripts: sharp, unrs-resolver" and continues (the repo's
# pnpm-workspace.yaml also lists them under ignoredBuiltDependencies). That is
# exactly what we want: the static export sets images.unoptimized, so sharp is
# never needed, and its unbuilt native binding must NOT block the install.
# Both packages fall back to prebuilt platform binaries, so the build still runs.
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml frontend/.npmrc ./
RUN pnpm install --frozen-lockfile

# Copy the rest of the frontend source and produce the static export.
# (.dockerignore keeps frontend/node_modules, frontend/out and frontend/.next
# out of the build context, so this is a clean rebuild.)
COPY frontend/ ./
RUN pnpm build   # → /app/frontend/out

########################################################################
# Stage 3 — runtime                                                    #
#   Slim image with every binary on PATH, the scripts/, the built      #
#   frontend, and the vanilla web/ fallback UI. NO key material.       #
########################################################################
FROM debian:bookworm-slim AS runtime

# Runtime-only packages:
#   - ca-certificates : TLS to lightwalletd (zec.rocks) and Discord webhooks
#   - openssl         : scripts/05_frostd_tls.sh generates the frostd cert with it
#   - bash            : the scripts/ pipeline is bash
#   - curl            : container healthcheck against /api/health
# The Rust binaries link rustls (no system OpenSSL needed at run time).
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        openssl \
        bash \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ZF reference tools + Rime binaries, all onto PATH.
COPY --from=rust-builder /usr/local/cargo/bin/frost-client   /usr/local/bin/
COPY --from=rust-builder /usr/local/cargo/bin/frostd         /usr/local/bin/
COPY --from=rust-builder /usr/local/cargo/bin/zcash-sign     /usr/local/bin/
COPY --from=rust-builder /usr/local/cargo/bin/zcash-devtool  /usr/local/bin/
COPY --from=rust-builder /out/rime-server /usr/local/bin/
COPY --from=rust-builder /out/rime-signer /usr/local/bin/
COPY --from=rust-builder /out/rime-repair /usr/local/bin/

# The immutable script contract (init + signing pipeline), the built Next.js
# export, and the vanilla fallback UI. rime-server resolves the web root at
# runtime: frontend/out if present, else web/ (override with RIME_WEB_DIR).
COPY scripts ./scripts
COPY web ./web
COPY --from=frontend-builder /app/frontend/out ./frontend/out

# NOTE: runtime/ is intentionally absent. It is a mount (docker-compose.yml) and
# holds cleartext shares + wallet + TLS keys. rime-server creates it on boot if
# missing and reads runtime/rime-server.toml + runtime/rime.db relative to /app.

# 8787 = rime-server HTTP UI/API.  2744 = frostd coordination server.
EXPOSE 8787 2744

# Default process is the web/workflow server. The frostd service overrides this
# with its own command; the init service overrides the entrypoint.
CMD ["rime-server"]
