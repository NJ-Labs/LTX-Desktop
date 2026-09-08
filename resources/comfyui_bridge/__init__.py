"""Studio editor bridge and acknowledged device-memory handoff."""

import asyncio

from aiohttp import web
import comfy.model_management
from server import PromptServer

NODE_CLASS_MAPPINGS: dict[str, object] = {}
WEB_DIRECTORY = "./web"


@PromptServer.instance.routes.post("/ltx/release-memory")
async def release_memory(_request):
    running, pending = PromptServer.instance.prompt_queue.get_current_queue()
    if running or pending:
        return web.json_response({"error": "The ComfyUI queue is still active."}, status=409)

    def release():
        comfy.model_management.unload_all_models()
        comfy.model_management.soft_empty_cache(force=True)

    await asyncio.to_thread(release)
    return web.json_response({"released": True})
