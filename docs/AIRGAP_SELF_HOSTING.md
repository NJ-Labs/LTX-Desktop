# Air-Gapped Self-Hosting

This repository now includes a backend runtime image for self-hosted, offline deployments.

## What The Image Does

- Runs the Python FastAPI backend directly.
- Accepts a mounted models directory through `--models-dir` or `LTX_MODELS_DIR`.
- Forces offline mode so runtime downloads fail fast instead of reaching out to Hugging Face.
- Supports `--online` to opt out of those offline defaults when the container should be allowed to download models at runtime.
- Preloads required local models at container startup.
- Starts even when mounted models are missing, so the UI can show model health warnings instead of hard-failing startup.

## Build

```bash
docker build -f Dockerfile.airgap -t ltx-desktop-airgap .
```

## Run

Mount a single host directory that already contains all required model files and folders using the names defined in [backend/runtime_config/model_download_specs.py](../backend/runtime_config/model_download_specs.py).

Mount a second writable host directory with `--data-dir` to persist your work across container restarts (see [Persistent Data](#persistent-data)).

```bash
docker run --rm \
  --gpus all \
  -p 8000:8000 \
  -v /host/models:/models:ro \
  -v /host/data:/data \
  ltx-desktop-airgap \
  --models-dir /models \
  --data-dir /data \
  --preload-models \
  --torch-compile
```

Boolean options accept either a CLI flag or an environment variable (the flag wins when both are set):

All CLI options accept both `--flag value` and `--flag=value` forms. Boolean flags also support a bare enable form such as `--preload-models`.

| Option | Enable flag | Environment variable | Default |
| --- | --- | --- | --- |
| Run in online mode | `--online` | `LTX_OFFLINE=0` | disabled |
| Preload models on startup | `--preload-models` | `LTX_PRELOAD_MODELS` | enabled |
| Torch compile (experimental) | `--torch-compile` | `LTX_TORCH_COMPILE` | disabled |

To disable an option that is on by default (such as preloading), set its environment variable to `0` (for example `LTX_PRELOAD_MODELS=0`).

## Persistent Data

The `--data-dir` flag selects a single host folder where all user data is read from and written to. Mount it as a volume and everything below survives the container being stopped, removed, or upgraded:

- **Projects** — names, descriptions, cover images, assets, takes, and timelines.
- **Playground assets** — videos generated outside of a project.
- **Generated videos and images** — written under `outputs/`.
- **Settings** — `settings.json`.

Notes:

- `--data-dir` defaults to `/var/lib/ltx`. `--app-data-dir` is accepted as an alias, and `LTX_DATA_DIR` / `LTX_APP_DATA_DIR` set the same path via environment.
- Models are mounted separately (read-only) via `--models-dir`; they are not stored under `--data-dir`.
- In self-hosted/web mode the project library lives server-side (`<data-dir>/library.json`), so projects are shared by every browser that connects to the instance rather than being trapped in one browser's local storage.

## Required Mounted Model Layout

The mounted models folder must contain these paths:

- `ltx-2.3-22b-distilled.safetensors`
- `ltx-2.3-spatial-upscaler-x2-1.0.safetensors`
- `Z-Image-Turbo/`
- `gemma-3-12b-it-qat-q4_0-unquantized/`

Depending on your settings and flows, you may also need:

- `ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors`
- `dpt-hybrid-midas/`
- `yolox_l.torchscript.pt`
- `dw-ll_ucoco_384_bs5.torchscript.pt`
- `ltx-2-19b-distilled-lora-384.safetensors`

## Readiness

- `GET /health` returns the existing application health payload.
- `GET /readyz` returns `200` only after startup warmup finishes.
- The container health check uses `GET /readyz`.

## Runtime Behavior

- `LTX_OFFLINE=1` is enabled by default in the entrypoint. Pass `--online` or set `LTX_OFFLINE=0` to allow runtime downloads.
- `LTX_PRELOAD_MODELS=1` is enabled by default in the entrypoint. Disable it with `LTX_PRELOAD_MODELS=0`.
- `LTX_TORCH_COMPILE=0` is disabled by default in the entrypoint. Enable with `--torch-compile` or `LTX_TORCH_COMPILE=1`. Experimental: the first generation can take 5-10+ minutes to compile, then subsequent generations are faster.
- `LTX_BLOCK_ON_STARTUP=1` is enabled by default in the entrypoint.
- `LTX_REQUIRE_LOCAL_MODE=0` is enabled by default in the entrypoint.

If required models are missing, the backend still starts and the frontend can surface a warning dialog and a non-green model status badge. Set `LTX_REQUIRE_LOCAL_MODE=1` if you want strict fail-fast behavior instead.