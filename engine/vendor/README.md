# engine/vendor — внешние бинарники (не в git)

Сюда кладётся **ODA File Converter** для DWG-экспорта (`POST /export/floorplan-dwg`).

## Что скачать

Страница: https://www.opendesign.com/guestfiles/oda_file_converter

Выбрать **Linux → DEB → `QT6 lnxX64`** (движок собирается в Linux-контейнере
`python:3.11-slim`, Debian). Файл будет вида:

```
ODAFileConverter_QT6_lnxX64_8.3dll.deb
```

Положить его **в эту папку** (`engine/vendor/`). Имя может быть любым `*.deb` —
Dockerfile подхватит первый найденный.

## Как это собирается

`engine/Dockerfile` при сборке:

1. если в `vendor/` есть `*.deb` — ставит его + `xvfb` (ODA File Converter —
   GUI-приложение на Qt, на headless-сервере запускается через виртуальный
   дисплей);
2. создаёт обёртку `/usr/local/bin/oda-convert` (`xvfb-run … ODAFileConverter`);
3. выставляет `ENV ODA_FILE_CONVERTER=/usr/local/bin/oda-convert`.

Если `.deb` нет — образ собирается без конвертера, DWG-эндпоинт честно отдаёт
503, а DXF/IFC/PDF работают как обычно.

## Почему не в git

Бинарь тяжёлый (десятки МБ) и распространяется по лицензии ODA — держим локально
/ на VPS, в git не коммитим (см. `.gitignore`).
