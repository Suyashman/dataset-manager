from enum import Enum


class SplitType(str, Enum):
    train = "train"
    valid = "valid"
    test = "test"
