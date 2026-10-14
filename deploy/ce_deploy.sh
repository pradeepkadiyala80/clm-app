#!/usr/bin/env bash
# =============================================================================
# Part 2 — Create / update a Code Engine project and deploy the application
# =============================================================================
#
# Usage:
#   ./scripts/ce_deploy.sh [OPTIONS]
#
# Image options (three ways to specify the image — pick one):
#   --registry   REGISTRY     IBM CR namespace   (default: private.us.icr.io/my-namespace)
#   --image-name NAME         Image name         (default: tf-compliance-app)
#   --image-tag  TAG          Image tag          (default: latest)
#   --image      FULL_IMAGE   Override with a complete image ref, e.g.
#                             us.icr.io/my-ns/myapp:v2  (skips registry/name/tag)
#   (no flag)                 Reads .last_image written by build_push.sh
#
# Code Engine options:
#   --ce-project NAME         CE project name    (default: tf-compliance)
#   --ce-app     NAME         CE application name (default: tf-compliance-app)
#   --region     REGION       IBM Cloud region    (default: us-south)
#   --rg         GROUP        Resource group      (default: Default)
#   --cpu        CPU          vCPU per instance   (default: 0.5)
#   --memory     MEM          Memory per instance (default: 2G)
#   --min-scale  N            Min instances       (default: 0)
#   --max-scale  N            Max instances       (default: 3)
#   --yes                     Skip confirmation prompt
#   --help                    Show this help
#
# Environment variables (can also be set in .env):
#   LLM_API_KEY (required), LLM_BASE_URL, LLM_MODEL
#   REGISTRY, IMAGE_NAME, IMAGE_TAG
#   CE_PROJECT, CE_APP_NAME, CE_REGION, CE_RESOURCE_GROUP
#   CE_CPU, CE_MEMORY, CE_MIN_SCALE, CE_MAX_SCALE
# =============================================================================
set -euo pipefail

# ── Source shared config ──────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/_common.sh
source "${SCRIPT_DIR}/_common.sh"

# ── Parse args ────────────────────────────────────────────────────────────────
YES=false
OVERRIDE_IMAGE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --image)      OVERRIDE_IMAGE="$2"; shift ;;
    --registry)   REGISTRY="$2";       shift ;;
    --image-name) IMAGE_NAME="$2";     shift ;;
    --image-tag)  IMAGE_TAG="$2";      shift ;;
    --ce-project) CE_PROJECT="$2";     shift ;;
    --ce-app)     CE_APP_NAME="$2";    shift ;;
    --region)     CE_REGION="$2";      shift ;;
    --rg)         CE_RESOURCE_GROUP="$2"; shift ;;
    --cpu)        CE_CPU="$2";         shift ;;
    --memory)     CE_MEMORY="$2";      shift ;;
    --min-scale)  CE_MIN_SCALE="$2";   shift ;;
    --max-scale)  CE_MAX_SCALE="$2";   shift ;;
    --yes|-y)     YES=true ;;
    --help|-h)
      sed -n '3,35p' "$0"
      exit 0 ;;
    *) error "Unknown argument: $1"; exit 1 ;;
  esac
  shift
done

# ── Resolve image reference ───────────────────────────────────────────────────
# ce_deploy.sh always uses the PRIVATE endpoint (reachable inside IBM Cloud).
# Priority: --image flag  >  .last_image file  >  DEPLOY_REGISTRY/IMAGE_NAME:IMAGE_TAG
LAST_IMAGE_FILE="${SCRIPT_DIR}/../.last_image"
if [[ -n "$OVERRIDE_IMAGE" ]]; then
  DEPLOY_IMAGE="$OVERRIDE_IMAGE"
  info "Using image from --image flag: ${DEPLOY_IMAGE}"
elif [[ -f "$LAST_IMAGE_FILE" ]]; then
  # .last_image was written by build_push.sh with the public endpoint.
  # Swap it to the private endpoint for CE.
  RAW_IMAGE="$(cat "$LAST_IMAGE_FILE")"
  DEPLOY_IMAGE="${RAW_IMAGE/us.icr.io/private.us.icr.io}"
  info "Using image (private endpoint): ${DEPLOY_IMAGE}"
