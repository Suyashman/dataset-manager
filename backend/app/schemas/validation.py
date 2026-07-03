from pydantic import BaseModel


class ValidationIssue(BaseModel):
    check: str
    severity: str  # error | warning | info
    split: str | None = None
    file: str | None = None
    line_number: int | None = None
    message: str
    details: dict = {}


class ValidationReport(BaseModel):
    dataset: str
    issues: list[ValidationIssue]
    summary: dict[str, int]
