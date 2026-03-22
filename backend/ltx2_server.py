"""FastAPI composition root for the LTX backend server."""
import os
import sys
from typing import Any, cast

if os.environ.get("BACKEND_DEBUG") == "1":
    try:
        import debugpy  # type: ignore[reportMissingImports]

        if not bool(debugpy.is_client_connected()):  # type: ignore[reportUnknownMemberType]
            try:
                # Connect to an already-listening IDE debugger (compound launch)
                debugpy.connect(("127.0.0.1", 5678))  # type: ignore[reportUnknownMemberType]
            except (ConnectionRefusedError, ConnectionError, OSError):
                # IDE not listening — start a debug server for manual attach
                debugpy.listen(("127.0.0.1", 5678))  # type: ignore[reportUnknownMemberType]
    except (ImportError, RuntimeError) as exc:
        print(f"Debugpy setup failed: {exc}", file=sys.stderr)

import logging
from pathlib import Path
import threading

# Note: expandable_segments is not supported on all platforms

import torch
from server_utils.app_paths import resolve_default_app_data_dir
from state.app_settings import AppSettings

# ============================================================
# Logging Configuration
# ============================================================

import platform

# Backend logs to console only — Electron captures stdout/stderr and writes
# them to the session log file. This ensures *all* output (including early
# import errors and unhandled tracebacks) reaches the log, not just messages
# that go through Python's logging module.
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.INFO)

logging.basicConfig(level=logging.INFO, handlers=[console_handler])
logger = logging.getLogger(__name__)

# ============================================================
# SageAttention Integration
# ============================================================
use_sage_attention = os.environ.get("USE_SAGE_ATTENTION", "1") == "1"
_sageattention_runtime_fallback_logged = False

if use_sage_attention:
    try:
        from sageattention import sageattn  # type: ignore[reportMissingImports]
        import torch.nn.functional as F

        _original_sdpa = F.scaled_dot_product_attention

        _SAGE_SUPPORTED_HEADDIMS = {64, 96, 128}

        def patched_sdpa(
            query: torch.Tensor,
            key: torch.Tensor,
            value: torch.Tensor,
            attn_mask: torch.Tensor | None = None,
            dropout_p: float = 0.0,
            is_causal: bool = False,
            scale: float | None = None,
            **kwargs: Any,
        ) -> torch.Tensor:
            global _sageattention_runtime_fallback_logged
            try:
                if (
                    query.dim() == 4
                    and attn_mask is None
                    and dropout_p == 0.0
                    and query.shape[-1] in _SAGE_SUPPORTED_HEADDIMS
                ):
                    return cast(torch.Tensor, sageattn(query, key, value, is_causal=is_causal, tensor_layout="HND"))  # type: ignore[reportUnnecessaryCast]
                else:
                    return _original_sdpa(query, key, value, attn_mask=attn_mask,
                                         dropout_p=dropout_p, is_causal=is_causal, scale=scale, **kwargs)
            except Exception:
                if not _sageattention_runtime_fallback_logged:
                    logger.warning("SageAttention failed during runtime; falling back to default attention", exc_info=True)
                    _sageattention_runtime_fallback_logged = True
                return _original_sdpa(query, key, value, attn_mask=attn_mask,
                                     dropout_p=dropout_p, is_causal=is_causal, scale=scale, **kwargs)

        F.scaled_dot_product_attention = patched_sdpa
        logger.info("SageAttention enabled - attention operations will be faster")
    except ImportError:
        logger.warning("SageAttention not installed - using default attention")
        use_sage_attention = False
    except Exception:
        logger.warning("Failed to enable SageAttention", exc_info=True)
        use_sage_attention = False

# ============================================================
# Constants & Paths
# ============================================================

PORT = 0


