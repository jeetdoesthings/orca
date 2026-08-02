"""
ORCA embedding sidecar — CLAP Tier 1 (Part 14).

Contract (matches src/lib/audio/embedder.ts):
  POST /embed  { "previewUrl": str, "modelId"?: str }
            -> { "vector": number[], "dim": int, "modelId": str }
  GET  /health -> { "ok": bool, "modelId": str, "mode": "clap"|"stub" }

Modes:
  ORCA_EMBED_MODE=stub  — deterministic CPU stub (dev/CI; no torch weights)
  ORCA_EMBED_MODE=clap  — real CLAP inference (default when transformers available)

Never invent vectors in the main Next app; this service is the sole real_audio producer.
"""

from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .model import EmbeddingEngine, get_engine

app = FastAPI(title="ORCA Embedding Sidecar", version="1.0.0")


class EmbedRequest(BaseModel):
    previewUrl: str = Field(..., min_length=1)
    modelId: str | None = None


class EmbedResponse(BaseModel):
    vector: list[float]
    dim: int
    modelId: str


@app.on_event("startup")
def _startup() -> None:
    # Eager load so /health reflects readiness
    get_engine()


@app.get("/health")
def health() -> dict[str, Any]:
    engine = get_engine()
    return {
        "ok": engine.ready,
        "modelId": engine.model_id,
        "mode": engine.mode,
        "dim": engine.dim,
    }


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest) -> EmbedResponse:
    engine = get_engine()
    if not engine.ready:
        raise HTTPException(status_code=503, detail="model not ready")
    try:
        vector = engine.embed_preview_url(req.previewUrl)
    except Exception as e:  # noqa: BLE001 — surface as 502 to client
        raise HTTPException(status_code=502, detail=f"embed failed: {e}") from e
    model_id = req.modelId or engine.model_id
    return EmbedResponse(vector=vector, dim=len(vector), modelId=model_id)
