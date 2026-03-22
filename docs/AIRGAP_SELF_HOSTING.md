# Air-Gapped Self-Hosting

This repository now includes a backend runtime image for self-hosted, offline deployments.

## What The Image Does

- Runs the Python FastAPI backend directly.
- Accepts a mounted models directory through `--models-dir` or `LTX_MODELS_DIR`.
- Forces offline mode so runtime downloads fail fast instead of reaching out to Hugging Face.
- Preloads required local models at container startup.
- Starts even when mounted models are missing, so the UI can show model health warnings instead of hard-failing startup.

## Build

```bash
docker build -f Dockerfile.airgap -t ltx-desktop-airgap .
```

## Run

Mount a single host directory that already contains all required model files and folders using the names defined in [backend/runtime_config/model_download_specs.py](../backend/runtime_config/model_download_specs.py).

```bash
docker run --rm \
  --gpus all \
  -p 8000:8000 \
  -v /host/models:/models:ro \
  -v /host/app-data:/var/lib/ltx \
  ltx-desktop-airgap \
  --models-dir /models
```

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

- `LTX_OFFLINE=1` is enabled by default in the entrypoint.
- `LTX_PRELOAD_MODELS=1` is enabled by default in the entrypoint.
- `LTX_BLOCK_ON_STARTUP=1` is enabled by default in the entrypoint.
- `LTX_REQUIRE_LOCAL_MODE=0` is enabled by default in the entrypoint.

If required models are missing, the backend still starts and the frontend can surface a warning dialog and a non-green model status badge. Set `LTX_REQUIRE_LOCAL_MODE=1` if you want strict fail-fast behavior instead.