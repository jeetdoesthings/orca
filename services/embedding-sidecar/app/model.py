"""
CLAP / stub embedding engine for ORCA sidecar.

Model choice (Part 1 contract): clap-http-v1, dim 512.
- stub mode: FNV-style expand of audio bytes / URL → 512-d unit-ish vector (CPU, no deps)
- clap mode: laion CLAP via transformers if installed
"""

from __future__ import annotations

import hashlib
import math
import os
import struct
import urllib.request
from functools import lru_cache
from typing import Literal

DEFAULT_MODEL_ID = os.environ.get("ORCA_EMBEDDING_MODEL_ID", "clap-http-v1")
DEFAULT_DIM = 512
Mode = Literal["stub", "clap"]


def _resolve_mode() -> Mode:
    raw = (os.environ.get("ORCA_EMBED_MODE") or "").lower().strip()
    if raw in ("stub", "clap"):
        return raw  # type: ignore[return-value]
    # Prefer clap if torch+transformers present
    try:
        import transformers  # noqa: F401
        import torch  # noqa: F401

        return "clap"
    except Exception:
        return "stub"


def _stub_vector(seed: bytes, dim: int = DEFAULT_DIM) -> list[float]:
    """Deterministic pseudo-embedding from content hash (dev only)."""
    h = hashlib.sha256(seed).digest()
    out: list[float] = []
    block = h
    while len(out) < dim:
        for i in range(0, len(block) - 3, 4):
            (u,) = struct.unpack(">I", block[i : i + 4])
            out.append((u / 0xFFFFFFFF) * 2.0 - 1.0)
            if len(out) >= dim:
                break
        block = hashlib.sha256(block).digest()
    # L2 normalize
    norm = math.sqrt(sum(x * x for x in out)) or 1.0
    return [x / norm for x in out]


class EmbeddingEngine:
    def __init__(self) -> None:
        self.mode: Mode = _resolve_mode()
        self.model_id = DEFAULT_MODEL_ID
        self.dim = DEFAULT_DIM
        self.ready = False
        self._clap = None
        self._processor = None
        if self.mode == "clap":
            self._load_clap()
        else:
            self.ready = True

    def _load_clap(self) -> None:
        try:
            import torch
            from transformers import ClapModel, ClapProcessor

            name = os.environ.get(
                "ORCA_CLAP_MODEL_NAME",
                "laion/clap-htsat-unfused",
            )
            self._processor = ClapProcessor.from_pretrained(name)
            self._clap = ClapModel.from_pretrained(name)
            self._clap.eval()
            self._device = torch.device("cpu")
            self._clap.to(self._device)
            # Probe dim
            self.dim = int(self._clap.config.projection_dim or DEFAULT_DIM)
            self.ready = True
        except Exception as e:  # noqa: BLE001
            print(f"[embedding-sidecar] CLAP load failed, falling back to stub: {e}")
            self.mode = "stub"
            self.ready = True
            self._clap = None

    def embed_preview_url(self, preview_url: str) -> list[float]:
        data = _download(preview_url)
        if self.mode == "stub" or self._clap is None:
            return _stub_vector(data if data else preview_url.encode("utf-8"), self.dim)
        return self._embed_clap_bytes(data)

    def _embed_clap_bytes(self, audio_bytes: bytes) -> list[float]:
        import io

        import librosa
        import numpy as np
        import torch

        # Decode mp3/wav from Deezer preview
        y, sr = librosa.load(io.BytesIO(audio_bytes), sr=48000, mono=True)
        if y.size == 0:
            raise ValueError("empty audio")
        inputs = self._processor(
            audios=y,
            sampling_rate=sr,
            return_tensors="pt",
            padding=True,
        )
        inputs = {k: v.to(self._device) for k, v in inputs.items()}
        with torch.no_grad():
            out = self._clap.get_audio_features(**inputs)
        vec = out[0].detach().cpu().numpy().astype(np.float64)
        norm = float(np.linalg.norm(vec)) or 1.0
        return (vec / norm).tolist()


def _download(url: str, timeout: float = 25.0) -> bytes:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "ORCA-Embedding-Sidecar/1.0"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
        return resp.read()


@lru_cache(maxsize=1)
def get_engine() -> EmbeddingEngine:
    return EmbeddingEngine()
