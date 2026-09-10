from pydantic import BaseModel, Field


class Sam3ClassSpec(BaseModel):
    name: str
    prompts: list[str] = []


class Sam3RunRequest(BaseModel):
    images: str
    classes: list[Sam3ClassSpec]
    name: str
    sample: int | None = Field(None, ge=1)


class Sam3CancelRequest(BaseModel):
    run: str | None = None


class Sam3DecisionRequest(BaseModel):
    run: str
    file: str
    idx: int
    # "accept" | "reject" | {"cls": n} | None to clear
    decision: str | dict | None = None


class Sam3RefineRequest(BaseModel):
    run: str
    file: str
    text: str | None = None
    boxes: list[list[float]] = []   # [[x1,y1,x2,y2], ...] normalized 0..1
    labels: list[int] = []          # 1 positive, 0 negative
    threshold: float = Field(0.25, ge=0.0, le=1.0)


class Sam3AdoptRequest(BaseModel):
    run: str
    file: str
    cls: int
    instances: list[dict]


class Sam3ExportRequest(BaseModel):
    run: str
    out: str
    accept: str = "0.6"
    reject: str = "0.4"
    val: float = Field(0.2, ge=0.0, le=1.0)
    group_by_dir: bool = False
    copy_images: bool = False


class Sam3ImportRequest(BaseModel):
    """Fold an already-exported SAM3 dataset into a Dataset Manager dataset."""
    export_dir: str
    destination: str
    prefix: str
    splits_to_include: list[str] = ["train", "valid", "test"]
    class_filter: dict[str, str] | None = None
