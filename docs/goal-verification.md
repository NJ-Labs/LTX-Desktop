# Goal verification, 7 September 2026

Decision: **not fully achieved**. The previous completion status was too broad. Passing fake-service tests and a model-free ComfyUI run do not establish working LTX inference, best output quality, or an offline deployment.

## Second review findings

- Importing and saving workflow B could associate an unrelated editor graph A with B's identity. The fix separates imported drafts from editor exports.
- ComfyUI video/audio imports omitted duration, causing timeline insertion to default to five seconds. The fix measures media metadata before adding the asset and reports unreadable output.
- Gallery preview overlays left keyboard focus in the background. The fix moves and contains focus, wraps Tab, and restores the opener.
- Prompt-copy controls could report success after clipboard failure. The fix awaits copying, resets success, and displays errors.
- Native multi-keyframe conditioning passed pixel-frame indexes into the pinned LTX 1.0 replacement conditioner's latent-frame index. A DTO-only test missed this. Fast, Pro and audio-to-video wrappers now scope the installed guiding-keyframe helper to requests containing nonzero frames and restore the original helper afterward. A CPU regression calls the installed helper with pixel frames 0 and 48 and distinct strengths; another checks restoration after failure. This verifies conditioning construction, not generated endpoint quality.

## Acceptance by requirement

| Requirement | Result |
| --- | --- |
| Working Studio controls | Audited defects repaired, with additional regressions found in this second review. No exhaustive proof that every button works in every state. |
| Text/image/video pipelines | Request and lifecycle tests pass. Real model loading, image preservation, endpoint adherence, audio alignment and output quality still require GPU tests. |
| Temporal extension | Implemented for local LTX 2.3 tail extension. Integer FPS, dimensions divisible by 32, and 20-second total limit apply. Source normalization can drop up to seven trailing frames. GPU seam/source-preservation acceptance remains open. |
| LoRAs | IC-LoRA is wired. Arbitrary user LoRAs are not exposed by native generation requests, and fast/pro pipelines currently use empty LoRA lists. Generic ComfyUI publishing permits suitable authored graphs but does not establish a tested collection of best LoRA pipelines. |
| ComfyUI editor to novice Studio workflow | Previous real CPU create/load/update/run/preview/library round trip passed. This verifies the integration with a model-free image graph; video models still need acceptance. |
| On-prem/offline | Web compilation and shared backend contracts can be checked here. Docker daemon is unavailable; image build, startup, HTTPS proxy/WebSocket behavior and denied-network inference remain untested. |
| Future LTX 2.5 alignment | Research, component/version registry and a ModelPaths helper exist. They have no production callers yet. Runtime, wrappers, downloads/settings, and a compatible Comfy core/node/template set still need integration. The current registry's 2.3 runtime band also needs revalidation when adopting 1.2. |

## Verification evidence

The final full backend run passed **385 tests**, including direct installed-LTX conditioning regressions. TypeScript and strict Python checks passed again after the corrections. Desktop and web builds passed. The frontend/Electron suite passes **45 tests**, including the clipboard success-then-failure case. Independent reviewers found no remaining actionable defect in the focused frontend and keyframe corrections. The Windows-aware whitespace check passed.

The desktop restarted and showed the persisted CPU smoke-test asset. A temporary web-build directory triggered a Windows Vite watcher error during concurrent development startup; restarting after the build completed restored startup. The later Computer Use control attempt failed with `coordinate input geometry is unavailable` even after refreshing and activating the window. No second complete live workflow round trip is claimed for this verification session.

Logs are local under `.codex-tmp/reverify-*.log`. The earlier acceptance evidence remains in [stabilization plan](stabilization-plan.md) and [ComfyUI integration](COMFYUI_INTEGRATION.md).
