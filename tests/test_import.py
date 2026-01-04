"""Test importing the integration."""


def test_import():
    """Test that the integration can be imported."""
    import custom_components.marees_france

    assert custom_components.marees_france is not None

    # Try importing specific modules
    from custom_components.marees_france import const

    assert const.DOMAIN == "marees_france"

    from custom_components.marees_france import config_flow

    assert config_flow.MareesFranceConfigFlow is not None

    from custom_components.marees_france import coordinator

    assert coordinator.MareesFranceUpdateCoordinator is not None

    from custom_components.marees_france import sensor, number

    assert sensor is not None
    assert number is not None

    # Try importing the frontend module
    try:
        from custom_components.marees_france import frontend

        assert frontend is not None
        print("Frontend module imported successfully")
    except ImportError as e:
        print(f"Error importing frontend module: {e}")
