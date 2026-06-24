"""Helpers for classifying GPU/runtime failures during generation.

Generation failures surface to the frontend through the generation error state,
so out-of-memory conditions are normalised to a stable, machine-detectable
prefix (``GPU_OUT_OF_MEMORY``) that the UI keys off to show a dedicated
"GPU ran out of memory" warning instead of a raw traceback string.
"""

from __future__ import annotations

GPU_OOM_ERROR_PREFIX = "GPU_OUT_OF_MEMORY"

_OOM_SIGNATURES = (
    "out of memory",
    "cuda out of memory",
    "cublas_status_alloc_failed",
    "hip out of memory",
    "mps backend out of memory",
    "failed to allocate",
    "cuda error: out of memory",
)


def is_out_of_memory_error(error: BaseException | str) -> bool:
    """Return True when the error looks like a GPU/host out-of-memory failure."""
    if isinstance(error, BaseException):
        # torch raises torch.cuda.OutOfMemoryError (a RuntimeError subclass).
        if type(error).__name__ == "OutOfMemoryError":
            return True
        text = str(error)
    else:
        text = error
    lowered = text.lower()
    return any(signature in lowered for signature in _OOM_SIGNATURES)


def normalize_generation_error(error: BaseException | str) -> str:
    """Return a user-facing error message, tagging GPU OOM with a stable prefix."""
    text = str(error) if isinstance(error, BaseException) else error
    if is_out_of_memory_error(error):
        detail = text.strip() or "The GPU ran out of memory during generation."
        if detail.startswith(GPU_OOM_ERROR_PREFIX):
            return detail
        return f"{GPU_OOM_ERROR_PREFIX}: {detail}"
    return text
