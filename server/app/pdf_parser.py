from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import List

from PyPDF2 import PdfReader


@dataclass
class ParsedSection:
    heading_text: str
    heading_level: str
    page_start: int | None
    page_end: int | None
    order_index: int


@dataclass
class ParsedFigure:
    section_index: int | None
    page_number: int | None
    caption_text: str | None
    order_index: int


def _detect_sections(text_lines: List[str]) -> List[str]:
    headings = []
    heading_pattern = re.compile(r"^(\d+(?:\.\d+)*)\s+(.+)$")
    for line in text_lines:
        match = heading_pattern.match(line.strip())
        if match:
            headings.append(line.strip())
    return headings


def parse_pdf(file_path: Path) -> tuple[list[ParsedSection], list[ParsedFigure]]:
    reader = PdfReader(str(file_path))
    sections: list[ParsedSection] = []
    figures: list[ParsedFigure] = []
    order_index = 1

    for page_index, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        lines = [line for line in text.splitlines() if line.strip()]
        headings = _detect_sections(lines)
        for heading in headings:
            sections.append(
                ParsedSection(
                    heading_text=heading,
                    heading_level="H1",
                    page_start=page_index,
                    page_end=page_index,
                    order_index=order_index,
                )
            )
            order_index += 1

        for line in lines:
            if re.search(r"\b(Figure|Fig\.)\b", line, re.IGNORECASE):
                figures.append(
                    ParsedFigure(
                        section_index=len(sections) - 1 if sections else None,
                        page_number=page_index,
                        caption_text=line.strip(),
                        order_index=len(figures) + 1,
                    )
                )

    if not sections:
        sections.append(
            ParsedSection(
                heading_text="Document Overview",
                heading_level="H1",
                page_start=1,
                page_end=len(reader.pages),
                order_index=1,
            )
        )

    return sections, figures
