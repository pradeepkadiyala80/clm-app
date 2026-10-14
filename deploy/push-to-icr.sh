#!/usr/bin/env bash
# =============================================================================
# push-to-icr.sh  (Part 1)
# Build the clm-app Docker image and push it to IBM Cloud Container Registry.
#
# Prerequisites:
#   - ibmcloud CLI with container-registry plugin installed
#   - Podman running
#
# Usage:
#   chmod +x deploy/push-to-icr.sh
#   ./deploy/push-to-icr.sh [--tag TAG] [--no-login]
#
# Options:
#   --tag TAG      Override the image tag (default: version from package.json)
#   --no-login     Skip ibmcloud login (useful if already logged in)
#   --help         Show this help
#
# On success writes .last_image so that ce_deploy.sh can pick up the image
# without needing to specify it manually.
# =============================================================================

set -euo pipefail

# ── Source shared config ──────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/_common.sh
source "${SCRIPT_DIR}/_common.sh"

# ── Parse args ────────────────────────────────────────────────────────────────
DO_LOGIN=true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)       IMAGE_TAG="$2"; shift ;;
    --no-login)  DO_LOGIN=false ;;
    --help|-h)   sed -n '3,21p' "$0"; exit 0 ;;
    *) error "Unknown argument: $1"; exit 1 ;;
  esac
  shift
done

# ── Derive image tag from package.json if not overridden ─────────────────────
CLM_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
if [[ "$IMAGE_TAG" == "latest" && -f "${CLM_ROOT}/package.json" ]]; then
  IMAGE_TAG="$(node -p "require('${CLM_ROOT}/package.json').version" 2>/dev/null || echo "latest")"
fi

FULL_IMAGE="${REGISTRY}/${ICR_NAMESPACE}/${IMAGE_NAME}:${IMAGE_TAG}"

# ── Prerequisites ─────────────────────────────────────────────────────────────
step "Checking prerequisites"
check_cmd ibmcloud "https://cloud.ibm.com/docs/cli"
check_cmd podman   "https://podman.io/getting-started/installation"
ensure_ibmcloud_plugin cr

# ── Step 1: Login ─────────────────────────────────────────────────────────────
if [[ "$DO_LOGIN" == true ]]; then
  step "Step 1/5 — Logging in to IBM Cloud"
  ibmcloud login -r "${CE_REGION}" --sso
  # To use an API key instead:
  #   ibmcloud login -r "${CE_REGION}" --apikey "${IBMCLOUD_API_KEY}"
  success "Logged in to IBM Cloud (region: ${CE_REGION})"
else
  step "Step 1/5 — Login skipped (--no-login)"
fi

# ── Step 2: Target resource group ────────────────────────────────────────────
# Required so that resource-group-scoped ICR namespaces are visible.
step "Step 2/5 — Targeting resource group"
if ibmcloud target -g "${CE_RESOURCE_GROUP}" &>/dev/null 2>&1; then
  success "Resource group set: ${CE_RESOURCE_GROUP}"
else
  warn "Resource group '${CE_RESOURCE_GROUP}' not found — looking up available groups..."
  default_rg=$(ibmcloud resource groups --output json 2>/dev/null \
    | python3 -c "
import sys, json
data = json.load(sys.stdin)
groups = data if isinstance(data, list) else data.get('resources', [])
for g in groups:
    if g.get('default', False):
        print(g['name']); break
else:
    if groups: print(groups[0]['name'])
" 2>/dev/null || true)
  if [[ -n "$default_rg" ]]; then
    ibmcloud target -g "${default_rg}"
    CE_RESOURCE_GROUP="$default_rg"
    warn "Using auto-detected resource group: '${CE_RESOURCE_GROUP}'"
    warn "Set CE_RESOURCE_GROUP in deploy/_common.sh or .env to remove this warning."
    success "Resource group set: ${CE_RESOURCE_GROUP}"
  else
    error "Could not determine a valid resource group."
    echo "  Run:  ibmcloud resource groups"
    echo "  Then set CE_RESOURCE_GROUP in deploy/_common.sh or .env"
    exit 1
  fi
fi

# ── Step 3: Set ICR region and authenticate ───────────────────────────────────
step "Step 3/5 — Authenticating with IBM Container Registry"
ibmcloud cr region-set "${REGISTRY}"
ibmcloud cr namespace-add "${ICR_NAMESPACE}" 2>/dev/null \
  || info "Namespace '${ICR_NAMESPACE}' already exists."
ibmcloud cr login
success "Authenticated to ${REGISTRY}"

# ── Step 4: Build ─────────────────────────────────────────────────────────────
step "Step 4/5 — Building image: ${FULL_IMAGE}"
# Code Engine runs linux/amd64; without --platform an Apple Silicon Mac builds
# arm64, which fails in CE with "exec format error". --pull=always and --no-cache
# stop podman reusing cached arm64 base images/layers with the same tag.
podman build --platform linux/amd64 --pull=always --no-cache -t "${FULL_IMAGE}" "${CLM_ROOT}"

# Check the real binaries, not image metadata: podman can label an image amd64
# while it still contains arm64 binaries from a mis-resolved base image.
ARCH="$(podman run --rm --pull=never --platform linux/amd64 --entrypoint uname "${FULL_IMAGE}" -m 2>/dev/null | tail -1)"
if [[ "$ARCH" != "x86_64" ]]; then
  error "Image binaries are '${ARCH}', expected 'x86_64'. Aborting before push."
  exit 1
fi
success "Image built: ${FULL_IMAGE}"

# ── Step 5: Push ──────────────────────────────────────────────────────────────
step "Step 5/5 — Pushing to IBM Cloud Container Registry"
podman push "${FULL_IMAGE}"
success "Image pushed: ${FULL_IMAGE}"

# ── Write .last_image for ce_deploy.sh ───────────────────────────────────────
echo "${FULL_IMAGE}" > "${CLM_ROOT}/.last_image"
info "Wrote .last_image → ${FULL_IMAGE}"

# ── Verify ────────────────────────────────────────────────────────────────────
echo ""
ibmcloud cr images --restrict "${ICR_NAMESPACE}"

echo ""
echo -e "${GREEN}${BOLD}✅  Done! Your image is available at:${RESET}"
echo -e "    ${BOLD}${FULL_IMAGE}${RESET}"
echo ""
echo -e "  Run ${BOLD}./deploy/ce_deploy.sh${RESET} to deploy to Code Engine."
echo ""
