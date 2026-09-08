"""Workflow library and execution contracts without inference or network access."""

import asyncio

from starlette.testclient import TestClient

from _routes._errors import HTTPError
from api_types import ComfyRunPayload
from app_factory import create_app
from services.comfyui_service import ComfyUIStatus
from tests.fakes.comfy_service import FakeComfyService


class FailingReleaseComfyService(FakeComfyService):
    def __init__(self, root):
        super().__init__(root)
        self.release_failed = False

    def status(self):
        state = "error" if self.release_failed else "running"
        return ComfyUIStatus(state, None, None, "release failed" if self.release_failed else None,
                            str(self.root), str(self.root), str(self.root), str(self.root), str(self.root))

    async def request_json(self, method, path, payload=None):
        if path == "/ltx/release-memory":
            self.release_failed = True
            raise HTTPError(502, "Memory release failed because ComfyUI stopped.")
        return await super().request_json(method, path, payload)


def workflow():
    return {
        "name": "Portrait", "description": "A reusable image workflow",
        "prompt": {
            "1": {"class_type": "Text", "inputs": {"text": "original"}},
            "2": {"class_type": "SaveImage", "inputs": {"images": ["1", 0]}},
        },
        "workflow": {"nodes": [{"id": 1}]},
        "inputs": [{"key": "prompt", "label": "Prompt", "node_id": "1", "input_name": "text"}],
    }


def test_workflow_survives_app_recreation(test_state):
    with TestClient(create_app(handler=test_state)) as client:
        saved = client.post('/api/comfyui/workflows', json=workflow())
        assert saved.status_code == 200, saved.text
        item = saved.json()
    with TestClient(create_app(handler=test_state)) as client:
        assert client.get('/api/comfyui/workflows').json() == [item]


def test_invalid_link_and_binding_are_rejected(client):
    payload = workflow()
    payload['prompt']['2']['inputs']['images'] = ['missing', 0]
    assert client.post('/api/comfyui/workflows', json=payload).status_code == 422
    payload = workflow()
    payload['inputs'][0]['input_name'] = 'missing'
    assert client.post('/api/comfyui/workflows', json=payload).status_code == 422


def test_editor_json_is_not_mistaken_for_executable_prompt(client):
    payload = workflow()
    payload['prompt'] = {'nodes': [], 'links': []}
    assert client.post('/api/comfyui/workflows', json=payload).status_code == 422


def test_workflow_not_found_is_explicit(client):
    assert client.post('/api/comfyui/workflows/missing/run', json={'values': {}}).status_code == 404


def test_run_binds_inputs_and_restores_saved_graph(test_state, tmp_path):
    runtime = FakeComfyService(tmp_path)
    with TestClient(create_app(handler=test_state, comfyui_service=runtime)) as client:
        saved = client.post('/api/comfyui/workflows', json=workflow()).json()
        run = client.post(f"/api/comfyui/workflows/{saved['id']}/run", json={'values': {'prompt': 'new scene'}})
        assert run.status_code == 200, run.text
        assert runtime.calls[-1][2]['prompt']['1']['inputs']['text'] == 'new scene'
        assert runtime.calls[-1][2]['extra_data']['extra_pnginfo']['workflow'] == workflow()['workflow']
        assert client.get('/api/comfyui/workflows').json()[0]['prompt']['1']['inputs']['text'] == 'original'
        run_id = run.json()['id']
        assert client.get(f'/api/comfyui/runs/{run_id}').json()['state'] == 'queued'
        runtime.queue = {'queue_pending': [], 'queue_running': [[1, 'prompt-1']]}
        assert client.get(f'/api/comfyui/runs/{run_id}').json()['state'] == 'running'
        runtime.history = {'prompt-1': {'status': {'completed': True, 'status_str': 'success'},
                                     'outputs': {'2': {'images': [{'filename': 'result.png', 'subfolder': '', 'type': 'output'}]}}}}
        completed = client.get(f'/api/comfyui/runs/{run_id}').json()
        assert completed['state'] == 'complete'
        assert completed['outputs'][0]['media_type'] == 'image'
        assert completed['outputs'][0]['path'] == str(tmp_path / 'result.png')
        assert client.get(f'/api/comfyui/runs/{run_id}').json() == completed


def test_missing_nodes_and_wrong_input_types_do_not_queue(test_state, tmp_path):
    runtime = FakeComfyService(tmp_path)
    with TestClient(create_app(handler=test_state, comfyui_service=runtime)) as client:
        saved = client.post('/api/comfyui/workflows', json=workflow()).json()
        url = f"/api/comfyui/workflows/{saved['id']}/run"
        assert client.post(url, json={'values': {'unknown': 'foo'}}).status_code == 422
        assert client.post(url, json={'values': {'prompt': 42}}).status_code == 422
        runtime.catalog = {}
        assert client.post(url, json={'values': {}}).status_code == 422
        assert not any(call[1] == '/prompt' for call in runtime.calls)


