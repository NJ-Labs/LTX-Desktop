# LTX Desktop stabilization

Scope: the `ltxNcomfy` branch, existing Studio controls, native generation pipelines, and reusable ComfyUI workflows. No inference GPU is available on the development PC.

## Acceptance checks

- Controls perform the action their label promises or explain a real availability constraint; failed operations preserve user work and offer recovery.
- Local generation requests preserve conditioning, model selection, cancellation and output handling, with fake-service regression coverage.
- A workflow can be created in ComfyUI, published with named inputs, persisted, selected in Studio, queued, tracked, and its outputs added to the asset library.
- Desktop and self-hosted deployments use consistent storage and workflow execution contracts.
- TypeScript/Python checks, backend tests, frontend build and available UI checks pass. Actual model execution and output quality remain separate GPU acceptance checks.

## Work sequence

Second verification correction: the original broad goal is **not fully achieved**. The implementation and tests below establish specific behavior, not an exhaustive button audit or validated model quality. A fresh review found additional frontend defects and a real native keyframe indexing defect despite the passing suite. See [goal verification](goal-verification.md) for the current acceptance decision and remaining implementation work.

1. Reviewed: selected controls/pipelines and official LTX Desktop, LTX model/pipeline sources and ComfyUI. This is not an exhaustive proof that all controls work.
2. Repaired and tested: audited UI/native defects, shared ComfyUI lifecycle, workflow library and runner. Arbitrary native user-LoRA support remains absent.
3. Research and preparation complete: version-specific notes, inactive future 2.5 compatibility helpers and on-prem instructions. Working 2.5 integration remains pending.
4. Previous desktop CPU round trip passed. Second review corrections pass CPU tests; GPU and Docker deployment acceptance require a suitable host.

## Verification record (7 September 2026)

Second verification: **385 backend tests and 45 frontend/Electron tests passed**, including additional UI fixes and direct installed-LTX keyframe conditioning tests. Final TypeScript/Python checks passed. Desktop and web builds passed. Details and acceptance gaps are in [goal verification](goal-verification.md).

- Full backend suite: 382 passed, including final extension limits, cancellation/cleanup and proxy corrections.
- `pnpm typecheck`: TypeScript passed; Python strict check returned zero errors/warnings.
- Frontend/Electron regression suite: 40 passed, including final extension review follow-ups.
- `pnpm build:frontend`: passed. Existing large-chunk and stale Browserslist-data warnings remain.
- Windows-aware whitespace check: passed (`git -c core.whitespace=cr-at-eol diff --check`).
- Real CPU ComfyUI: started in its isolated runtime, queued `EmptyImage` -> `SaveImage`, persisted the run and generated a 64x64 PNG. No model weights were loaded.
- Desktop inspection reproduced and fixed embedded-editor CSP failures, forwarded fetch-metadata rejection, duplicate extension URL prefixes and output-preview origin handling. Verified saved workflow selection after process restart, Load in editor restoring the connected graph, Save for Studio exporting both graphs, Update workflow preserving identity and bindings, real CPU execution with image preview, Add to Playground confirming Added to library, and the saved image appearing on Home.
- Independent reviews covered native/Comfy mutual exclusion, startup/stop races, retake/LoRA preparation, temporal extension bounds, cancellation and output cleanup.

## Remaining host acceptance

Run model inference on a supported GPU: image editing strength, first/last-keyframe adherence, audio/video alignment, temporal extension seam and source preservation, curated LoRAs, cancellation during load/sampling and native/Comfy memory handoff. Evaluate quality with fixed inputs/seeds and human comparisons.

Build and boot `Dockerfile.airgap` on a Docker host, then test with outbound networking denied and all model assets provisioned. The development machine's Docker daemon is unavailable. Native LTX 2.5 is prepared through a bounded compatibility seam, but is not enabled or inference-validated.

Research sources: official Lightricks LTX repositories and model cards, ComfyUI source/docs, and the primary repositories for image models. Compare pinned versions with current upstream; do not silently replace model families or claim universal best settings.

Architecture decision: use the Python backend as the shared ComfyUI process and workflow owner. The current separate Electron launcher risks different runtime/storage state. Keep the embedded editor and add a persistent workflow contract with explicit scalar inputs. The migration does not delete existing ComfyUI workflows; editor JSON and API graphs are retained together. Validate queue/result handling against a local fake ComfyUI server before GPU evaluation.
