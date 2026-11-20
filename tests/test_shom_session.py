"""Test the maree.shom.fr session challenge and token handling."""

import hashlib
from unittest.mock import AsyncMock, MagicMock, patch

import aiohttp
import pytest

from custom_components.marees_france.api_helpers import (
    _async_fetch_shom,
    _async_get_shom_token,
    _solve_shom_challenge,
)
from custom_components.marees_france.availability import ServiceUnavailable
from custom_components.marees_france.const import (
    HEADERS,
    SHOM_CHALLENGE_URL,
    SHOM_TOKEN_HEADER,
    SHOM_TOKEN_URL,
)

CHALLENGE = {"salt": "13bad237ea5a861b", "challenge": "signed", "difficulty": 2}


@pytest.fixture(autouse=True)
def mock_shom_token():
    """Exercise the real token handling."""
    yield


def context(payload=None, status=200):
    response = MagicMock()
    response.json = AsyncMock(return_value=payload)
    if status >= 400:
        response.raise_for_status.side_effect = aiohttp.ClientResponseError(
            MagicMock(), (), status=status, message="Unauthorized"
        )
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=response)
    ctx.__aexit__ = AsyncMock(return_value=None)
    return ctx


def token_session(*tokens):
    """Return a session issuing the given tokens, one per challenge."""
    session = MagicMock()
    session.get.side_effect = lambda url, **kwargs: context(CHALLENGE)
    session.post.side_effect = [
        context({"token": token, "expiresIn": 1800}) for token in tokens
    ]
    return session


def test_solve_challenge_matches_site_algorithm():
    nonce = _solve_shom_challenge("13bad237ea5a861b", 3)
    digest = hashlib.sha256(f"13bad237ea5a861b{nonce}".encode()).hexdigest()
    assert digest.startswith("000")
    assert not any(
        hashlib.sha256(f"13bad237ea5a861b{n}".encode()).hexdigest().startswith("000")
        for n in range(1, nonce)
    )


async def test_token_is_requested_once_and_cached(hass):
    session = token_session("tok-1")

    assert await _async_get_shom_token(hass, session) == "tok-1"
    assert await _async_get_shom_token(hass, session) == "tok-1"

    session.get.assert_called_once_with(SHOM_CHALLENGE_URL, headers=HEADERS)
    session.post.assert_called_once()
    args, kwargs = session.post.call_args
    assert args == (SHOM_TOKEN_URL,)
    assert kwargs["headers"] == HEADERS
    assert kwargs["json"] == {
        "challenge": "signed",
        "nonce": _solve_shom_challenge("13bad237ea5a861b", 2),
    }


async def test_rejected_token_is_renewed_once(hass):
    session = token_session("tok-1", "tok-2")
    data_requests = []

    def get(url, *, headers):
        if url == SHOM_CHALLENGE_URL:
            return context(CHALLENGE)
        data_requests.append(headers[SHOM_TOKEN_HEADER])
        if headers[SHOM_TOKEN_HEADER] == "tok-1":
            return context(status=401)
        return context({"2026-11-20": []})

    session.get.side_effect = get
    with patch("custom_components.marees_france.api_helpers.API_REQUEST_DELAY", 0):
        data = await _async_fetch_shom(
            hass, session, "https://example.test/hlt", 1, "VANNES", "tides"
        )

    assert data == {"2026-11-20": []}
    assert data_requests == ["tok-1", "tok-2"]


async def test_token_failure_is_service_unavailable(hass):
    session = MagicMock()
    session.get.side_effect = lambda url, **kwargs: context(status=403)

    with pytest.raises(ServiceUnavailable):
        await _async_get_shom_token(hass, session)
