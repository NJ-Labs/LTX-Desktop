"""Deterministic ComfyUI protocol fake, with no inference or external network."""
from pathlib import Path
from copy import deepcopy

from services.comfyui_service import ComfyUIStatus


class FakeComfyService:
    def __init__(self, root: Path):
        self.root = root
        self.calls = []
        self.catalog = {'Text': {}, 'SaveImage': {}}
        self.history = {}
        self.queue = {'queue_running': [], 'queue_pending': []}
        self.stopped = False

    def status(self):
        return ComfyUIStatus('running', 'http://127.0.0.1:8188', 8188, None,
                            str(self.root), str(self.root), str(self.root), str(self.root), str(self.root))

    async def start(self):
        return self.status()

    def stop(self):
        self.stopped = True

    async def request_json(self, method, path, payload=None):
        self.calls.append((method, path, deepcopy(payload)))
        if path == '/object_info':
            return self.catalog
        if path == '/prompt':
            self.history = {}
            self.queue['queue_pending'].append([1, 'prompt-1'])
            return {'prompt_id': 'prompt-1', 'node_errors': {}}
        if path.startswith('/history/'):
            return self.history
        if path == '/queue':
            if 'prompt-1' in self.history:
                return {'queue_running': [], 'queue_pending': []}
            return self.queue
        if path == '/ltx/release-memory':
            return {}
        if path == '/api/jobs/prompt-1/cancel':
            return {'cancelled': True}
        raise AssertionError(f'Unexpected ComfyUI request: {method} {path}')
