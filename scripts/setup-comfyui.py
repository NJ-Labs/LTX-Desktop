"""Prepare an isolated ComfyUI runtime once; never downloads model weights.

Examples:
  python scripts/setup-comfyui.py
  python scripts/setup-comfyui.py --cpu
  python scripts/setup-comfyui.py --offline
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cpu', action='store_true', help='Editor and CPU contract checks; no usable LTX video inference on this PC.')
    parser.add_argument('--offline', action='store_true', help='Install only packages already in the uv cache.')
    parser.add_argument('--torch-backend', default='auto', help='uv PyTorch backend, e.g. cu128 for a GPU container built on a CPU host.')
    parser.add_argument('--runtime-dir', type=Path, help='Store the Python runtime on another drive. Set LTX_COMFYUI_RUNTIME to this directory when launching Studio.')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    uv = shutil.which('uv')
    if uv is None:
        parser.error('uv is required. Install the project development prerequisites first.')
    comfy = root / 'ComfyUI'
    if not (comfy / 'main.py').is_file():
        parser.error('The ComfyUI source directory is missing.')
    environment = args.runtime_dir.resolve() if args.runtime_dir else comfy / '.venv'
    python = environment / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    env = {**os.environ, 'UV_SYSTEM_CERTS': 'true'}
    if not python.exists():
        subprocess.run([uv, 'venv', str(environment), '--python', sys.executable], env=env, check=True)
    command = [uv, 'pip', 'install', '--python', str(python), '--torch-backend', 'cpu' if args.cpu else args.torch_backend,
               '-r', str(comfy / 'requirements.txt'), '-r', str(root / 'ComfyUI-LTXVideo' / 'requirements.txt')]
    if args.offline:
        command.append('--offline')
    subprocess.run(command, env=env, check=True)
    # Record the chosen device mode so a CUDA-capable Studio process does not
    # launch a CPU-only Comfy environment without --cpu.
    subprocess.run([str(python), '-c', 'import torch, aiohttp, comfyui_frontend_package; print("ComfyUI runtime ready; torch", torch.__version__)'], check=True)
    (environment / 'ltx-runtime.json').write_text(json.dumps({'cpu': args.cpu}, indent=2), encoding='utf-8')
    print('Restart the ComfyUI connection in Studio. No model weights were downloaded.')


if __name__ == '__main__':
    main()
