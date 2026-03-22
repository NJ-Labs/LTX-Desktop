#!/usr/bin/env bash
set -euo pipefail

models_dir="${LTX_MODELS_DIR:-}"
app_data_dir="${LTX_APP_DATA_DIR:-/var/lib/ltx}"
bind_host="${LTX_BIND_HOST:-0.0.0.0}"
port="${LTX_PORT:-8000}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --models-dir)
      models_dir="$2"
      shift 2
      ;;
    --app-data-dir)
      app_data_dir="$2"
      shift 2
      ;;
    --host)
      bind_host="$2"
      shift 2
      ;;
    --port)
      port="$2"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$models_dir" ]]; then
  echo "Missing models directory. Pass --models-dir /path/to/models or set LTX_MODELS_DIR." >&2
  exit 2
fi

mkdir -p "$app_data_dir"
mkdir -p "$models_dir"

export LTX_APP_DATA_DIR="$app_data_dir"
export LTX_MODELS_DIR="$models_dir"
export LTX_BIND_HOST="$bind_host"
export LTX_PORT="$port"
export LTX_PRELOAD_MODELS="${LTX_PRELOAD_MODELS:-1}"
export LTX_BLOCK_ON_STARTUP="${LTX_BLOCK_ON_STARTUP:-1}"
export LTX_OFFLINE="${LTX_OFFLINE:-1}"
export LTX_REQUIRE_LOCAL_MODE="${LTX_REQUIRE_LOCAL_MODE:-0}"
export HF_HUB_OFFLINE="${HF_HUB_OFFLINE:-$LTX_OFFLINE}"
export TRANSFORMERS_OFFLINE="${TRANSFORMERS_OFFLINE:-$LTX_OFFLINE}"

exec python ltx2_server.py "$@"