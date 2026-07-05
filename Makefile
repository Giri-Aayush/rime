# Rime — Zcash FROST treasury — developer & operator shortcuts.
#
# Two ways to run Rime:
#   • Local (no Docker):  make tools → make keygen → make config → make demo
#   • Docker:             make docker-init → make config → make up
#
# See SETUP.md for the full walkthrough, funding, and the multi-device demo.
#
# Override defaults on the command line, e.g.:  make demo RIME_NET=main

# ── Configuration (override on the CLI or in your shell) ─────────────────────
RIME_NET           ?= test                       # test | main
RIME_BIND          ?= 127.0.0.1:8787             # loopback for `make server`
RIME_SERVER_CONFIG ?= runtime/rime-server.toml
SSL_CERT_FILE      ?= runtime/tls/ca.crt

# Env block shared by the local server targets.
SERVER_ENV = RIME_NET=$(RIME_NET) \
             RIME_SERVER_CONFIG=$(RIME_SERVER_CONFIG) \
             SSL_CERT_FILE=$(SSL_CERT_FILE)

.DEFAULT_GOAL := help
.PHONY: help tools keygen config frontend frostd server demo up down docker-init logs clean

help: ## Show this help.
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-13s\033[0m %s\n", $$1, $$2}'

# ── Local (no Docker) ────────────────────────────────────────────────────────

tools: ## cargo install the ZF FROST tools + build the Rime workspace (LONG first build).
	# The exact binaries rime-server shells out to. frost-client/frostd/zcash-sign
	# share the frost-tools workspace; zcash-devtool is its own repo.
	cargo install --locked --git https://github.com/ZcashFoundation/frost-tools frost-client frostd zcash-sign
	cargo install --locked --git https://github.com/zcash/zcash-devtool zcash-devtool
	cargo build --release

keygen: ## One-time init: TLS + 2-of-3 keygen + treasury address + watch-only wallet.
	# Drives scripts/bringup.sh (05 → 10 → 20 → 30). Writes only under runtime/.
	RIME_NET=$(RIME_NET) bash scripts/bringup.sh

config: ## Create runtime/rime-server.toml from the example (then fill in the values).
	@mkdir -p runtime
	@if [ -f runtime/rime-server.toml ]; then \
	  echo "runtime/rime-server.toml already exists — leaving it untouched"; \
	else \
	  cp rime-server/config.example.toml runtime/rime-server.toml; \
	  echo "wrote runtime/rime-server.toml — now set: network, group, treasury_address,"; \
	  echo "each signer pubkey, and replace every token = \"CHANGE-ME\" (see SETUP.md)."; \
	fi

frontend: ## Build the Next.js static export (frontend/out) that the server serves.
	# pnpm 10 skips native build scripts (sharp) by default — non-fatal, and the
	# export sets images.unoptimized so sharp is never needed.
	cd frontend && pnpm install --frozen-lockfile && pnpm build

frostd: ## Run the frostd coordination server (needs runtime/tls; use its own terminal).
	frostd -i 127.0.0.1 -p 2744 -c runtime/tls/server.crt -k runtime/tls/server.key

server: ## Run rime-server on loopback. Needs `make tools`, runtime/rime-server.toml, and frostd running.
	$(SERVER_ENV) RIME_BIND=$(RIME_BIND) cargo run --release -p rime-server

demo: frontend ## Build the UI + run the server bound to 0.0.0.0 for the multi-device demo.
	# Phones on the same wifi open http://<mac-lan-ip>:8787/?signer=alice|bob|carol.
	# Start `make frostd` in another terminal first for full signing ceremonies.
	$(SERVER_ENV) RIME_BIND=0.0.0.0:8787 cargo run --release -p rime-server

# ── Docker ───────────────────────────────────────────────────────────────────

docker-init: ## docker compose one-shot init (TLS + keygen + address + wallet) — run ONCE.
	docker compose run --rm init

up: ## docker compose: build on first run, then start frostd + rime-server (detached).
	docker compose up -d

down: ## docker compose: stop and remove the containers (runtime/ volume persists).
	docker compose down

logs: ## docker compose: follow the service logs.
	docker compose logs -f

# ── Housekeeping ─────────────────────────────────────────────────────────────

clean: ## Remove build artifacts (target/, frontend/out, frontend/.next). NEVER touches runtime/.
	cargo clean
	rm -rf frontend/out frontend/.next
	@echo "runtime/ left intact — it holds your keys. Remove it by hand only if you truly mean to."
