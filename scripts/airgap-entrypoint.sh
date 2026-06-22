#!/usr/bin/env bash
set -euo pipefail

models_dir="${LTX_MODELS_DIR:-}"
app_data_dir="${LTX_DATA_DIR:-${LTX_APP_DATA_DIR:-/var/lib/ltx}}"
bind_host="${LTX_BIND_HOST:-0.0.0.0}"
port="${LTX_PORT:-8000}"
preload_models="${LTX_PRELOAD_MODELS:-1}"
torch_compile="${LTX_TORCH_COMPILE:-0}"
offline_mode="${LTX_OFFLINE:-1}"
offline_mode_overridden=0

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

invert_bool() {
  local normalized
  normalized="$(normalize_bool "$1")"
  if [[ "$normalized" == "1" ]]; then
    printf '0\n'
  else
    printf '1\n'
  fi
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
    --model-dir)
      models_dir="$2"
      shift 2
      ;;
    --model-dir=*)
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
    --online)
      if [[ $# -gt 1 && "$2" != --* ]]; then
        offline_mode="$(invert_bool "$2")"
        offline_mode_overridden=1
        shift 2
      else
        offline_mode=0
        offline_mode_overridden=1
        shift
      fi
      ;;
    --online=*)
      offline_mode="$(invert_bool "${1#*=}")"
      offline_mode_overridden=1
      shift
      ;;
    --)
      shift
      break
      ;;
    -e)
      # Tolerate docker-style "-e KEY=VALUE" pairs pasted into the arguments of
      # orchestrators (e.g. runai) that do not strip them. Export them as env so
      # the documented invocation works instead of aborting startup.
      if [[ $# -gt 1 && "$2" == *=* ]]; then
        export "${2?}"
        shift 2
      else
        echo "Ignoring stray -e flag without KEY=VALUE" >&2
        shift
      fi
      ;;
    -e*=*)
      export "${1#-e}"
      shift
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

offline_mode="$(normalize_bool "$offline_mode")"

mkdir -p "$app_data_dir"
mkdir -p "$models_dir"

export LTX_APP_DATA_DIR="$app_data_dir"
export LTX_MODELS_DIR="$models_dir"
export LTX_BIND_HOST="$bind_host"
export LTX_PORT="$port"
export LTX_PRELOAD_MODELS="$preload_models"
export LTX_TORCH_COMPILE="$torch_compile"
export LTX_BLOCK_ON_STARTUP="${LTX_BLOCK_ON_STARTUP:-1}"
export LTX_OFFLINE="$offline_mode"
export LTX_REQUIRE_LOCAL_MODE="${LTX_REQUIRE_LOCAL_MODE:-0}"

if [[ "$offline_mode_overridden" == "1" ]]; then
  export HF_HUB_OFFLINE="$offline_mode"
  export TRANSFORMERS_OFFLINE="$offline_mode"
else
  export HF_HUB_OFFLINE="${HF_HUB_OFFLINE:-$offline_mode}"
  export TRANSFORMERS_OFFLINE="${TRANSFORMERS_OFFLINE:-$offline_mode}"
fi

exec python ltx2_server.py "$@"