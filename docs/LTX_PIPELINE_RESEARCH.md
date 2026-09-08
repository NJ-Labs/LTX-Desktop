# LTX pipeline compatibility and implementation notes

Research checked 7 September 2026 against official Lightricks and Comfy sources. This branch is `ltxNcomfy`. The work deliberately retains the existing editor and on-prem architecture rather than merging upstream wholesale.

## What upstream changes mean here

The original Desktop now supports both LTX 2.3 and 2.5. Its local capabilities differ from its hosted API capabilities: local 2.5 supports text/image/audio conditioning, multiple keyframes and supported LoRAs; retake and extend remain unavailable for 2.5. Duration prediction requires separate weights. Local generation dimensions follow the model's 64-pixel grid, while API labels can use different dimensions. A UI resolution label therefore cannot be passed through as a universal pixel size. [Official capability matrix](https://raw.githubusercontent.com/Lightricks/LTX-Desktop/main/backend/runtime_config/ltx_capabilities.py)

This checkout pins LTX packages to commit `00dc53d3f81c405932f9f16d9c57557de411e702` (1.0 API). Current upstream Desktop uses `ltx-core` and `ltx-pipelines` 1.2.0 with newer Transformers and Diffusers. Updating only the checkpoint filename would leave incompatible constructors, encoders and dependencies. [Desktop dependencies](https://raw.githubusercontent.com/Lightricks/LTX-Desktop/main/backend/pyproject.toml)

The LTX package repository has since released 1.3.0. It replaces tuple results with named `PipelineOutput`, changes DFR checkpoint arguments and temporal-upscaling flags, and adds keyframe-aware decoding. The new compatibility adapter here explicitly targets 1.2.x; it must reject 1.3.x until the call and output wrappers are migrated. This is a future integration boundary, not a claim that native 2.5 inference is enabled. [LTX changelog](https://raw.githubusercontent.com/Lightricks/LTX-2/main/CHANGELOG.md)

## Choose a pipeline by task

| Task | Execution contract | Acceptance evidence required |
| --- | --- | --- |
| Text to image | Z-Image Turbo image pipeline; text, dimensions, seed and steps | Nonempty saved image; requested size; repeatable seed behavior |
| Image to image | Z-Image img2img; original image plus denoising strength | Source reaches the pipeline; low/high strength changes preservation; regeneration retains source |
| Image to video | LTX image conditioning at frame zero | Subject and opening frame adhere; output duration and audio agree |
| First/last-frame transition | Two separate image conditionings, first and final frame | Both images reach inference; endpoint adherence and motion continuity |
| Extend from last frame | Extract final still and condition a new segment | Clearly described as still-conditioned continuation; join and subject checked |
| Temporal video extension | A temporal prefix/suffix-aware extension pipeline and compatible weights | Multiple source frames preserved; motion/velocity continuity across the join |
| LoRA generation | Model-family-compatible adapter, intended stage and strength | Adapter loaded in correct stage; baseline and adapter comparison at same seed |

Image-to-image belongs to the image pipeline, not an LTX video workaround. The upstream ZIT implementation constructs `ZImageImg2ImgPipeline` from the shared text-to-image components; its device policy keeps MPS on-device rather than using CUDA CPU-offload hooks. These patterns informed the local img2img and MPS fixes. [Official ZIT implementation](https://raw.githubusercontent.com/Lightricks/LTX-Desktop/main/backend/services/image_generation_pipeline/zit_image_generation_pipeline.py)

For video interpolation, preserve both endpoints instead of silently reducing the request to one image. The branch now carries first/last image conditionings through the UI, request model, native handler and regeneration metadata. That does not supply the temporal context of a video prefix. [LTX image conditioning guide](https://docs.ltx.io/open-source-model/usage-guides/image-to-video)

Second verification found that the pinned 1.0 replacement helper interpreted those frame indexes as latent indexes. The wrappers now use its guiding-keyframe helper for nonzero frame positions. CPU tests verify the real installed conditioning objects at frames 0 and 48, strengths and helper restoration after failure. The scoped adapter depends on the application's native inference lease; revalidate or replace it when migrating the upstream runtime.

LTX's extension training describes prefix-conditioned forward and suffix-conditioned backward extension. Reusing one last frame cannot be presented as equivalent. The separate local 2.3 Extend action now encodes the source video/audio, pads the temporal latents, and applies a temporal region mask to the new region and a short seam before decoding the combined clip. It uses the installed 1.0 retake primitives; model inference and motion continuity still require GPU acceptance. The timeline action defaults to saving an asset and offers explicit replacement with movement of following clips. Trimmed, reversed or retimed sources must be rendered first. Source frame counts follow 8k+1, which can remove up to seven trailing frames. [Training modes](https://github.com/Lightricks/LTX-2/blob/main/packages/ltx-trainer/docs/training-modes.md), [extension configuration](https://github.com/Lightricks/LTX-2/blob/main/packages/ltx-trainer/configs/video_extend_lora.yaml)

LoRAs are not interchangeable merely because their filenames contain LTX. Record supported base families, intended purpose, target stage and recommended strength. The future 2.5 compatibility contract requires an explicit model allowlist. For current custom work, expose a curated ComfyUI workflow's prompt, source and strength controls while keeping model paths and sampler internals fixed. [Official Desktop LoRA catalog](https://raw.githubusercontent.com/Lightricks/LTX-Desktop/main/backend/runtime_config/lora_catalog.json)

Current implementation limit: IC-LoRA is connected, but arbitrary user LoRAs have no native generation request field and fast/pro constructors still use empty LoRA lists. The compatibility allowlist is preparation code, not an enforced production loader. No claim of best LoRA output quality is supported by this PC's tests.

## LTX 2.5 migration

2.5 separates transformer, Gemma 4 text encoder, video VAE and audio VAE, with additional spatial-upscaler and optional duration-head files. The monolithic 2.3 loader cannot interpret that layout. The new versioned registry records separate component paths and capabilities; `build_model_paths` is the bounded seam for the 1.2 API. Before enabling a 2.5 selector, implement and test its pipeline constructors, output adapters, downloads, settings persistence and capability filtering together. [Model card](https://huggingface.co/Lightricks/LTX-2.5), [official ModelPaths](https://raw.githubusercontent.com/Lightricks/LTX-2/main/packages/ltx-pipelines/src/ltx_pipelines/utils/model_paths.py)

The registry and `build_model_paths` currently have no production callers. Their capabilities describe a migration target, not enabled application features. Revalidate the registry's 2.3 runtime band when adopting 1.2 so retained 2.3 models are handled correctly.

The bundled ComfyUI core identifies itself as 0.25.0. Current official 2.5 templates use nodes absent from that core, including `LTXVDualCFGGuider`. A missing-node error is therefore a version mismatch, not evidence that a model file should be renamed. Upgrade and pin the core, LTX custom nodes and templates together in a staging checkout, then validate `/object_info` against every executable node before rollout. The Studio runner now performs that node check before submission. [Comfy integration guide](https://docs.ltx.io/open-source-model/integration-tools/comfy-ui), [official text-to-video template](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_ltx2_5_t2v.json)

Use the official image-to-video and first/last-frame templates as separate baselines. The latter is an interpolation graph; its sampler and conditioning sequence should not be copied into a generic video-extension block. Preserve model assets and graph metadata when exporting both editor JSON and an executable API graph. [Image-to-video template](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_ltx2_5_i2v.json), [first/last-frame template](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_ltx2_5_flf2v.json)

## Evaluation and limits

There is no evidence for a universal best sampler or LoRA strength across these tasks. Compare a fixed prompt/source set at fixed seeds and report completion rate, wall time, peak VRAM, endpoint adherence, temporal consistency, image preservation and audio alignment. Include human side-by-side review; faster generation alone is not a quality improvement.

This PC can verify request plumbing, state transitions, storage, authentication, UI actions and lightweight CPU Comfy graphs. It cannot validate LTX model loading, GPU memory behavior or output quality. GPU acceptance must cover: text/video, one/two keyframes, img2img strength extremes, audio/video, each curated LoRA, cancellation during model load and sampling, restart recovery, native/Comfy handoff, and network-disabled execution with pre-provisioned assets.

Current evidence and remaining checks are tracked in [the stabilization plan](stabilization-plan.md). Deployment and workflow instructions are in [ComfyUI integration](COMFYUI_INTEGRATION.md).
