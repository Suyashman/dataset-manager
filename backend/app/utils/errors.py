class AppError(Exception):
    code = "app_error"
    status_code = 400

    def __init__(self, message: str, details: dict | None = None):
        self.message = message
        self.details = details or {}
        super().__init__(message)


class DatasetNotFoundError(AppError):
    code = "dataset_not_found"
    status_code = 404


class DuplicateDatasetNameError(AppError):
    code = "duplicate_dataset_name"
    status_code = 409


class InvalidYoloStructureError(AppError):
    code = "invalid_yolo_structure"
    status_code = 400


class PathTraversalError(AppError):
    code = "path_traversal"
    status_code = 400


class JobNotFoundError(AppError):
    code = "job_not_found"
    status_code = 404


class Sam3UnreachableError(AppError):
    code = "sam3_unreachable"
    status_code = 503
