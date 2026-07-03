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
    validation: ValidationSettings = ValidationSettings()
    pagination: PaginationSettings = PaginationSettings()
