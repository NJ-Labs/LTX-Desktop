#!/usr/bin/env bash
set -euo pipefail

models_dir="${LTX_MODELS_DIR:-}"
app_data_dir="${LTX_DATA_DIR:-${LTX_APP_DATA_DIR:-/var/lib/ltx}}"
bind_host="${LTX_BIND_HOST:-0.0.0.0}"
port="${LTX_PORT:-8000}"
preload_models="${LTX_PRELOAD_MODELS:-1}"
torch_compile="${LTX_TORCH_COMPILE:-0}"

normalize_bool() {
  local value="$1"
  case "$value" in
    1|true|TRUE|yes|YES|on|ON)
      printf '1\n'
      ;;
    0|false|FALSE|no|NO|off|OFF)
      printf '0\n'
      ;;
    *)
      echo "Invalid boolean value: $value" >&2
      exit 2
      ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --models-dir)
      models_dir="$2"
      shift 2
      ;;
    --models-dir=*)
      models_dir="${1#*=}"
      shift
      ;;
    --data-dir|--app-data-dir)
      app_data_dir="$2"
      shift 2
      ;;
    --data-dir=*|--app-data-dir=*)
      app_data_dir="${1#*=}"
      shift
      ;;
    --host)
      bind_host="$2"
      shift 2
      ;;
    --host=*)
      bind_host="${1#*=}"
      shift
      ;;
    --port)
      port="$2"
      shift 2
      ;;
    --port=*)
      port="${1#*=}"
      shift
      ;;
    --preload-models)
      if [[ $# -gt 1 && "$2" != --* ]]; then
        preload_models="$(normalize_bool "$2")"
        shift 2
      else
        preload_models=1
        shift
      fi
      ;;
    --preload-models=*)
      preload_models="$(normalize_bool "${1#*=}")"
      shift
      ;;
    --torch-compile)
      if [[ $# -gt 1 && "$2" != --* ]]; then
        torch_compile="$(normalize_bool "$2")"
        shift 2
      else
        torch_compile=1
        shift
      fi
      ;;
    --torch-compile=*)
      torch_compile="$(normalize_bool "${1#*=}")"
      shift
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
export LTX_PRELOAD_MODELS="$preload_models"
export LTX_TORCH_COMPILE="$torch_compile"
export LTX_BLOCK_ON_STARTUP="${LTX_BLOCK_ON_STARTUP:-1}"
export LTX_OFFLINE="${LTX_OFFLINE:-1}"
export LTX_REQUIRE_LOCAL_MODE="${LTX_REQUIRE_LOCAL_MODE:-0}"
export HF_HUB_OFFLINE="${HF_HUB_OFFLINE:-$LTX_OFFLINE}"
export TRANSFORMERS_OFFLINE="${TRANSFORMERS_OFFLINE:-$LTX_OFFLINE}"

exec python ltx2_server.py "$@"