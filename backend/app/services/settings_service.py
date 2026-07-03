from app.config import SETTINGS_FILE
from app.schemas.settings import SettingsModel
from app.utils.atomic_io import atomic_write_json, read_json


def load_settings() -> SettingsModel:
    data = read_json(SETTINGS_FILE, default=None)
    if data is None:
        settings = SettingsModel()
        save_settings(settings)
        return settings
    return SettingsModel(**data)


def save_settings(settings: SettingsModel) -> None:
    atomic_write_json(SETTINGS_FILE, settings.model_dump())
