# Preserving Character Identity and Body Features in Long LTX Videos

**Research date:** 2026-06-22

**Target:** LTX-Desktop with LTX-2.3

**Priority:** Maximum visual quality; compute cost is secondary

**Character domains:** Photoreal humans and stylized/digital characters

## Executive summary

Long-video character consistency is not one problem. It is the interaction of four separate failure modes:

1. **Identity drift:** facial geometry, hairstyle, skin details, or stylized design changes over time.
2. **Body and costume drift:** proportions, silhouette, clothing, accessories, or props mutate.
3. **Motion drift:** poses become implausible, joints change length, or the character stops moving.
4. **Long-horizon drift:** each extension inherits errors from the previous segment until the original character is no longer recoverable.

No single seed, prompt, reference image, or control signal solves all four. The strongest production workflow uses multiple independent anchors:

- A persistent **character bible/reference sheet** supplies long-term appearance memory.
- A **character LoRA** reinforces identity across viewpoints and independent shots.
- **First/last/multiple keyframes** lock composition and prevent unconstrained endpoint drift.
- **Pose and depth IC-LoRA** preserve body structure and intended motion.
- Short, validated generations are assembled into a long sequence; continuous shots use recent video context while reapplying permanent identity anchors.
- Automated identity, body, motion, and seam measurements reject weak generations before they contaminate later extensions.

For LTX-Desktop, the highest-impact immediate addition is the official **LTX-2.3 Ingredients IC-LoRA**. It was explicitly trained to carry faces, costumes, bodies, props, and locations from a reusable reference sheet into generated clips. The current application only supports Union Control and does not expose Ingredients, keyframe interpolation, IC-LoRA attention masks, or the current high-quality two-stage sampler.

The recommended implementation order is:

1. Add reproducible generation metadata and an evaluation harness.
2. Add project-level character profiles and arbitrary keyframes.
3. Integrate Ingredients plus reliable pose/depth control.
4. Add shot-based long-video orchestration and guarded extension.
5. Add project-specific character LoRA training.

## 1. Evidence standard

Recommendations are classified as follows:

- **LTX-native:** supported by current Lightricks code, documentation, model cards, or workflows.
- **Transferable:** demonstrated in another model family and applicable as a workflow or architecture principle.
- **Experimental:** requires LTX-specific training or validation before product integration.

Primary sources were preferred: official documentation, papers, model cards, and maintained repositories. Community workflows were used only to identify practical questions or failure reports, not as proof of quality.

## 2. What the strongest systems have in common

### 2.1 Text is not an identity representation

A prompt such as “a woman with dark hair and sharp cheekbones” identifies a category, not a particular person. Repeating that phrase reduces semantic variation, but it cannot encode exact eye spacing, nose shape, facial proportions, costume stitching, or a stylized character’s line language.

