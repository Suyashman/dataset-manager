from pydantic import BaseModel


class ValidationSettings(BaseModel):
    full_scan: bool = True
    hash_duplicate_check: bool = True


class PaginationSettings(BaseModel):
    image_grid_page_size: int = 60


class SettingsModel(BaseModel):
    schema_version: int = 1
    default_dataset_folder: str = "datasets"
    default_export_folder: str = "datasets"
    default_prefixes: list[str] = ["H", "C", "V"]
    theme: str = "dark"
    # Base URL of the standalone SAM3 auto-labeler. It runs in its own venv on a machine with a
    # CUDA GPU and is never started or installed by this app, so this can point at localhost or
    # another box on the LAN. An unreachable URL is a normal state, not a misconfiguration.
    sam3_sidecar_url: str = "http://127.0.0.1:8800"
    validation: ValidationSettings = ValidationSettings()
    pagination: PaginationSettings = PaginationSettings()