else
  DEPLOY_IMAGE="${DEPLOY_REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"
  warn "No .last_image found — using: ${DEPLOY_IMAGE}"
fi

# ── Prerequisites ─────────────────────────────────────────────────────────────
step "Checking prerequisites"
check_cmd ibmcloud "https://cloud.ibm.com/docs/cli"
ensure_ibmcloud_plugin ce
ensure_ibmcloud_plugin cr

# ── Confirm ───────────────────────────────────────────────────────────────────
step "Deploy configuration"
echo -e "  Image          : ${BOLD}${DEPLOY_IMAGE}${RESET}"
echo -e "  CE Project     : ${BOLD}${CE_PROJECT}${RESET}"
echo -e "  CE App name    : ${BOLD}${CE_APP_NAME}${RESET}"
echo -e "  Region         : ${BOLD}${CE_REGION}${RESET}"
echo -e "  Resource Group : ${BOLD}${CE_RESOURCE_GROUP}${RESET}"
echo -e "  CPU / Memory   : ${BOLD}${CE_CPU} / ${CE_MEMORY}${RESET}"
echo -e "  Scale          : ${BOLD}${CE_MIN_SCALE}–${CE_MAX_SCALE} instances${RESET}"
echo ""
if [[ "$YES" != true ]]; then
  read -r -p "Deploy to Code Engine? [y/N] " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || { info "Aborted."; exit 0; }
fi

# ── Step 1: Target region + resource group ────────────────────────────────────
step "Step 1/3 — Targeting IBM Cloud"

# Target the region first (always works)
ibmcloud target -r "${CE_REGION}"
success "Targeted region: ${CE_REGION}"

