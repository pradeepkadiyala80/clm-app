#!/usr/bin/env bash
# =============================================================================
# push-to-icr.sh
# Build the clm-app Docker image and push it to IBM Cloud Container Registry.
#
# Prerequisites:
#   - ibmcloud CLI with container-registry plugin installed
#   - Podman running
#
# Usage:
#   chmod +x deploy/push-to-icr.sh
#   ./deploy/push-to-icr.sh
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration — edit these values before running
# ---------------------------------------------------------------------------
ICR_REGION="us.icr.io"          # us.icr.io | uk.icr.io | de.icr.io | jp.icr.io | au.icr.io
ICR_NAMESPACE="clm-app"         # your ICR namespace (will be created if absent)
IMAGE_NAME="clm-app"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"   # clm-app root
IMAGE_TAG="$(node -p "require('$SCRIPT_DIR/package.json').version")"
IBMCLOUD_REGION="us-south"      # IBM Cloud region matching your ICR_REGION

# ---------------------------------------------------------------------------
# 1. Login to IBM Cloud  (SSO / API key / browser)
# ---------------------------------------------------------------------------
echo "==> Logging in to IBM Cloud..."
ibmcloud login -r "$IBMCLOUD_REGION" --sso
# To use an API key instead, replace the line above with:
#   ibmcloud login -r "$IBMCLOUD_REGION" --apikey "$IBMCLOUD_API_KEY"

# ---------------------------------------------------------------------------
# 2. Target the Container Registry region
# ---------------------------------------------------------------------------
echo "==> Setting Container Registry region..."
ibmcloud cr region-set "$ICR_REGION"

# ---------------------------------------------------------------------------
# 3. Create the namespace (safe to run if it already exists)
# ---------------------------------------------------------------------------
echo "==> Ensuring namespace '$ICR_NAMESPACE' exists..."
ibmcloud cr namespace-add "$ICR_NAMESPACE" 2>/dev/null || echo "    Namespace already exists, continuing."

# ---------------------------------------------------------------------------
# 4. Authenticate Docker to ICR
# ---------------------------------------------------------------------------
echo "==> Logging Docker into $ICR_REGION..."
ibmcloud cr login

# ---------------------------------------------------------------------------
# 5. Build the image
# ---------------------------------------------------------------------------
FULL_IMAGE="$ICR_REGION/$ICR_NAMESPACE/$IMAGE_NAME:$IMAGE_TAG"

echo "==> Building image: $FULL_IMAGE"
podman build -t "$FULL_IMAGE" "$SCRIPT_DIR"

# ---------------------------------------------------------------------------
# 6. Push the image
# ---------------------------------------------------------------------------
echo "==> Pushing image to IBM Cloud Container Registry..."
podman push "$FULL_IMAGE"

# ---------------------------------------------------------------------------
# 7. Verify
# ---------------------------------------------------------------------------
echo "==> Images in namespace '$ICR_NAMESPACE':"
ibmcloud cr images --restrict "$ICR_NAMESPACE"

echo ""
echo "✅  Done! Your image is available at:"
echo "    $FULL_IMAGE"
