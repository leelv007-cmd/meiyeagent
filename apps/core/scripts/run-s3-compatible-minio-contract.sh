#!/usr/bin/env bash
set -euo pipefail

readonly minio_image='minio/minio:RELEASE.2025-05-24T17-08-30Z'
readonly script_directory="$(cd "$(dirname "$BASH_SOURCE")" && pwd)"
readonly core_directory="$(cd "$script_directory/.." && pwd)"
readonly repository_directory="$(cd "$core_directory/../.." && pwd)"
contract_tmp_directory=''
contract_container=''

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$contract_container" ]]; then
    docker rm -f "$contract_container" >/dev/null 2>&1 || true
  fi
  if [[ -n "$contract_tmp_directory" ]]; then
    rm -rf -- "$contract_tmp_directory"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

command -v docker >/dev/null
command -v curl >/dev/null
command -v openssl >/dev/null
docker info >/dev/null

contract_tmp_directory="$(mktemp -d /tmp/meiye-minio-contract.XXXXXX)"
mkdir -p "$contract_tmp_directory/certs"
openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout "$contract_tmp_directory/certs/private.key" \
  -out "$contract_tmp_directory/certs/public.crt" \
  -days 1 \
  -subj '/CN=localhost' >/dev/null 2>&1

contract_container="meiye-minio-contract-$$_$(date +%s)"
docker run --detach --rm \
  --name "$contract_container" \
  --publish '127.0.0.1::9000' \
  --volume "$contract_tmp_directory/certs:/root/.minio/certs:ro" \
  --env MINIO_ROOT_USER=minio-contract-access \
  --env MINIO_ROOT_PASSWORD=minio-contract-secret \
  "$minio_image" server /data >/dev/null

contract_port="$(docker port "$contract_container" 9000/tcp | awk -F: 'NR == 1 { print $NF }')"
if [[ ! "$contract_port" =~ ^[0-9]+$ ]]; then
  docker logs "$contract_container" >&2 || true
  exit 1
fi

for _ in $(seq 1 30); do
  if curl --fail --silent --insecure \
    "https://127.0.0.1:$contract_port/minio/health/live" >/dev/null; then
    break
  fi
  sleep 1
done
if ! curl --fail --silent --insecure \
  "https://127.0.0.1:$contract_port/minio/health/live" >/dev/null; then
  docker logs "$contract_container" >&2 || true
  exit 1
fi

cd "$repository_directory"
NODE_TLS_REJECT_UNAUTHORIZED=0 \
P1_S3_CONTRACT_ENDPOINT="https://127.0.0.1:$contract_port" \
P1_S3_CONTRACT_BUCKET="meiye-contract-$$-$(date +%s)" \
P1_S3_CONTRACT_ACCESS_KEY_ID=minio-contract-access \
P1_S3_CONTRACT_SECRET_ACCESS_KEY=minio-contract-secret \
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/model-supply/s3-compatible-minio.contract.test.ts
