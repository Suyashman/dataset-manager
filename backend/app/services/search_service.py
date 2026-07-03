from app.config import SPLITS
from app.services import metadata_service, yolo_service
from app.utils.file_ops import iter_image_files


def search(query: str, scope: str = "all", dataset_filter: str | None = None) -> dict:
    q = query.lower()
    results: dict[str, list[dict]] = {"images": [], "classes": [], "filenames": [], "prefixes": []}

    names = [dataset_filter] if dataset_filter else yolo_service.list_dataset_names()

    for name in names:
        if scope in ("classes", "all"):
            classes = yolo_service.get_classes(name)
            for cid, cname in classes.items():
                if q in cname.lower():
                    results["classes"].append({"dataset": name, "class_id": cid, "class_name": cname})

        if scope in ("images", "filenames", "all"):
            path = yolo_service.dataset_path(name)
            for split in SPLITS:
                for img in iter_image_files(path / split / "images"):
                    if q in img.name.lower():
                        results["filenames"].append({"dataset": name, "split": split, "filename": img.name})
                        if scope == "images":
                            results["images"].append({"dataset": name, "split": split, "filename": img.name})

        if scope in ("prefixes", "all"):
            meta = metadata_service.load_metadata(name)
            for prefix in meta.get("numbering", {}).keys():
                if q in prefix.lower():
                    results["prefixes"].append({"dataset": name, "prefix": prefix, "last_number": meta["numbering"][prefix]["last_number"]})

    return results
