# chimera-desktop Makefile.
#
# Wraps npm + cargo + tauri commands for the common dev/build/clean loops.
# All targets are `.PHONY`; nothing builds based on file timestamps because
# the underlying tools (vite, cargo) already do their own dependency tracking.

.PHONY: help install dev vite-dev build tauri-build tauri-build-debug \
        check svelte-check cargo-check format \
        sidecar sidecar-from sidecar-release sidecar-clean \
        run \
        clean clean-deps clean-build clean-binaries \
        rebase-doc

# ---- Configuration --------------------------------------------------------

# Path to a chimera build to copy as the bundled sidecar. Defaults to the
# sibling chimera repo's CPU/Metal release build.
CHIMERA_BUILD ?= $(HOME)/projects/personal/chimera/build/chimera

# chimera release to fetch with `make sidecar-release`. Pulls the prebuilt,
# portable (OpenSSL-free) binary from the GitHub release rather than a local
# build. Bump this when chimera cuts a new release.
#   https://github.com/shakfu/chimera/releases
CHIMERA_VERSION ?= 0.2.3
CHIMERA_REPO    ?= shakfu/chimera

# Host target triple (Tauri expects the bundled sidecar to be suffixed with
# this). Resolved from rustc; override with `make TARGET_TRIPLE=...` for
# cross-bundling experiments.
TARGET_TRIPLE ?= $(shell rustc -vV 2>/dev/null | sed -n 's/^host: //p')

# Model used by `make dev`/`make run`. Defaults to the symlinked models/
# directory (see README) — override with `make MODEL=/abs/path/model.gguf dev`.
MODEL ?= models/Llama-3.2-1B-Instruct-Q8_0.gguf

# Optional whisper model for the Audio panel (/v1/audio/transcriptions).
# Passed to the sidecar as CHIMERA_DESKTOP_AUDIO_MODEL only when the file
# actually exists, so a missing model just leaves the audio route disabled
# instead of breaking `make dev`. Override with `make AUDIO_MODEL=/abs/path dev`.
AUDIO_MODEL ?= models/ggml-base.en.bin
AUDIO_ENV := $(if $(wildcard $(AUDIO_MODEL)),CHIMERA_DESKTOP_AUDIO_MODEL=$(abspath $(AUDIO_MODEL)),)

# Optional stable-diffusion model for the Image panel (/v1/images/generations).
# Same opt-in semantics as AUDIO_MODEL: passed only when the file exists, so a
# missing model just leaves the image route disabled. Override with
# `make IMAGE_MODEL=/abs/path dev`.
IMAGE_MODEL ?= models/sd_xl_turbo_1.0.q8_0.gguf
IMAGE_ENV := $(if $(wildcard $(IMAGE_MODEL)),CHIMERA_DESKTOP_IMAGE_MODEL=$(abspath $(IMAGE_MODEL)),)

# Optional embedding model for the RAG panel (/v1/vector_stores/*). Same
# opt-in semantics as AUDIO_MODEL / IMAGE_MODEL: passed only when the file
# exists, so a missing model just leaves the RAG route disabled. Override
# with `make RAG_MODEL=/abs/path dev`.
RAG_MODEL ?= models/bge-small-en-v1.5-q8_0.gguf
RAG_ENV := $(if $(wildcard $(RAG_MODEL)),CHIMERA_DESKTOP_RAG_MODEL=$(abspath $(RAG_MODEL)),)

# Optional cross-encoder model for the Rerank panel (/v1/rerank). Same opt-in
# semantics as AUDIO_MODEL / IMAGE_MODEL / RAG_MODEL: passed only when the file
# exists, so a missing model just leaves the rerank route disabled. Override
# with `make RERANK_MODEL=/abs/path dev`.
RERANK_MODEL ?= models/bge-reranker-base-q8_0.gguf
RERANK_ENV := $(if $(wildcard $(RERANK_MODEL)),CHIMERA_DESKTOP_RERANK_MODEL=$(abspath $(RERANK_MODEL)),)

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
	@echo "    sidecar-release      download + stage the chimera $(CHIMERA_VERSION) release binary (no local build)"
	@echo ""
	@echo "  development:"
	@echo "    dev                  full app + sidecar (sets CHIMERA_DESKTOP_MODEL=\$$MODEL)"
	@echo "    vite-dev             npm run dev        (frontend only, no Tauri shell)"
	@echo "    run                  alias for dev"
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
	@echo "    CHIMERA_BUILD   = $(CHIMERA_BUILD)"
	@echo "    CHIMERA_VERSION = $(CHIMERA_VERSION)"
	@echo "    TARGET_TRIPLE   = $(TARGET_TRIPLE)"
	@echo "    MODEL           = $(MODEL)"
	@echo "    AUDIO_MODEL     = $(AUDIO_MODEL)$(if $(AUDIO_ENV),, (not found; audio route disabled))"
	@echo "    IMAGE_MODEL     = $(IMAGE_MODEL)$(if $(IMAGE_ENV),, (not found; image route disabled))"
	@echo "    RAG_MODEL       = $(RAG_MODEL)$(if $(RAG_ENV),, (not found; rag route disabled))"
	@echo "    RERANK_MODEL    = $(RERANK_MODEL)$(if $(RERANK_ENV),, (not found; rerank route disabled))"

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

