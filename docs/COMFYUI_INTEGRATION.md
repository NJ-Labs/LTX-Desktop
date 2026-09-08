# ComfyUI in LTX Studio

The `ltxNcomfy` branch embeds the ComfyUI editor and publishes workflows as reusable Studio forms. Python owns one managed ComfyUI process for desktop and self-hosted use. Electron delegates lifecycle requests to that backend.

## Development setup

Prepare the normal project dependencies first. Then create the separate ComfyUI Python environment:

```powershell
backend/.venv/Scripts/python.exe scripts/setup-comfyui.py
npm run dev:desktop
```

For this development PC, use `--cpu` to verify the editor and small image graphs. This does not make LTX video inference practical on CPU. Setup downloads Python packages but no model weights.

The runtime can live on another drive:

```powershell
$env:UV_CACHE_DIR='C:/Users/naved/AppData/Local/LTXDesktop/comfyui-setup-cache'
backend/.venv/Scripts/python.exe scripts/setup-comfyui.py --cpu --runtime-dir 'C:/Users/naved/AppData/Local/LTXDesktop/comfyui-runtime'
$env:LTX_COMFYUI_RUNTIME='C:/Users/naved/AppData/Local/LTXDesktop/comfyui-runtime'
$env:LTX_PRELOAD_MODELS='0'
npm run dev:desktop
```

Set `LTX_COMFYUI_RUNTIME` for subsequent launches when using a nondefault path. The setup completion marker prevents an incomplete environment from being mistaken for a usable runtime. `--offline` installs only from an already populated uv cache. For an image built on a CPU machine but deployed to a GPU server, explicitly choose a compatible wheel index, for example `--torch-backend cu128`; do not let build-host hardware choose the deployment device.

## Publish and use a workflow

1. Open **ComfyUI** from Home. Build or load a graph using nodes installed on this server. Include a saved image, video or audio output.
2. Select **Save for Studio**. Enter a name and description; choose only the values a Studio user needs to change and give them useful labels.
3. Save the workflow. Both its editable graph and executable API graph are retained. Use **Load in editor**, make changes, then **Update workflow** to retain its identity or **Save as copy** for a variant.
4. Open **Workflows** in Playground or a project's generation view. Select the published workflow, enter values and run it. Exposed LoadImage inputs accept image uploads.
5. Follow the run status and add a finished output to the project's asset library. Selections and active run IDs are restored when revisiting the panel on the same backend/project.

An API-only imported workflow can run but cannot be reconstructed into a faithful editable graph. Export the editor graph along with the API graph when editability matters. Studio validates exposed inputs and missing node classes; ComfyUI remains responsible for node-specific model and graph validation. Errors preserve the saved definition.

## Storage and transport

- Workflow definitions and runs: `<app-data-dir>/comfyui-library/{workflows,runs}`.
- Output media: `<data-dir>/comfyui-output`.
- ComfyUI editor state: `<data-dir>/.comfyui-user`.
- Temporary data: `<data-dir>/.comfyui-temp`.
- Model search paths are generated from the configured LTX models directory.

Keep app data and media volumes together when moving an installation; a run record contains paths to its output files. Native generation and managed Comfy submissions share a device reservation. Cancellation targets the owned Comfy prompt. The server monitors active jobs after a browser panel closes and releases native access only after the Comfy queue has drained and the Studio bridge has acknowledged memory cleanup.

The editor is served through `/comfyui-server/`, including WebSocket and upload traffic. Authentication stays on the LTX backend boundary; its credential is not forwarded into ComfyUI. A scoped HttpOnly cookie permits iframe/WebSocket access. Expose the authenticated LTX server through the deployment's HTTPS reverse proxy and forward WebSocket upgrades. The raw Comfy listener is loopback-only and is not a public user endpoint. Direct developer access bypasses the Studio scheduler.

## On-prem and disconnected deployment

`Dockerfile.airgap` includes the LTX custom nodes and Studio bridge and installs ComfyUI into an isolated environment. `COMFY_TORCH_BACKEND` defaults to `cu128` at image build time; select the deployment's supported backend when building. The Docker daemon was unavailable on the development PC, so this revised image still requires a build and startup check on the deployment host.

Provision all selected checkpoints, encoders, VAEs and LoRAs before disconnecting. Native model names are defined in `backend/runtime_config/model_download_specs.py`; Comfy workflows may use additional model subfolders. Mount model storage read-only and app/media storage writable. `LTX_OFFLINE=1` disables Comfy API nodes and enables Hugging Face/Transformers offline flags. Third-party custom nodes may have their own network behavior; a disconnected acceptance test must actually deny outbound traffic.

See [air-gap deployment](AIRGAP_SELF_HOSTING.md) for volume and backend startup options. ComfyUI first startup is separate from native `/readyz`: query `/api/comfyui/status` or use its Studio screen before submitting a graph. Failed startup offers retry and backend logs; missing models should not trigger implicit downloads.

## Model-free acceptance graph

Use `EmptyImage` with a small size (64 by 64), batch 1, and any solid color, linked to `SaveImage`. Publish the color as a Studio input. Run it, inspect the output, add it to the library, revisit the panel, edit/update the graph, and run again. This exercises the real process, proxy, bridge, queue, media handling and persistence without inference weights. It is not a video-quality test.

The importable example is [comfy-cpu-smoke.json](fixtures/comfy-cpu-smoke.json). On 7 September 2026 this round trip passed in the actual Windows desktop, including loading the graph into the editor, updating its saved definition, real CPU execution, output preview and library import.

## Future versions

Do not import an LTX 2.5 template into the older bundled core and assume model downloads will supply its missing nodes. The [research notes](LTX_PIPELINE_RESEARCH.md) describe the required component layout, bounded native API adapter and official templates. Upgrade core, custom nodes and templates together; preserve their licenses and record exact revisions and archive hashes. Complete CPU contract checks and the documented GPU acceptance matrix before shipping that version.