Lightricks therefore recommends combining stable prompt blocks with image conditioning or trained LoRAs for multi-shot work. The official character-consistency guidance recommends a library of references in close-up, medium, full-body, and multiple-angle views rather than relying on one universal image ([LTX character consistency guide](https://ltx.io/blog/how-to-maintain-character-consistency-in-ai-video)).

**Practical conclusion:** keep a canonical character description, but treat it as reinforcement and disambiguation. Visual references and learned adapters remain the authoritative identity source.

### 2.2 Global appearance and local facial features need separate protection

Recent identity-preserving systems consistently combine broad appearance information with face-specific information:

- **ConsisID** uses a global facial extractor for low-frequency structure and a local facial extractor for high-frequency identity details. Its hierarchical training strategy demonstrates that coarse head geometry and fine face detail should not be represented by one undifferentiated embedding ([paper](https://openaccess.thecvf.com/content/CVPR2025/papers/Yuan_Identity-Preserving_Text-to-Video_Generation_by_Frequency_Decomposition_CVPR_2025_paper.pdf), [repository](https://github.com/PKU-YuanGroup/ConsisID)).
- **StableAnimator** combines image and face embeddings, then uses a distribution-aware identity adapter to counteract distortion from temporal layers. Its pose-conditioned design also shows that identity and motion control are complementary rather than interchangeable ([paper](https://openaccess.thecvf.com/content/CVPR2025/papers/Tu_StableAnimator_High-Quality_Identity-Preserving_Human_Image_Animation_CVPR_2025_paper.pdf)).
- **Stand-In** adds a small conditional identity branch to a pretrained video model and can be composed with pose/depth control. Its released implementation is Wan-specific, but the separation between identity and structural control is directly relevant ([paper](https://openaccess.thecvf.com/content/CVPR2026/papers/Xue_Stand-In_A_Lightweight_and_Plug-and-Play_Identity_Control_for_Video_Generation_CVPR_2026_paper.pdf), [repository](https://github.com/WeChatCV/Stand-In)).
- **Phantom** aligns text, image, and video signals and supports up to four subject references in its released Wan implementation. It demonstrates the value of multi-reference subject conditioning for faces, clothing, and non-human subjects ([paper](https://openaccess.thecvf.com/content/ICCV2025/papers/Liu_Phantom_Subject-Consistent_Video_Generation_via_Cross-Modal_Alignment_ICCV_2025_paper.pdf), [repository](https://github.com/Phantom-video/Phantom)).

These systems are not drop-in LTX dependencies. ConsisID targets CogVideoX; Stand-In and Phantom target Wan. Porting their weights would not work. Their common design principle is useful: preserve global subject appearance, local facial identity, and motion structure through distinct signals.

### 2.3 A single first frame weakens with temporal and viewpoint distance

LTX image conditioning replaces or guides latents at specified frame positions. A first-frame image strongly constrains the beginning, but the generated sequence must infer every unseen angle and body state. Identity degrades fastest when:

- the face becomes small or leaves the frame;
- the head rotates beyond views represented by the reference;
- occlusion hides identity features;
- motion is fast or anatomically complex;
- the prompt changes clothing, lighting, age, or body shape;
- a later extension only receives an already-degraded last frame.

The LTX pipeline package already includes two relevant conditioning modes:

- Standard text/image pipelines use **latent replacement**, providing strong control at selected frames.
- `KeyframeInterpolationPipeline` uses **additive guiding latents**, intended for smoother interpolation between multiple images.

The official repository lists keyframe interpolation as a production two-stage pipeline and exposes arbitrary `ImageConditioningInput(path, frame_idx, strength)` values ([LTX-2 repository](https://github.com/Lightricks/LTX-2/tree/main/packages/ltx-pipelines)).

**Practical conclusion:** use a first frame to define the shot, a last frame to define its destination, and intermediate keyframes when camera or pose changes are too large for one interpolation interval. Do not place redundant keyframes on nearly identical frames; every hard anchor reduces the model’s motion freedom.

## 3. Best LTX-native identity stack

### 3.1 Ingredients IC-LoRA: highest-priority identity feature

The official [LTX-2.3 Ingredients model card](https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Ingredients) describes an IC-LoRA trained specifically on reference sheets. A sheet inventories characters, costumes, props, and locations in one composite image. The still image is repeated into a static reference video and supplied as in-context reference latents.

The expected sheet has:

- a black background and no text;
- a clean face close-up plus body turnaround for each character;
- dedicated product-style panels for important props;
- one clean location panel when the set must persist;
- larger panels for the most important elements;
- enough separation that panels do not overlap or visually merge.

The prompt must separate inventory from action:

```text
Reference sheet: <literal description of each character, prop, and location panel>.
Generated video: <shot, action, camera, lighting, and audio progression>.
```

The model card’s validated training bucket is **768×448, 121 frames, 24 fps**. Clips that are much longer or use substantially different resolutions are out of distribution. This is a critical reason to prefer shot-based generation over asking Ingredients to produce an entire long scene.

The model card recommends LoRA weight 1.4, 30 steps, CFG 4.0, and STG block 29 at scale 1.0. The current official ComfyUI workflow instead uses the dev checkpoint with distilled LoRA sampling, an eight-sigma schedule, CFG near 1, and Ingredients strength 1.0. These are two valid official profiles, but they are not equivalent. They must be benchmarked rather than blended arbitrarily.

**Recommended use:** Ingredients is the persistent long-term appearance anchor for all shots involving a recurring character. It is stronger than repeatedly conditioning on whichever last frame happened to be generated.

### 3.2 Character LoRA: learned identity across independent shots

Ingredients retrieves appearance from a sheet during each generation. A character LoRA modifies the model so the character’s identity is represented in the denoising network itself. The two techniques solve different problems and can be complementary.

The official LTX trainer supports standard T2V/I2V LoRAs and video-to-video IC-LoRAs ([training documentation](https://docs.ltx.video/open-source-model/ltx-2-trainer/ltx-2-training), [trainer code](https://github.com/Lightricks/LTX-2/tree/main/packages/ltx-trainer)). The LTX character guide suggests starting with 20–30 curated images, 500–2,000 steps, rank 32–64, and a learning rate near `1e-4`. These values are starting points, not universal optima.

A useful identity dataset should include:

- front, three-quarter, and profile face views;
- neutral and expressive faces;
- close-up, medium, and full-body framing;
- front/back clothing views and persistent accessories;
- relevant lighting diversity without changing identity-defining colors;
- body poses that expose limb proportions and silhouette;
- captions that name the trigger token and accurately describe variable attributes.

Avoid duplicate images, low-resolution faces, heavy filters, inconsistent costumes unless costume variation is intentional, and captions that incorrectly bind backgrounds to the character token.

For photoreal people, training data must be consented and access-controlled. Generated outputs should retain provenance and the identity source used for the shot.

### 3.3 Pose, depth, and Canny are structural controls—not identity controls

LTX Union Control supports pose, depth, and Canny references. These signals should be selected according to the failure being corrected:

| Control | Best use | Main risk |
|---|---|---|
| Pose | Limb layout, body motion, gestures, dance, performance transfer | Missing joints and occlusion errors create anatomy artifacts |
| Depth | Body-to-camera distance, scene geometry, camera movement, scale | Flickering depth or inconsistent normalization causes pulsing geometry |
| Canny | Exact silhouette, garment boundary, rigid props, architecture | Excess edges copy texture noise and make motion rigid |
| Sparse tracks | Object or character trajectories | Implausible paths still produce implausible motion |

The official IC-LoRA guide recommends matching extraction and generation frame rates, interpolating missing pose points, keeping depth range temporally stable, matching control resolution to generation resolution, and smoothing noisy edges ([IC-LoRA guide](https://docs.ltx.video/open-source-model/usage-guides/ic-lo-ra)).

LTX-2.3 also supports:

- `attention_strength` for global reference influence;
- spatial masks to affect only the character or foreground;
- spatiotemporal masks to ramp control up or down over the clip.

These controls prevent a strong depth/pose reference from unnecessarily freezing the background or overpowering image identity. Start at full control only when the reference is clean; otherwise sweep 0.5–1.0 and inspect both adherence and naturalness.

### 3.4 Production sampling and detail preservation

The current LTX repository recommends two-stage pipelines for production output. `TI2VidTwoStagesHQPipeline` uses the `res_2s` second-order sampler, while `TI2VidTwoStagesPipeline` uses the standard sampler. Both generate a lower-resolution stage, apply spatial upsampling, and refine at the target resolution ([pipeline documentation](https://github.com/Lightricks/LTX-2/tree/main/packages/ltx-pipelines)).

For final renders:

- use the full/dev checkpoint where the selected workflow supports it;
- use current v1.1 distilled LoRA and spatial upscaler assets;
- keep the face large enough in the generation frame to preserve useful pixels;
- prefer native target aspect ratio rather than cropping after generation;
- use tiled VAE decoding or offload modes for memory management instead of lowering the generation resolution below the identity requirement;
- use the distilled pipeline for previews and parameter search, then rerun selected seeds through the quality pipeline.

More steps are not automatically better. Excessive CFG can produce oversharpening, unnatural expressions, and reduced motion. Use the official profile as the starting point and benchmark guidance jointly with LoRA/control strength.

### 3.5 Technique decision matrix

| Technique | Face identity | Body/costume | Motion | Long-horizon value | LTX readiness |
|---|---:|---:|---:|---:|---|
| Repeated canonical prompt | Low | Low–medium | Low | Low | Available now |
| Locked seed | None by itself | None by itself | None | None | Available now |
| First-frame I2V | Medium–high near frame zero | Medium | Medium | Low | Available now |
| First/last and multiple keyframes | High at anchors | High at anchors | Medium–high between compatible anchors | Medium | Pipeline exists upstream |
| Ingredients reference sheet | High | High | Medium | High across independent shots | Official model; not integrated |
| Character LoRA | High when well trained | High | Medium | High | Official trainer; not productized |
| Pose IC-LoRA | Low by itself | High structure | High | Medium | Preprocessor exists; handler incomplete |
| Depth IC-LoRA | Low by itself | Medium–high geometry | High camera/scale control | Medium | Partially integrated |
| Canny IC-LoRA | Low by itself | High contour | Often restrictive | Low–medium | Integrated |
| Native video extension | Medium short-term | Medium short-term | High continuity | Low without re-anchoring | API/upstream support |
| Face swap/restoration post-process | Potentially high face similarity | None | Risk of expression/temporal mismatch | Low | Experimental, not a base solution |

Face swapping and per-frame restoration can rescue a selected final shot, but they should not be the core generation strategy. They can create a sharp face that is poorly integrated with head pose, lighting, occlusion, expression, hair, or motion. If used, apply them after shot approval with tracked masks and temporal processing, then re-run identity and flicker evaluation.

## 4. Long-video strategy

### 4.1 Why naive extension fails

If segment `N+1` is conditioned only on the final frame of segment `N`, every error becomes new ground truth. The process has short-term continuity but no memory of the original person. Seed locking does not fix this; a seed reproduces a sampling path under identical inputs, but it does not encode identity across changed prompts, keyframes, or histories.

Long-video research repeatedly finds that both recent and permanent memory are needed:

- **StreamingT2V** uses a short-term attention module for chunk transitions and a long-term appearance module anchored to the first chunk ([paper](https://openaccess.thecvf.com/content/CVPR2025/papers/Henschel_StreamingT2V_Consistent_Dynamic_and_Extendable_Long_Video_Generation_from_Text_CVPR_2025_paper.pdf), [project](https://streamingt2v.github.io/)).
- **LongLive** combines a recent attention window with retained sink frames and refreshes cached states when prompts change ([project](https://nvlabs.github.io/LongLive/), [repository](https://github.com/NVlabs/LongLive)).
- **FreeNoise** introduces long-range correlation through noise rescheduling and windowed temporal attention ([paper](https://arxiv.org/abs/2310.15169)).
- **FIFO-Diffusion** maintains a constant-memory queue but still requires explicit mechanisms to reduce the mismatch and drift introduced by autoregressive inference ([paper](https://arxiv.org/abs/2405.11473), [repository](https://github.com/jjihwan/FIFO-Diffusion_public)).
- **Gen-L-Video** co-denoises overlapping short clips so boundaries are solved jointly rather than stitched after generation ([repository](https://github.com/G-U-N/Gen-L-Video)).

These implementations cannot be copied directly into LTX-2.3 without major model work. Their shared principle can be implemented at the application level: preserve a recent continuity window and independently reapply original identity anchors.

### 4.2 Recommended shot-based workflow

For normal edited productions:

1. Define the character profile, reference sheet, LoRA, and canonical prompt once.
2. Build a shot list with one primary action and one coherent camera move per shot.
3. Generate keyframes before video generation when composition changes materially.
4. Generate each shot independently with the same character anchors.
5. Use first/last interpolation within the shot where both endpoints are known.
6. Reject or retake identity/body failures before placing the shot on the timeline.
7. Join shots using editorial cuts or intentional transitions instead of hiding severe model drift with crossfades.

Independent shots are preferable when the camera angle, location, time, or action changes. They avoid accumulating autoregressive errors and match traditional production practice.

### 4.3 Recommended continuous-shot workflow

Use extension only when a visible continuous take is required:

1. Supply the clean recent video context through the LTX extend workflow.
2. Reapply the character profile, LoRA, and canonical appearance block.
3. Optionally provide a destination image/keyframe for the extension endpoint.
4. Keep the new prompt chronologically compatible with existing velocity, pose, lighting, and camera direction.
5. Score the overlap/boundary and the entire new segment before accepting it.
6. If quality fails, restart from the last clean anchor—not the latest degraded output.

The LTX API’s Pro model exposes a dedicated extend endpoint and uses input context frames to continue the video ([API documentation](https://docs.ltx.video/api-documentation/api-reference/video-generation/extend)). FAL also exposes LTX-2.3 LoRA-capable extend and reference-video endpoints, which are candidates for cloud execution ([FAL reference-video endpoint](https://fal.ai/models/fal-ai/ltx-2.3-22b/distilled/reference-video-to-video/lora)). Ingredients compatibility through a gated Hugging Face weight must be validated before this is treated as a production provider path.

## 5. Prompt and reference practices

Use one prompt template per shot:

```text
Identity anchor: <canonical character description or LoRA trigger>.
Shot opening: <framing, pose, location, lighting>.
Action progression: <chronological physical actions>.
Camera: <one coherent move relative to the subject>.
Shot ending: <final framing and pose>.
Audio: <dialogue, ambience, effects, or music>.
```

For Ingredients, replace the identity paragraph with its required `Reference sheet:` section.

The [official LTX prompting guide](https://docs.ltx.video/api-documentation/guides/prompting-guide) recommends present-tense, chronological prompts of roughly 4–8 sentences with explicit shot scale, physical action, camera movement, lighting, and audio. Apply these additional consistency rules:

- Describe distinguishing visual traits literally and in the same order in every shot.
- Do not ask the prompt to contradict the reference’s age, body type, clothing, or lighting unless a transformation is intentional.
- Avoid simultaneous unrelated actions or multiple camera moves.
- Keep important faces unobstructed in at least one anchor.
- Use full-body references for body motion and close-ups for facial shots.
- For multiple characters, name and spatially locate each one consistently; avoid pronouns when identities could be swapped.
- Do not use negative prompts as the primary identity mechanism. “Wrong face” describes a failure but provides no correct identity information.

## 6. Current LTX-Desktop audit

### Existing strengths

- Backend pipeline protocols already accept `list[ImageConditioningInput]` with path, frame index, and strength.
- Fast, Pro, audio-to-video, retake, and IC-LoRA services are separated behind protocols and can be replaced by fakes in tests.
- A project/timeline model already stores generation metadata and takes.
- DWPose, person detection, depth extraction, and conditioning caches already exist.
- LTX API and FAL credentials already exist in app settings.
- The Pro pipeline already supports the dev checkpoint and two-stage upscaling.

### Blocking gaps

1. `GenerateVideoRequest` exposes one `imagePath`; arbitrary keyframes never reach normal generation.
2. `KeyframeInterpolationPipeline` and `TI2VidTwoStagesHQPipeline` have no desktop wrappers.
3. Model download specs expose Union Control only; Ingredients and Motion Control are absent.
4. Frontend IC-LoRA types include `pose`, but backend request models and handlers accept only `canny` and `depth`.
5. The pose preprocessing service is implemented but not connected to the IC-LoRA handler.
6. `conditioning_strength` currently controls the input reference tuple, but the wrapper does not expose the newer attention-strength or mask APIs.
7. IC-LoRA output is fixed to width 768 and derives height from the driving video, preventing controlled experiments across validated buckets.
8. Normal I2V always creates one frame-zero image at strength 1.0.
9. `GenerationParams` does not persist seed, model/checkpoint version, keyframes, reference sheet, character profile, LoRAs, or generation ancestry.
10. Dependencies are pinned to LTX commit `00dc53d3f81c405932f9f16d9c57557de411e702`; the inspected current upstream was substantially changed and includes new pipeline/block APIs. An upgrade requires a compatibility branch, not a blind lockfile bump.
11. The default upsampler path still selects the 1.0 asset while current official workflows use the v1.1 upsampler. v1.1 files exist only as optional inventory entries.
12. Runtime policy forces API generation below 31 GB VRAM. The detected RTX 3080 Ti has 12 GB, so its practical role is preprocessing, evaluation, and possibly quantized previews.

## 7. Proposed product architecture

### 7.1 Persisted character model

Add project-level profiles:

```ts
interface CharacterProfile {
  id: string
  name: string
  domain: 'photoreal' | 'stylized'
  canonicalPrompt: string
  references: CharacterReference[]
  referenceSheetPath?: string
  loras: CharacterLora[]
}

interface CharacterReference {
  assetId: string
  role:
    | 'face-front'
    | 'face-three-quarter'
    | 'face-profile'
    | 'body-front'
    | 'body-back'
    | 'costume'
    | 'prop'
    | 'location'
  subjectId?: string
}
```

Existing project migrations should default `characters` to an empty list.

### 7.2 Generation recipe

Keep `/api/generate` backward compatible. Add a new typed character-generation request for advanced workflows:

```text
CharacterGenerationRequest
├── prompt and output settings
├── character_profile_ids[]
├── conditioning_images[]: path, frame, strength, role
├── control: adapter, source, attention_strength, optional mask
├── continuity: independent | interpolate | extend
├── previous_video_path / destination_image_path
├── provider: local | ltx-api | fal
└── quality_preset: preview | production | ingredients-validated
```

The route remains thin and delegates to a character-generation handler. Heavy model/provider calls remain services. Generation metadata must record the fully resolved recipe and model hashes.

### 7.3 Provider strategy

- **Local 12 GB:** reference-sheet authoring, pose/depth extraction, metrics, thumbnails, and optional low-resolution/quantized previews.
- **Self-hosted high-memory GPU:** full control over Ingredients, arbitrary keyframes, masks, custom LoRAs, and current upstream pipelines.
- **FAL:** candidate remote path for custom LoRA and reference-video workflows; validate gated model access and exact IC-LoRA behavior.
- **LTX API:** production Pro I2V, retake, and extension when custom Ingredients/LoRA control is not required.

## 8. Evaluation protocol

### 8.1 Test set

Use four consented photoreal identities and four original stylized characters. Each character needs a complete profile and reference sheet.

Generate three seeds for each test:

1. Close-up speech with expression changes.
2. Head turn from front to profile and back.
3. Temporary face occlusion followed by reappearance.
4. Medium shot with hand interaction and costume detail.
5. Full-body walk or performance with camera motion.
6. Two-character interaction designed to expose identity swapping.
7. Four-segment continuous extension.
8. Four independent shots returning to the same character after scene changes.

Compare these configurations:

- Current frame-zero I2V baseline.
- Frame-zero plus final keyframe.
- Multiple keyframes.
- Ingredients only, using both official parameter profiles.
- Character LoRA only.
- Ingredients plus character LoRA.
- Ingredients plus pose.
- Ingredients plus pose/depth with a character mask.
- Full identity stack using the production sampler.

### 8.2 Metrics

Do not rely on one average similarity value.

#### Photoreal faces

- ArcFace cosine similarity between each detected face and canonical references.
- Median, 10th percentile, and minimum similarity across time.
- Face detection and track coverage.
- Identity switches in multi-character clips.
- Scores grouped by face size and yaw angle.

#### Body, costume, and stylized identity

- Segment the character and calculate DINOv2 similarity for the full subject.
- Calculate separate masked similarities for face/head, body silhouette, clothing, and important props.
- Use CLIP-I as a secondary semantic measure, not the sole identity metric.
- Measure pose/silhouette error after normalizing translation and scale.

ArcFace is not a valid primary metric for stylized faces that fall outside its training domain.

#### Temporal and general quality

- Optical-flow warping error and flicker.
- Pose acceleration/jerk and missing-keypoint rate.
- Dynamic degree to detect identity-preserving but frozen outputs.
- Imaging quality, motion smoothness, subject consistency, and background consistency from [VBench](https://github.com/Vchitect/VBench).
- Seam metrics around extension boundaries.
- Identity-similarity slope over elapsed time, which exposes slow long-horizon decay hidden by averages.

#### Human review

Use blind pairwise comparisons for:

- “Is this the same character?”
- face fidelity;
- body/costume fidelity;
- naturalness of motion;
- visible boundary artifacts;
- prompt adherence.

Human review remains necessary because embedding similarity can reward frozen or copied frames.

### 8.3 Acceptance criteria

A new configuration qualifies for production when it:

- improves median identity similarity by at least 10% relative to the current baseline;
- improves worst-decile identity similarity by at least 15%;
- improves body/costume similarity by at least 8%;
- reduces long-horizon identity decay slope by at least 30%;
- does not reduce face/subject tracking coverage;
- retains at least 95% of baseline imaging quality and motion-smoothness scores;
- wins a majority of blind human identity comparisons without producing visibly rigid motion.

If no configuration satisfies all constraints, select from the Pareto frontier rather than optimizing face similarity alone.

## 9. Phased roadmap

### Phase 0 — Reproducibility and benchmark harness

- Persist seed, provider, model versions, references, LoRAs, and controls.
- Implement frame extraction, identity/body metrics, VBench integration, and HTML/JSON reports.
- Capture current baselines before dependency changes.

### Phase 1 — Character profiles and keyframe generation

- Add project character profiles and reference-role UI.
- Add reference-sheet authoring and validation.
- Expose arbitrary frame-indexed image conditioning.
- Add keyframe interpolation with first/last presets.

### Phase 2 — Ingredients and complete structural control

- Add model download specs and provider configuration for Ingredients and Motion Control.
- Complete pose support end to end.
- Add IC-LoRA attention strength and spatiotemporal masks.
- Benchmark the two official Ingredients profiles at the trained bucket.

### Phase 3 — Production rendering and upstream update

- Upgrade LTX dependencies in an isolated compatibility change.
- Add the HQ two-stage sampler, v1.1 assets, offload modes, and model-hash reporting.
- Keep old generated projects readable and preserve existing generation endpoints.

### Phase 4 — Long-video orchestration

- Add shot recipes, continuity ancestry, clean-anchor checkpoints, and guarded extension.
- Automatically stop extension when identity, motion, or seam scores cross configured limits.
- Send rejected regions to retake instead of continuing from them.

### Phase 5 — Character LoRA training

- Add dataset validation, caption templates, training manifests, and checkpoint comparison.
- Train remotely on high-memory GPUs.
- Promote a checkpoint only after the full benchmark suite and human review.

## 10. Final recommendations

1. **Implement Ingredients before attempting a custom identity adapter.** It is official, LTX-native, and directly targets face, costume, body, prop, and location consistency.
2. **Treat long video as a sequence of controlled shots.** Use extension only for genuine continuous takes.
3. **Always combine permanent identity memory with recent temporal context.** Never build a long sequence from last-frame chaining alone.
4. **Expose multiple keyframes.** The backend is already structurally close to supporting them.
5. **Finish pose support and add control masks.** Body preservation requires motion structure without letting the control overwrite identity or background freedom.
6. **Persist complete generation recipes.** Results cannot be optimized or reproduced without seeds, model hashes, references, and adapter settings.
7. **Measure the worst frames and drift slope.** Average similarity conceals the failures viewers notice.
8. **Separate photoreal and stylized evaluation.** Face-recognition embeddings alone cannot validate stylized characters.
9. **Use the 12 GB GPU as a support tier, not the quality ceiling.** Final Ingredients/LoRA generations should run through a validated high-memory local or remote path.
10. **Do not equate consistency with stillness.** Every accepted configuration must retain natural motion and prompt adherence.

## Source index

### LTX primary sources

- [Lightricks/LTX-2](https://github.com/Lightricks/LTX-2)
- [LTX open-source documentation](https://docs.ltx.video/open-source-model/getting-started/overview)
- [LTX pipeline documentation](https://github.com/Lightricks/LTX-2/tree/main/packages/ltx-pipelines)
- [Ingredients IC-LoRA model card](https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Ingredients)
- [Official LTX-2.3 ComfyUI workflows](https://github.com/Lightricks/ComfyUI-LTXVideo/tree/master/example_workflows/2.3)
- [IC-LoRA guide](https://docs.ltx.video/open-source-model/usage-guides/ic-lo-ra)
- [Image-to-video guide](https://docs.ltx.video/open-source-model/usage-guides/image-to-video)
- [LoRA guide](https://docs.ltx.video/open-source-model/usage-guides/lo-ra)
- [Prompting guide](https://docs.ltx.video/api-documentation/guides/prompting-guide)
- [LTX-2 trainer](https://github.com/Lightricks/LTX-2/tree/main/packages/ltx-trainer)

### Identity and subject consistency

- [ConsisID paper](https://openaccess.thecvf.com/content/CVPR2025/papers/Yuan_Identity-Preserving_Text-to-Video_Generation_by_Frequency_Decomposition_CVPR_2025_paper.pdf) and [repository](https://github.com/PKU-YuanGroup/ConsisID)
- [StableAnimator paper](https://openaccess.thecvf.com/content/CVPR2025/papers/Tu_StableAnimator_High-Quality_Identity-Preserving_Human_Image_Animation_CVPR_2025_paper.pdf)
- [Stand-In paper](https://openaccess.thecvf.com/content/CVPR2026/papers/Xue_Stand-In_A_Lightweight_and_Plug-and-Play_Identity_Control_for_Video_Generation_CVPR_2026_paper.pdf) and [repository](https://github.com/WeChatCV/Stand-In)
- [Phantom paper](https://openaccess.thecvf.com/content/ICCV2025/papers/Liu_Phantom_Subject-Consistent_Video_Generation_via_Cross-Modal_Alignment_ICCV_2025_paper.pdf) and [repository](https://github.com/Phantom-video/Phantom)
- [ID-Animator paper](https://arxiv.org/abs/2404.15275) and [repository](https://github.com/ID-Animator/ID-Animator). The repository still does not provide the promised usable checkpoints/inference implementation, so it is not an integration candidate.

### Long-video generation and evaluation

- [StreamingT2V](https://streamingt2v.github.io/) and [repository](https://github.com/Picsart-AI-Research/StreamingT2V)
- [LongLive](https://nvlabs.github.io/LongLive/) and [repository](https://github.com/NVlabs/LongLive)
- [FreeNoise](https://arxiv.org/abs/2310.15169)
- [FIFO-Diffusion](https://arxiv.org/abs/2405.11473) and [repository](https://github.com/jjihwan/FIFO-Diffusion_public)
- [Gen-L-Video](https://github.com/G-U-N/Gen-L-Video)
- [VBench](https://github.com/Vchitect/VBench)
- [EvalCrafter](https://github.com/evalcrafter/EvalCrafter)
