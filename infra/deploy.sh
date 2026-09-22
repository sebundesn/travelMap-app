#!/bin/bash
# Runs on the App EC2 instance, invoked remotely by .github/workflows/deploy.yml
# via SSM Send-Command (never SSH). Pulls the two images GitHub Actions just
# pushed to ECR and restarts the stack against RDS.
#
# Usage: deploy.sh <backend_image> <frontend_image> <aws_region>
set -euo pipefail

BACKEND_IMAGE="${1:?backend image required}"
FRONTEND_IMAGE="${2:?frontend image required}"
AWS_REGION="${3:-ap-northeast-1}"
REGISTRY="${BACKEND_IMAGE%%/*}"

cd "$(dirname "$0")/.."

# The instance authenticates to ECR with its own IAM role (read-only) —
# a different, narrower identity than the GitHub Actions role that pushed
# these images (which only has push rights, no SSM/EC2 access).
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY"

export BACKEND_IMAGE FRONTEND_IMAGE
docker compose -f docker-compose.prod.yml --env-file .env pull
docker compose -f docker-compose.prod.yml --env-file .env up -d
docker image prune -f
