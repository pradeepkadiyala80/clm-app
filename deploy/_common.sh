#!/usr/bin/env bash
# =============================================================================
# _common.sh — Shared configuration and helpers for clm-app deploy scripts.
# Source this file; do not execute it directly.
#
# Override any value by setting it in clm-app/.env (preferred) or as an
# environment variable before running the script.
# =============================================================================

# ── Colours ───────────────────────────────────────────────────────────────────
BOLD="\033[1m"; RESET="\033[0m"
GREEN="\033[0;32m"; YELLOW="\033[0;33m"; RED="\033[0;31m"; CYAN="\033[0;36m"

info()    { echo -e "${CYAN}ℹ  $*${RESET}"; }
success() { echo -e "${GREEN}✔  $*${RESET}"; }
warn()    { echo -e "${YELLOW}⚠  $*${RESET}"; }
error()   { echo -e "${RED}✖  $*${RESET}" >&2; }
step()    { echo -e "\n${BOLD}── $* ──${RESET}"; }

# ── Load .env if present ──────────────────────────────────────────────────────
_ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../.env"
if [[ -f "$_ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$_ENV_FILE"; set +a
fi

# ── ICR / image configuration ─────────────────────────────────────────────────
# Public endpoint — used by push-to-icr.sh to build + push
REGISTRY="${REGISTRY:-us.icr.io}"
# Private endpoint — used by ce_deploy.sh; reachable from inside IBM Cloud
DEPLOY_REGISTRY="${DEPLOY_REGISTRY:-private.us.icr.io}"
ICR_NAMESPACE="${ICR_NAMESPACE:-clm-app}"
IMAGE_NAME="${IMAGE_NAME:-clm-app}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

# ── Code Engine configuration ─────────────────────────────────────────────────
CE_PROJECT="${CE_PROJECT:-clm}"
CE_APP_NAME="${CE_APP_NAME:-clm-app}"
CE_REGION="${CE_REGION:-us-south}"
CE_RESOURCE_GROUP="${CE_RESOURCE_GROUP:-default}"
CE_CPU="${CE_CPU:-0.5}"
CE_MEMORY="${CE_MEMORY:-2G}"
CE_MIN_SCALE="${CE_MIN_SCALE:-0}"
CE_MAX_SCALE="${CE_MAX_SCALE:-3}"


# ── Helper: assert a CLI tool is installed ────────────────────────────────────
check_cmd() {
  command -v "$1" &>/dev/null || {
    error "Required command '$1' not found. See: ${2:-}"
    exit 1
  }
}

# ── Helper: install an ibmcloud plugin if missing ─────────────────────────────
ensure_ibmcloud_plugin() {
  local plugin="$1"
  if ! ibmcloud plugin list --output json 2>/dev/null \
      | python3 -c "
import sys, json
data = json.load(sys.stdin)
# plugin list output is a list of objects or a dict with a list
items = data if isinstance(data, list) else data.get('plugins', data.get('Plugins', []))
names = [p.get('Name', p.get('name', '')) for p in items]
exit(0 if '$plugin' in names else 1)
" 2>/dev/null; then
    info "Installing ibmcloud plugin: ${plugin}"
    ibmcloud plugin install "${plugin}" -f
  fi
}
