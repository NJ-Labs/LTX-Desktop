# LTX + Z-Image-Turbo + Gemma Inference Service Prompt

Build a production-ready inference service that hosts three model groups separately: LTX video generation models, Z-Image-Turbo image generation models, and Gemma text-encoding or prompt-enhancement models. Design the server architecture and API so each model family has its own clear route namespace, lifecycle, and resource management, while still working as one deployable service.

The service must be packaged in Docker, but the model weights must not be baked into the image. The Docker image should expect the user to mount a host volume containing the model files, and the design should clearly define the required mounted directory structure, configuration, and startup validation for that external models volume.

## Requirements

1. Propose the recommended server architecture for GPU inference, including process model, model loading strategy, queueing, concurrency limits, health checks, warmup, and scaling strategy.
2. Define separate HTTP routes for:
   - LTX generation
   - Z-Image-Turbo generation
   - Gemma prompt embedding and or prompt enhancement
3. Include a route compatible with the existing LTX Desktop online-style prompt embedding flow, similar to `POST /v1/prompt-embedding`, returning the conditioning or embedding payload expected by the client.
4. Explain whether Gemma should be exposed as a raw model endpoint, an internal-only dependency behind a prompt-embedding endpoint, or both, and recommend the best choice.
5. Recommend whether to implement this as:
   - one FastAPI service with isolated workers per model family,
   - multiple microservices behind a gateway,
   - or another architecture,
   and justify the choice.
6. Cover request and response schemas, model registry/config, GPU memory isolation, background jobs for long generations, status polling, logging, auth, and deployment concerns.
7. Assume the goal is self-hosted inference for a desktop client that may later support both remote prompt embedding and full remote generation.
8. Design the Docker setup so:
   - the container starts without embedding model weights in the image,
   - models are loaded from a mounted external volume,
   - the required volume layout for LTX, Z-Image-Turbo, and Gemma is documented,
   - startup fails clearly if required model paths are missing,
   - `docker-compose` or equivalent examples are included showing how the user mounts the models volume.

## Output

- a recommended architecture
- API route design
- deployment topology
- Docker and volume strategy
- minimal implementation plan
- key risks and tradeoffs

## Optional Stretch

If useful, also return exact deliverables like `Dockerfile`, `docker-compose.yml`, FastAPI app structure, and a mounted `/models` contract.