def _env_flag(name: str, *, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() not in {"", "0", "false", "no", "off"}


def _get_device() -> torch.device:
    if torch.cuda.is_available():
        return torch.device("cuda")
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


DEVICE = _get_device()
DTYPE = torch.bfloat16

def _resolve_app_data_dir() -> Path:
    env_path = os.environ.get("LTX_APP_DATA_DIR")
    if env_path:
        candidate = Path(env_path)
    else:
        candidate = resolve_default_app_data_dir()
        logger.warning(
            "LTX_APP_DATA_DIR is not set; using default app data directory: %s",
            candidate,
        )
    candidate.mkdir(parents=True, exist_ok=True)
    return candidate


APP_DATA_DIR = _resolve_app_data_dir()

def _resolve_models_dir(app_data_dir: Path) -> tuple[Path, Path | None]:
    env_path = os.environ.get("LTX_MODELS_DIR", "").strip()
    if env_path:
        models_dir = Path(env_path)
        models_dir.mkdir(parents=True, exist_ok=True)
        return models_dir, models_dir

    models_dir = app_data_dir / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    return models_dir, None


def _resolve_bind_host() -> str:
    return os.environ.get("LTX_BIND_HOST", "127.0.0.1").strip() or "127.0.0.1"


DEFAULT_MODELS_DIR, FORCED_MODELS_DIR = _resolve_models_dir(APP_DATA_DIR)
DEFAULT_MODELS_DIR.mkdir(parents=True, exist_ok=True)

PROJECT_ROOT = Path(__file__).parent.parent
FRONTEND_DIST_DIR = Path(os.environ.get("LTX_FRONTEND_DIST", str(PROJECT_ROOT / "dist")))
OUTPUTS_DIR = APP_DATA_DIR / "outputs"
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

logger.info(f"Models directory: {DEFAULT_MODELS_DIR}")
if FORCED_MODELS_DIR is not None:
    logger.info("Using forced models directory override from LTX_MODELS_DIR")
if FRONTEND_DIST_DIR.exists():
    logger.info(f"Frontend directory: {FRONTEND_DIST_DIR}")

# ============================================================
# Settings
# ============================================================

SETTINGS_DIR = APP_DATA_DIR
SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
SETTINGS_FILE = SETTINGS_DIR / "settings.json"

DEFAULT_APP_SETTINGS = AppSettings()

from app_factory import DEFAULT_ALLOWED_ORIGINS, create_app
from state import RuntimeConfig, build_initial_state
from runtime_config.model_download_specs import DEFAULT_MODEL_DOWNLOAD_SPECS, DEFAULT_REQUIRED_MODEL_TYPES
from runtime_config.runtime_policy import decide_force_api_generations
from state.app_state_types import ModelFileType
from server_utils.model_layout_migration import migrate_legacy_models_layout
from services.gpu_info.gpu_info_impl import GpuInfoImpl

migrate_legacy_models_layout(APP_DATA_DIR)

LTX_API_BASE_URL = "https://api.ltx.video"


def _resolve_force_api_generations() -> bool:
    if _env_flag("LTX_OFFLINE", default=False):
        logger.info("Runtime policy force_api_generations=False (offline mode enabled)")
        return False

    gpu_info = GpuInfoImpl()
    system = platform.system()
    cuda_available = gpu_info.get_cuda_available()
    vram_gb = gpu_info.get_vram_total_gb()

    # Server-owned source of truth for mode selection.
    force_api_generations = decide_force_api_generations(
        system=system,
        cuda_available=cuda_available,
        vram_gb=vram_gb,
    )
    logger.info(
        "Runtime policy force_api_generations=%s (system=%s cuda_available=%s vram_gb=%s)",
        force_api_generations,
        system,
        cuda_available,
        vram_gb,
    )
    return force_api_generations


FORCE_API_GENERATIONS = _resolve_force_api_generations()
REQUIRED_MODEL_TYPES: frozenset[ModelFileType] = (
    frozenset() if FORCE_API_GENERATIONS else DEFAULT_REQUIRED_MODEL_TYPES
)
STARTUP_PRELOAD_MODELS = _env_flag("LTX_PRELOAD_MODELS", default=False)
REQUIRE_LOCAL_MODE = _env_flag("LTX_REQUIRE_LOCAL_MODE", default=False)
OFFLINE_MODE = _env_flag("LTX_OFFLINE", default=False)

CAMERA_MOTION_PROMPTS = {
    "none": "",
    "static": ", static camera, locked off shot, no camera movement",
    "focus_shift": ", focus shift, rack focus, changing focal point",
    "dolly_in": ", dolly in, camera pushing forward, smooth forward movement",
    "dolly_out": ", dolly out, camera pulling back, smooth backward movement",
    "dolly_left": ", dolly left, camera tracking left, lateral movement",
    "dolly_right": ", dolly right, camera tracking right, lateral movement",
    "jib_up": ", jib up, camera rising up, upward crane movement",
    "jib_down": ", jib down, camera lowering down, downward crane movement",
}

DEFAULT_NEGATIVE_PROMPT = """blurry, out of focus, overexposed, underexposed, low contrast, washed out colors, excessive noise, grainy texture, poor lighting, flickering, motion blur, distorted proportions, unnatural skin tones, deformed facial features, asymmetrical face, missing facial features, extra limbs, disfigured hands, wrong hand count, artifacts around text, inconsistent perspective, camera shake, incorrect depth of field"""

runtime_config = RuntimeConfig(
    device=DEVICE,
    default_models_dir=DEFAULT_MODELS_DIR,
    forced_models_dir=FORCED_MODELS_DIR,
    model_download_specs=DEFAULT_MODEL_DOWNLOAD_SPECS,
    required_model_types=REQUIRED_MODEL_TYPES,
    outputs_dir=OUTPUTS_DIR,
    settings_file=SETTINGS_FILE,
    ltx_api_base_url=LTX_API_BASE_URL,
    force_api_generations=FORCE_API_GENERATIONS,
    startup_preload_models=STARTUP_PRELOAD_MODELS,
    require_local_mode=REQUIRE_LOCAL_MODE,
    offline_mode=OFFLINE_MODE,
    use_sage_attention=use_sage_attention,
    camera_motion_prompts=CAMERA_MOTION_PROMPTS,
    default_negative_prompt=DEFAULT_NEGATIVE_PROMPT,
)

handler = build_initial_state(runtime_config, DEFAULT_APP_SETTINGS)

auth_token = os.environ.get("LTX_AUTH_TOKEN", "")
admin_token = os.environ.get("LTX_ADMIN_TOKEN", "")

app = create_app(
    handler=handler,
    allowed_origins=DEFAULT_ALLOWED_ORIGINS,
    auth_token=auth_token,
    admin_token=admin_token,
    static_dir=FRONTEND_DIST_DIR if FRONTEND_DIST_DIR.exists() else None,
    media_roots=[OUTPUTS_DIR],
)


def precache_model_files(model_dir: Path) -> int:
    if not model_dir.exists():
        return 0
    total_bytes = 0
    for f in model_dir.rglob("*"):
        if f.is_file() and f.suffix in (".safetensors", ".bin", ".pt", ".pth", ".onnx", ".model"):
            try:
                size = f.stat().st_size
                with open(f, "rb") as fh:
                    while fh.read(8 * 1024 * 1024):
                        pass
                total_bytes += size
            except Exception:
                logger.warning("Failed to precache model file: %s", f, exc_info=True)
    return total_bytes


def background_warmup() -> None:
    handler.health.default_warmup()


def log_hardware_info() -> None:
    """Log runtime hardware and environment details."""
    gpu = GpuInfoImpl()
    gpu_info = gpu.get_gpu_info()
    vram_gb = gpu_info["vram"] // 1024 if gpu_info["vram"] else 0

    logger.info(f"Platform: {platform.system()} ({platform.machine()})")
    logger.info(f"Device: {DEVICE}  |  Dtype: {DTYPE}")
    logger.info(f"GPU: {gpu_info['name']}  |  VRAM: {vram_gb} GB")
    logger.info(f"SageAttention: {'enabled' if use_sage_attention else 'disabled'}")
    logger.info(f"Python: {sys.version.split()[0]}  |  Torch: {torch.__version__}")
    logger.info(
        "Startup options: bind_host=%s preload_models=%s require_local_mode=%s",
        _resolve_bind_host(),
        STARTUP_PRELOAD_MODELS,
        REQUIRE_LOCAL_MODE,
    )


if __name__ == "__main__":
    import asyncio
    import socket as _socket
    import uvicorn

    port = int(os.environ.get("LTX_PORT", "") or PORT)
    bind_host = _resolve_bind_host()
    block_on_startup = _env_flag("LTX_BLOCK_ON_STARTUP", default=False)
    logger.info("=" * 60)
    logger.info("LTX-2 Video Generation Server (FastAPI + Uvicorn)")
    log_hardware_info()
    logger.info("=" * 60)

    if block_on_startup:
        logger.info("Running startup warmup synchronously before serving traffic")
        background_warmup()
        ready, payload = handler.health.get_startup_probe()
        if not ready and payload.get("status") == "error":
            message = payload.get("error") or payload.get("message") or str(payload)
            raise RuntimeError(f"Startup warmup failed: {message}")
        if not ready:
            logger.warning("Startup warmup did not reach ready state before serving traffic: %s", payload)
    else:
        warmup_thread = threading.Thread(target=background_warmup, daemon=True)
        warmup_thread.start()

    # Use our root logging config so uvicorn logs go to stdout (not its
    # default stderr), letting Electron tag them correctly as INFO.
    log_config: dict[str, object] = {
        "version": 1,
        "disable_existing_loggers": False,
        "handlers": {
            "default": {
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stdout",
            },
        },
        "loggers": {
            "uvicorn": {"handlers": ["default"], "level": "INFO"},
            "uvicorn.error": {"handlers": ["default"], "level": "INFO", "propagate": False},
            "uvicorn.access": {"handlers": ["default"], "level": "INFO", "propagate": False},
        },
    }

    # Bind the socket ourselves so we know the actual port before uvicorn starts.
    sock = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)
    sock.setsockopt(_socket.SOL_SOCKET, _socket.SO_REUSEADDR, 1)
    sock.bind((bind_host, port))
    actual_port = int(sock.getsockname()[1])

    config = uvicorn.Config(app, host=bind_host, port=actual_port, log_level="info", access_log=False, log_config=log_config)
    server = uvicorn.Server(config)

    _orig_startup = server.startup

    async def _startup_with_ready_msg(sockets: list[_socket.socket] | None = None) -> None:
        await _orig_startup(sockets=sockets)
        if server.started:
            # Machine-parseable ready message — Electron matches this line
            print(f"Server running on http://{bind_host}:{actual_port}", flush=True)

    server.startup = _startup_with_ready_msg  # type: ignore[assignment]

    asyncio.run(server.serve(sockets=[sock]))
