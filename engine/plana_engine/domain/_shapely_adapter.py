"""Pydantic v2 ↔ Shapely 2.x adapter (WKT-based).

Позволяет хранить shapely-геометрии прямо в Pydantic-моделях:

    class Room(BaseModel):
        model_config = {"arbitrary_types_allowed": True}
        polygon: PolygonField           # shapely.Polygon

В JSON-форме сериализуется в WKT-строку (читаемо в логах, легко дебажить).
В рантайме — нативный shapely-объект, у которого доступно `.area`, `.contains`,
`.intersection`, `.buffer` и весь остальной API GEOS.

Рецепт взят из research/cad-tools/next/geometry-shapely.md.
"""

from __future__ import annotations

from typing import Annotated, Any

import shapely
from pydantic import GetJsonSchemaHandler
from pydantic_core import core_schema
from shapely import LineString, MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry


class _ShapelyAdapter:
    """Pydantic-адаптер для shapely-геометрии через WKT.

    `validate` принимает: native shapely-объект, WKT-строку, или dict
    (GeoJSON-подобный). Сериализация в JSON — всегда WKT.
    """

    def __init__(self, geom_cls: type[BaseGeometry]) -> None:
        self.geom_cls = geom_cls

    def __get_pydantic_core_schema__(
        self,
        source_type: Any,
        handler: Any,
    ) -> core_schema.CoreSchema:
        geom_cls = self.geom_cls

        def validate(value: Any) -> BaseGeometry:
            if isinstance(value, geom_cls):
                return value
            if isinstance(value, str):
                g = shapely.from_wkt(value)
                if not isinstance(g, geom_cls):
                    raise TypeError(
                        f"WKT parsed as {type(g).__name__}, "
                        f"expected {geom_cls.__name__}"
                    )
                return g
            if isinstance(value, dict):
                g = shapely.geometry.shape(value)
                if not isinstance(g, geom_cls):
                    raise TypeError(
                        f"GeoJSON shape parsed as {type(g).__name__}, "
                        f"expected {geom_cls.__name__}"
                    )
                return g
            raise TypeError(
                f"Cannot coerce {type(value).__name__} to {geom_cls.__name__}"
            )

        return core_schema.no_info_plain_validator_function(
            validate,
            serialization=core_schema.plain_serializer_function_ser_schema(
                lambda g: shapely.to_wkt(g, rounding_precision=3),
                return_schema=core_schema.str_schema(),
                when_used="json",
            ),
        )

    def __get_pydantic_json_schema__(
        self,
        schema: core_schema.CoreSchema,
        handler: GetJsonSchemaHandler,
    ) -> dict[str, Any]:
        return {"type": "string", "format": "wkt", "title": self.geom_cls.__name__}


# Annotated-типы для прямого использования в моделях.
PolygonField = Annotated[Polygon, _ShapelyAdapter(Polygon)]
MultiPolygonField = Annotated[MultiPolygon, _ShapelyAdapter(MultiPolygon)]
LineStringField = Annotated[LineString, _ShapelyAdapter(LineString)]


__all__ = ["PolygonField", "MultiPolygonField", "LineStringField"]
