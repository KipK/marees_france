"""Track upstream failures without coupling the availability of providers."""

from homeassistant.components import persistent_notification
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError

from .const import DOMAIN


class ServiceUnavailable(HomeAssistantError):
    """An upstream request failed or returned unusable data."""


class ServiceAvailability:
    """Maintain one notification per provider across all configured harbors."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._failures: dict[tuple[str, str], tuple[str, str]] = {}

    @callback
    def async_update(
        self, entry_id: str, harbor: str, source: str, provider: str, available: bool
    ) -> None:
        """Report a source's recovery or failure, notifying only on changes."""
        key = (entry_id, source)
        previous = self._failures.copy()
        if available:
            self._failures.pop(key, None)
        else:
            self._failures[key] = (provider, harbor)
        if previous != self._failures:
            self._publish(provider)

    @callback
    def async_remove_entry(self, entry_id: str) -> None:
        """Remove failures belonging to an unloaded entry."""
        providers = set()
        for key, (provider, _) in list(self._failures.items()):
            if key[0] == entry_id:
                providers.add(provider)
                del self._failures[key]
        for provider in providers:
            self._publish(provider)

    @callback
    def _publish(self, provider: str) -> None:
        notification_id = f"{DOMAIN}_{provider.lower()}_unavailable"
        affected = sorted(
            f"{harbor}: {source}"
            for (_, source), (service, harbor) in self._failures.items()
            if service == provider
        )
        if not affected:
            persistent_notification.async_dismiss(self.hass, notification_id)
            return
        persistent_notification.async_create(
            self.hass,
            f"{provider} is currently unavailable or returned unusable data. "
            "Marées France will retry automatically. Valid cached data remains "
            "available; sensors without usable data are unavailable.\n\n"
            + "\n".join(f"- {item}" for item in affected),
            title=f"Marées France — {provider} unavailable",
            notification_id=notification_id,
        )


@callback
def async_get_availability(hass: HomeAssistant) -> ServiceAvailability:
    """Get the shared provider status for this Home Assistant instance."""
    key = f"{DOMAIN}_availability"
    if key not in hass.data:
        hass.data[key] = ServiceAvailability(hass)
    return hass.data[key]
