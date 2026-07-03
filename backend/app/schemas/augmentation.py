from typing import Literal

from pydantic import BaseModel

AugTechniqueType = Literal["flip", "rotate", "hsv", "blur", "noise"]


class AugTechniqueConfig(BaseModel):
    type: AugTechniqueType
    copies: int = 1
    angle_range: tuple[float, float] = (-15, 15)
    hsv_h: float = 0.015
    hsv_s: float = 0.7
    hsv_v: float = 0.4
    blur_kernel_range: tuple[int, int] = (3, 7)
    noise_sigma_range: tuple[float, float] = (5, 25)


class AugmentRequest(BaseModel):
    source: str
    destination: str
    techniques: list[AugTechniqueConfig]