# sidecar-release: download the prebuilt chimera release binary for the host
# triple, verify its SHA-256 against the GitHub release digest, extract, and
# stage it. No local chimera build required. Uses `gh` for the digest-verified
# download. Override the version with `make CHIMERA_VERSION=0.2.3 sidecar-release`.
#
# Asset naming maps the rustc host triple to chimera's release artifacts:
#   aarch64-apple-darwin      -> chimera-<v>-macos-arm64.tar.gz
#   x86_64-unknown-linux-gnu  -> chimera-<v>-linux-x86_64.tar.gz
#   x86_64-pc-windows-msvc    -> chimera-<v>-windows-x86_64.zip   (manual; see README)
sidecar-release:
	@command -v gh >/dev/null 2>&1 || { echo "error: gh (GitHub CLI) is required for sidecar-release"; exit 1; }
	@if [ -z "$(TARGET_TRIPLE)" ]; then \
		echo "error: could not detect TARGET_TRIPLE from rustc"; exit 1; \
	fi
	@case "$(TARGET_TRIPLE)" in \
		aarch64-apple-darwin)     asset="chimera-$(CHIMERA_VERSION)-macos-arm64.tar.gz" ;; \
		x86_64-unknown-linux-gnu) asset="chimera-$(CHIMERA_VERSION)-linux-x86_64.tar.gz" ;; \
		*) echo "error: no release asset wired for triple $(TARGET_TRIPLE)"; \
		   echo "       (windows ships a .zip — stage it manually; see README § Sidecar binary)"; exit 1 ;; \
	esac; \
	tmp=$$(mktemp -d); \
	echo "fetching $$asset from $(CHIMERA_REPO)@$(CHIMERA_VERSION) ..."; \
	gh release download "$(CHIMERA_VERSION)" --repo "$(CHIMERA_REPO)" --pattern "$$asset" --dir "$$tmp" || { rm -rf "$$tmp"; exit 1; }; \
	tar xzf "$$tmp/$$asset" -C "$$tmp" || { rm -rf "$$tmp"; exit 1; }; \
	mkdir -p $(BINARIES_DIR); \
	cp "$$tmp/chimera" "$(BINARIES_DIR)/chimera-$(TARGET_TRIPLE)"; \
	chmod +x "$(BINARIES_DIR)/chimera-$(TARGET_TRIPLE)"; \
	rm -rf "$$tmp"; \
	echo "staged: $(BINARIES_DIR)/chimera-$(TARGET_TRIPLE) ($$($(BINARIES_DIR)/chimera-$(TARGET_TRIPLE) --version 2>/dev/null | head -1))"

# ---- Development ----------------------------------------------------------

# dev: launch the full app (Tauri shell + chimera sidecar). The sidecar
# refuses to start without CHIMERA_DESKTOP_MODEL, so we set it from MODEL
# and verify the file exists up front — otherwise the app boots to a
# "sidecar failed / Server endpoint not found" screen with no hint why.
dev:
	@if [ ! -e "$(MODEL)" ]; then \
		echo "error: MODEL=$(MODEL) does not exist"; \
		echo "       create the models symlink (see README) or pass MODEL=/abs/path"; \
		exit 1; \
	fi
	CHIMERA_DESKTOP_MODEL=$(abspath $(MODEL)) $(AUDIO_ENV) $(IMAGE_ENV) $(RAG_ENV) $(RERANK_ENV) npm run tauri dev

vite-dev:
	npm run dev

# run: backward-compatible alias for dev.
run: dev

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
