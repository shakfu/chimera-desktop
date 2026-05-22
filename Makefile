# chimera-desktop Makefile.
#
# Wraps npm + cargo + tauri commands for the common dev/build/clean loops.
# All targets are `.PHONY`; nothing builds based on file timestamps because
# the underlying tools (vite, cargo) already do their own dependency tracking.

.PHONY: help install dev vite-dev build tauri-build tauri-build-debug \
        check svelte-check cargo-check format \
        sidecar sidecar-from sidecar-clean \
        run \
        clean clean-deps clean-build clean-binaries \
        rebase-doc

# ---- Configuration --------------------------------------------------------

# Path to a chimera build to copy as the bundled sidecar. Defaults to the
# sibling chimera repo's CPU/Metal release build.
CHIMERA_BUILD ?= $(HOME)/projects/personal/chimera/build/chimera

# Host target triple (Tauri expects the bundled sidecar to be suffixed with
# this). Resolved from rustc; override with `make TARGET_TRIPLE=...` for
# cross-bundling experiments.
TARGET_TRIPLE ?= $(shell rustc -vV 2>/dev/null | sed -n 's/^host: //p')

# Model used by `make run`. Defaults to the symlinked models/ directory
# (see README) — override with `make MODEL=/abs/path/model.gguf run`.
MODEL ?= models/Llama-3.2-1B-Instruct-Q8_0.gguf

# Where Tauri expects the bundled sidecar binaries.
BINARIES_DIR := src-tauri/binaries

# ---- Help -----------------------------------------------------------------

help:
	@echo "chimera-desktop targets:"
	@echo ""
	@echo "  setup:"
	@echo "    install              npm install"
	@echo "    sidecar              copy \$$CHIMERA_BUILD into $(BINARIES_DIR)/ with the host triple"
	@echo "    sidecar-from FROM=…  copy from an arbitrary chimera binary path"
	@echo ""
	@echo "  development:"
	@echo "    dev                  npm run tauri dev  (full app + sidecar)"
	@echo "    vite-dev             npm run dev        (frontend only, no Tauri shell)"
	@echo "    run                  set CHIMERA_DESKTOP_MODEL=\$$MODEL, then dev"
	@echo ""
	@echo "  build:"
	@echo "    build                npm run build      (vite static bundle -> build/)"
	@echo "    tauri-build          npm run tauri build (signed release bundle, slow)"
	@echo "    tauri-build-debug    npm run tauri build --debug (faster, unsigned)"
	@echo ""
	@echo "  validate:"
	@echo "    check                svelte-check + cargo check"
	@echo "    svelte-check         frontend type check only"
	@echo "    cargo-check          Rust shell type check only"
	@echo ""
	@echo "  housekeeping:"
	@echo "    clean                clean-deps + clean-build + clean-binaries"
	@echo "    clean-deps           rm node_modules, package-lock.json"
	@echo "    clean-build          rm build/, .svelte-kit/, src-tauri/target/"
	@echo "    clean-binaries       rm $(BINARIES_DIR)/chimera-*"
	@echo ""
	@echo "  variables (override on the command line):"
	@echo "    CHIMERA_BUILD = $(CHIMERA_BUILD)"
	@echo "    TARGET_TRIPLE = $(TARGET_TRIPLE)"
	@echo "    MODEL         = $(MODEL)"

# ---- Setup ----------------------------------------------------------------

install:
	npm install

# sidecar: copy the configured CHIMERA_BUILD into src-tauri/binaries/ with
# the target-triple suffix Tauri's bundle.externalBin expects. Idempotent.
sidecar:
	@if [ ! -x "$(CHIMERA_BUILD)" ]; then \
		echo "error: CHIMERA_BUILD=$(CHIMERA_BUILD) is not executable"; \
		echo "       build chimera first (cd ~/projects/personal/chimera && make build)"; \
		echo "       or pass CHIMERA_BUILD=/abs/path/to/chimera"; \
		exit 1; \
	fi
	@if [ -z "$(TARGET_TRIPLE)" ]; then \
		echo "error: could not detect TARGET_TRIPLE from rustc"; \
		echo "       pass TARGET_TRIPLE=aarch64-apple-darwin (or similar)"; \
		exit 1; \
	fi
	mkdir -p $(BINARIES_DIR)
	cp $(CHIMERA_BUILD) $(BINARIES_DIR)/chimera-$(TARGET_TRIPLE)
	@echo "staged: $(BINARIES_DIR)/chimera-$(TARGET_TRIPLE)"

# sidecar-from: stage from an arbitrary path. Usage:
#   make sidecar-from FROM=/Users/sa/builds/chimera-cuda
sidecar-from:
	@$(MAKE) sidecar CHIMERA_BUILD=$(FROM)

# ---- Development ----------------------------------------------------------

dev:
	npm run tauri dev

vite-dev:
	npm run dev

run:
	@if [ ! -e "$(MODEL)" ]; then \
		echo "error: MODEL=$(MODEL) does not exist"; \
		echo "       create the models symlink (see README) or pass MODEL=/abs/path"; \
		exit 1; \
	fi
	CHIMERA_DESKTOP_MODEL=$(abspath $(MODEL)) npm run tauri dev

# ---- Build ----------------------------------------------------------------

build:
	npm run build

tauri-build:
	npm run tauri build

tauri-build-debug:
	npm run tauri build -- --debug

# ---- Validation -----------------------------------------------------------

check: svelte-check cargo-check

svelte-check:
	npm run check

cargo-check:
	cd src-tauri && cargo check

# ---- Cleaning -------------------------------------------------------------

clean: clean-deps clean-build clean-binaries

clean-deps:
	rm -rf node_modules package-lock.json

clean-build:
	rm -rf build .svelte-kit src-tauri/target

clean-binaries:
	rm -f $(BINARIES_DIR)/chimera-*

# ---- Docs -----------------------------------------------------------------

# rebase-doc: print the path to the upstream rebase recipe. Not auto-run
# because re-pulling upstream is destructive (overwrites local patches);
# follow the procedure in the doc manually.
rebase-doc:
	@echo "docs/upstream-rebase.md  -- follow procedure in § 5"
