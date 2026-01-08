from __future__ import annotations

from typing import List

import httpx
from bs4 import BeautifulSoup

from .schemas import SearchResult


async def _fetch_aerofab(query: str) -> List[SearchResult]:
    url = f"https://aerofabndt.com/search?q={query}"
    results: List[SearchResult] = []
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(url)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        for card in soup.select(".search-result"):
            title = card.select_one("h3")
            description = card.select_one(".description")
            features = [tag.get_text(strip=True) for tag in card.select(".tag")]
            link = card.select_one("a")
            if title and link:
                results.append(
                    SearchResult(
                        title=title.get_text(strip=True),
                        description=description.get_text(strip=True) if description else "",
                        features=features,
                        source="aerofabndt",
                        link=link.get("href", ""),
                    )
                )
    return results


async def _fetch_technandt(query: str) -> List[SearchResult]:
    url = f"https://technandt.com/search?q={query}"
    results: List[SearchResult] = []
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(url)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        for card in soup.select(".search-result"):
            title = card.select_one("h3")
            description = card.select_one(".description")
            features = [tag.get_text(strip=True) for tag in card.select(".feature")]
            link = card.select_one("a")
            if title and link:
                results.append(
                    SearchResult(
                        title=title.get_text(strip=True),
                        description=description.get_text(strip=True) if description else "",
                        features=features,
                        source="technandt",
                        link=link.get("href", ""),
                    )
                )
    return results


async def run_search(query: str) -> List[SearchResult]:
    results: List[SearchResult] = []
    try:
        results.extend(await _fetch_aerofab(query))
    except Exception:
        pass
    try:
        results.extend(await _fetch_technandt(query))
    except Exception:
        pass

    if not results:
        results.append(
            SearchResult(
                title="No results",
                description="Search endpoints unavailable or returned no data.",
                features=[],
                source="system",
                link="#",
            )
        )
    return results