# Resolve the resource group — try the configured name first, then auto-detect
_resolve_resource_group() {
  # Try the configured name exactly
  if ibmcloud target -g "${CE_RESOURCE_GROUP}" &>/dev/null 2>&1; then
    success "Resource group set: ${CE_RESOURCE_GROUP}"
    return 0
  fi

  warn "Resource group '${CE_RESOURCE_GROUP}' not found — looking up available groups..."
  echo ""
  echo "  Your resource groups:"
  ibmcloud resource groups 2>/dev/null || true
  echo ""

  # Try to find the default resource group automatically
  local default_rg
  default_rg=$(ibmcloud resource groups --output json 2>/dev/null \
    | python3 -c "
import sys, json
groups = json.load(sys.stdin).get('resources', [])
for g in groups:
    if g.get('default', False):
        print(g['name'])
        break
# Fallback: print first group
if groups:
    print(groups[0]['name'])
" 2>/dev/null || true)

  if [[ -n "$default_rg" ]]; then
    warn "Using auto-detected resource group: '${default_rg}'"
    warn "Update CE_RESOURCE_GROUP in scripts/_common.sh to remove this warning."
    ibmcloud target -g "${default_rg}"
    CE_RESOURCE_GROUP="$default_rg"
    success "Resource group set: ${CE_RESOURCE_GROUP}"
  else
    error "Could not determine a valid resource group."
    echo "  Run:  ibmcloud resource groups"
    echo "  Then set CE_RESOURCE_GROUP in scripts/_common.sh or .env"
    exit 1
  fi
}

_resolve_resource_group
success "Targeted region=${CE_REGION} resource-group=${CE_RESOURCE_GROUP}"

# ── Step 2: Select or create CE project ──────────────────────────────────────
step "Step 2/4 — Code Engine project"
if ibmcloud ce project select --name "${CE_PROJECT}" 2>/dev/null; then
  success "Selected existing project: ${CE_PROJECT}"
else
  info "Project '${CE_PROJECT}' not found — creating it..."
  ibmcloud ce project create --name "${CE_PROJECT}"
  ibmcloud ce project select --name "${CE_PROJECT}"
  success "Created and selected project: ${CE_PROJECT}"
fi

# ── Step 3: Create or update application ─────────────────────────────────────
step "Step 3/3 — Application: ${CE_APP_NAME}"

CE_ENV_FLAGS=(
  "--env" "LLM_API_KEY=${LLM_API_KEY}"
  "--env" "LLM_BASE_URL=${LLM_BASE_URL}"
  "--env" "LLM_MODEL=${LLM_MODEL}"
)

# Resolve the CE-managed registry secret for private.us.icr.io.
# The console calls this "Code Engine managed secret"; the CLI name is
# ce-auto-icr-private-<region>. Look it up dynamically so it works in any region.
_resolve_ce_registry_secret() {
  local secret
  secret=$(ibmcloud ce registry list --output json 2>/dev/null \
    | python3 -c "
import sys, json
items = json.load(sys.stdin).get('registries', [])
for r in items:
    name = r.get('name','')
    if name.startswith('ce-auto-icr-private'):
        print(name)
        break
" 2>/dev/null || true)

  if [[ -n "$secret" ]]; then
    CE_REGISTRY_SECRET="$secret"
    success "Using CE managed registry secret: ${CE_REGISTRY_SECRET}"
  else
    # Fallback to the well-known name pattern for us-south
    CE_REGISTRY_SECRET="ce-auto-icr-private-us-south"
    warn "Could not auto-detect CE registry secret — using fallback: ${CE_REGISTRY_SECRET}"
  fi
}

_resolve_ce_registry_secret

# Helper: true if the app exists but every revision has failed (never healthy)
_app_is_permanently_failed() {
  local ready
  ready=$(ibmcloud ce application get --name "${CE_APP_NAME}" --output json 2>/dev/null \
    | python3 -c "
import sys, json
d = json.load(sys.stdin)
conditions = (d.get('status') or {}).get('conditions', [])
for c in conditions:
    if c.get('type') == 'Ready':
        print(c.get('status',''))
        break
" 2>/dev/null || true)
  [[ "$ready" == "False" ]]
}

_create_app() {
  ibmcloud ce application create \
    --name            "${CE_APP_NAME}" \
    --image           "${DEPLOY_IMAGE}" \
    --registry-secret "${CE_REGISTRY_SECRET}" \
    --port            8080 \
    --min-scale       "${CE_MIN_SCALE}" \
    --max-scale       "${CE_MAX_SCALE}" \
    --cpu             "${CE_CPU}" \
    --memory          "${CE_MEMORY}" \
    "${CE_ENV_FLAGS[@]}"
}

if ibmcloud ce application get --name "${CE_APP_NAME}" &>/dev/null 2>&1; then
  if _app_is_permanently_failed; then
    warn "App '${CE_APP_NAME}' exists but is in a permanently failed state — recreating..."
    ibmcloud ce application delete --name "${CE_APP_NAME}" --force
    _create_app
    success "Application recreated: ${CE_APP_NAME}"
  else
    info "App '${CE_APP_NAME}' exists — updating..."
    ibmcloud ce application update \
      --name            "${CE_APP_NAME}" \
      --image           "${DEPLOY_IMAGE}" \
      --registry-secret "${CE_REGISTRY_SECRET}" \
      "${CE_ENV_FLAGS[@]}"
    success "Application updated: ${CE_APP_NAME}"
  fi
else
  info "App '${CE_APP_NAME}' not found — creating..."
  _create_app
  success "Application created: ${CE_APP_NAME}"
fi

# ── Re-select project to restore CE CLI context ───────────────────────────────
# The CE plugin can lose its active project context after create/update.
# Explicitly re-selecting ensures the console and CLI stay pinned to this app.
ibmcloud ce project select --name "${CE_PROJECT}" &>/dev/null
success "CE context pinned to project: ${CE_PROJECT} / app: ${CE_APP_NAME}"

# ── Print public URL ──────────────────────────────────────────────────────────
APP_URL=$(ibmcloud ce application get --name "${CE_APP_NAME}" --output json 2>/dev/null \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',{}).get('url',''))" \
  2>/dev/null || true)

echo ""
if [[ -n "$APP_URL" ]]; then
  echo -e "${GREEN}${BOLD}🚀  Live at: ${APP_URL}${RESET}\n"
else
  info "Run to get your app URL:"
  echo "  ibmcloud ce application get --name ${CE_APP_NAME}"
fi

echo ""
echo -e "  Project : ${BOLD}${CE_PROJECT}${RESET}"
echo -e "  App     : ${BOLD}${CE_APP_NAME}${RESET}"
echo -e "  Image   : ${BOLD}${DEPLOY_IMAGE}${RESET}"
echo ""
echo -e "${GREEN}${BOLD}Part 2 complete.${RESET}\n"
