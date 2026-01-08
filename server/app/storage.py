from __future__ import annotations

import shutil
from pathlib import Path

STORAGE_ROOT = Path("server/storage")


def save_pdf(file_path: Path, filename: str) -> str:
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    safe_name = filename.replace(" ", "_")
    storage_key = f"pdfs/{safe_name}"
    destination = STORAGE_ROOT / storage_key
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(file_path, destination)
    return storage_key