def test_cancellation_targets_only_owned_prompt(test_state, tmp_path):
    runtime = FakeComfyService(tmp_path)
    with TestClient(create_app(handler=test_state, comfyui_service=runtime)) as client:
        saved = client.post('/api/comfyui/workflows', json=workflow()).json()
        run = client.post(f"/api/comfyui/workflows/{saved['id']}/run", json={'values': {}}).json()
        runtime.queue = {'queue_running': [[1, 'prompt-1']], 'queue_pending': [[2, 'someone-else']]}
        result = client.post(f"/api/comfyui/runs/{run['id']}/cancel")
        assert result.status_code == 200, result.text
        assert result.json()['state'] == 'cancelled'
        assert runtime.calls[-1] == ('POST', '/api/jobs/prompt-1/cancel', {})


def test_execution_errors_are_reported_and_unsafe_outputs_ignored(test_state, tmp_path):
    runtime = FakeComfyService(tmp_path)
    with TestClient(create_app(handler=test_state, comfyui_service=runtime)) as client:
        saved = client.post('/api/comfyui/workflows', json=workflow()).json()
        run = client.post(f"/api/comfyui/workflows/{saved['id']}/run", json={'values': {}}).json()
        runtime.history = {'prompt-1': {'status': {'status_str': 'error', 'messages': [['execution_error', {'exception_message': 'Missing checkpoint'}]]}}}
        result = client.get(f"/api/comfyui/runs/{run['id']}").json()
        assert result['state'] == 'error'
        assert result['error'] == 'Missing checkpoint'
        run = client.post(f"/api/comfyui/workflows/{saved['id']}/run", json={'values': {}}).json()
        runtime.history = {'prompt-1': {'status': {'completed': True}, 'outputs': {'2': {'images': [{'filename': '../outside.png', 'type': 'output'}]}}}}
        result = client.get(f"/api/comfyui/runs/{run['id']}").json()
        assert result['state'] == 'error'
        assert result['outputs'] == []


def test_auth_required_for_workflow_api_and_websocket(test_state, tmp_path):
    import pytest
    from starlette.websockets import WebSocketDisconnect
    runtime = FakeComfyService(tmp_path)
    with TestClient(create_app(handler=test_state, comfyui_service=runtime, auth_token='secret')) as client:
        assert client.get('/api/comfyui/workflows').status_code == 401
        with pytest.raises(WebSocketDisconnect) as rejected:
            with client.websocket_connect('/comfyui-server/ws'):
                pass
        assert rejected.value.code == 1008
        response = client.get('/api/comfyui/status', headers={'Authorization': 'Bearer secret'})
        assert response.status_code == 200
        assert 'HttpOnly' in response.headers['set-cookie']
        assert client.get('/api/comfyui/workflows').status_code == 401


def test_duplicate_bindings_rejected(client):
    payload = workflow()
    payload['inputs'].append({**payload['inputs'][0], 'key': 'different'})
    assert client.post('/api/comfyui/workflows', json=payload).status_code == 422


def test_update_requires_existing_workflow_and_preserves_id(client):
    assert client.put('/api/comfyui/workflows/missing', json=workflow()).status_code == 404
    saved = client.post('/api/comfyui/workflows', json=workflow()).json()
    changed = {**workflow(), 'name': 'Updated'}
    response = client.put(f"/api/comfyui/workflows/{saved['id']}", json=changed)
    assert response.status_code == 200
    assert response.json()['id'] == saved['id']
    assert len(client.get('/api/comfyui/workflows').json()) == 1


def test_watcher_preserves_completed_run_when_memory_release_fails(test_state, tmp_path):
    runtime = FailingReleaseComfyService(tmp_path)
    handler = test_state.comfy_workflows
    handler.runtime = runtime
    run = ComfyRunPayload(
        id="run-complete",
        workflow_id="workflow-1",
        prompt_id="prompt-1",
        state="complete",
        outputs=[{"media_type": "image", "path": str(tmp_path / "result.png")}],
    )
    handler.store.save_run(run)
    assert test_state.generation.try_reserve_comfy(run.id)
    handler._active_run = run.id

    asyncio.run(handler._watch(run.id))

    persisted = handler.store.run(run.id)
    assert persisted.state == "complete"
    assert persisted.error is None
    assert persisted.outputs == run.outputs
    assert handler._active_run is None
    assert test_state.state.comfy_run_id is None
