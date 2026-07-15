"""
github/client.py — Thin async wrapper around the GitHub REST API v3.

Uses httpx2.AsyncClient for all calls. Every method raises on non-2xx responses
so callers can treat failures as exceptions rather than checking return codes.
"""

import httpx2

from app.config import get_settings

_GITHUB_API_BASE = "https://api.github.com"
_TIMEOUT = httpx2.Timeout(30.0)


def _make_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


class GitHubClient:
    """Async GitHub API client — one instance per Celery task (not shared)."""

    def __init__(self, token: str | None = None) -> None:
        settings = get_settings()
        self._token = token or settings.github_app_token
        self._client = httpx2.AsyncClient(
            base_url=_GITHUB_API_BASE,
            headers=_make_headers(self._token),
            timeout=_TIMEOUT,
        )

    async def __aenter__(self) -> "GitHubClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self._client.aclose()

    async def get_pr_files(self, owner: str, repo: str, pull_number: int) -> list[dict]:
        """
        GET /repos/{owner}/{repo}/pulls/{pull_number}/files

        Returns the list of changed files with patch data.
        Raises httpx2.HTTPStatusError on non-2xx.
        """
        url = f"/repos/{owner}/{repo}/pulls/{pull_number}/files"
        response = await self._client.get(url, params={"per_page": 100})
        response.raise_for_status()
        return response.json()

    async def get_pr_info(self, owner: str, repo: str, pull_number: int) -> dict:
        """
        GET /repos/{owner}/{repo}/pulls/{pull_number}

        Returns the full pull request object.
        Raises httpx2.HTTPStatusError on non-2xx.
        """
        url = f"/repos/{owner}/{repo}/pulls/{pull_number}"
        response = await self._client.get(url)
        response.raise_for_status()
        return response.json()

    async def get_repo_info(self, owner: str, repo: str) -> dict:
        """
        GET /repos/{owner}/{repo}

        Returns the repository object (clone_url, default_branch, etc.).
        """
        url = f"/repos/{owner}/{repo}"
        response = await self._client.get(url)
        response.raise_for_status()
        return response.json()
