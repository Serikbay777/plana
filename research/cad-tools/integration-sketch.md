# Integration Sketch — конкретный план интеграции в plana

> Опираемся на рекомендацию из [`recommendation.md`](recommendation.md): **Фаза 1 = mlightcad/cad-viewer + ezdxf + ODA sidecar**.

## Файловая структура (что добавляется в проект)

```
plana/
├── src/
│   ├── app/
│   │   └── cad/
│   │       └── page.tsx                  # NEW: страница "загрузи свой DXF/DWG"
│   ├── components/
│   │   └── cad/
│   │       ├── CadViewer.tsx             # NEW: обёртка mlightcad + dynamic import
│   │       ├── CadUploader.tsx           # NEW: drag&drop, /api/dwg-to-dxf
│   │       ├── CadEditorToolbar.tsx      # NEW: panel с edit-операциями
│   │       └── useCadExport.ts           # NEW: serialize → DXF blob → download
│   └── lib/
│       └── cad/
│           ├── client.ts                 # NEW: API-вызовы /api/dwg-to-dxf, etc.
│           └── dxf-export.ts             # NEW: маппинг model → @tarikjabiri/dxf
│
├── src/app/api/
│   ├── dwg-to-dxf/
│   │   └── route.ts                      # NEW: POST DWG → DXF (proxy → engine)
│   └── cad-preview/
│       └── route.ts                      # NEW: POST DXF → PNG preview (proxy → engine)
│
├── engine/plana_engine/
│   ├── cad/
│   │   ├── floorplan_dxf.py              # exists
│   │   ├── dwg_bridge.py                 # NEW: subprocess ODA / LibreDWG
│   │   └── preview.py                    # NEW: ezdxf drawing addon → PNG
│   └── api/
│       └── routes_cad.py                 # NEW (или дополнение к существующему)
│
├── docker-compose.yml                    # MODIFY: добавить oda-converter sidecar
└── research/cad-tools/                   # этот ресерч
```

## Зависимости

### Frontend (`package.json` дополнения)

```jsonc
{
  "dependencies": {
    "@mlightcad/cad-viewer": "^1.5.0",
    "@tarikjabiri/dxf": "^4.x",           // DXF writer (TypeScript-first)
    "dxf-parser": "^1.x"                  // на всякий случай для парсинга на клиенте если потребуется минуя mlightcad
  }
}
```

### Backend (`engine/pyproject.toml` дополнения)

```toml
dependencies = [
    # ...existing...
    "ezdxf>=1.4",                          # уже должна быть — фиксируем версию с drawing addon
    "matplotlib>=3.8",                     # для ezdxf.addons.drawing → PNG/PDF
]
```

### Sidecar (`docker-compose.yml`)

```yaml
services:
  # ...existing web/engine...

  oda-converter:
    # Бесплатный официальный converter от Open Design Alliance
    # Лучше упаковать в Docker самим (ODA не публикует официальные образы) —
    # пример сборки см. https://github.com/aaroncampf/oda-file-converter-docker
    image: plana/oda-converter:latest
    volumes:
      - oda-tmp:/tmp/oda
    # Не выставляется наружу — только в internal network engine ↔ oda

volumes:
  oda-tmp:
```

Если ODA EULA не подходит — заменяем на LibreDWG CLI:

```yaml
  libredwg:
    image: ghcr.io/libredwg/libredwg:latest  # либо самосборка
    volumes:
      - libredwg-tmp:/tmp/libredwg
```

---

## POC sniplets

### 1. `src/components/cad/CadViewer.tsx`

```tsx
'use client';

import { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';

// mlightcad — есть Vue UI; используем low-level API его core (не Vue-компонент).
// Точные импорты сверить с актуальным README на момент интеграции.
const loadCadCore = () =>
  import('@mlightcad/cad-viewer').then((m) => m.createViewer ?? m);

type Props = {
  fileUrl?: string;     // URL DXF (после конвертации DWG→DXF на сервере)
  fileBlob?: Blob;      // или прямо blob
  onReady?: (api: CadViewerApi) => void;
};

export function CadViewer({ fileUrl, fileBlob, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CadViewerApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    (async () => {
      const createViewer = await loadCadCore();
      if (disposed || !containerRef.current) return;

      const viewer = await createViewer({
        container: containerRef.current,
        // editing-режим включается из UI; см. mlightcad docs
      });

      if (fileBlob) await viewer.openBlob(fileBlob);
      else if (fileUrl) await viewer.openUrl(fileUrl);

      viewerRef.current = viewer;
      onReady?.(viewer);
    })();

    return () => {
      disposed = true;
      viewerRef.current?.dispose?.();
    };
  }, [fileUrl, fileBlob, onReady]);

  return <div ref={containerRef} className="w-full h-[80vh]" />;
}

// Грубый тип публичного API — уточнить из mlightcad
type CadViewerApi = {
  openUrl(url: string): Promise<void>;
  openBlob(blob: Blob): Promise<void>;
  exportEntities(): unknown[];   // если у них появится — взять; иначе сериализуем своим
  dispose(): void;
};
```

### 2. `src/components/cad/CadUploader.tsx`

```tsx
'use client';

import { useState } from 'react';

type Props = { onReadyDxf: (blob: Blob) => void };

export function CadUploader({ onReadyDxf }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const ext = file.name.toLowerCase().split('.').pop();

      if (ext === 'dxf') {
        onReadyDxf(file);
        return;
      }

      if (ext === 'dwg') {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/dwg-to-dxf', { method: 'POST', body: fd });
        if (!res.ok) throw new Error(`DWG→DXF failed: ${res.status}`);
        const dxfBlob = await res.blob();
        onReadyDxf(dxfBlob);
        return;
      }

      throw new Error(`Unsupported format: .${ext}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-dashed border p-8">
      <input
        type="file"
        accept=".dxf,.dwg"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
        disabled={busy}
      />
      {busy && <p>Конвертирую…</p>}
      {error && <p className="text-red-500">{error}</p>}
    </div>
  );
}
```

### 3. `src/app/api/dwg-to-dxf/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server';

// Прокси-эндпоинт. Сам не делает конвертацию — пересылает на Python engine.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof Blob)) {
    return new NextResponse('No file', { status: 400 });
  }

  const upstream = new FormData();
  upstream.append('file', file);

  const engineUrl = process.env.ENGINE_URL ?? 'http://engine:8000';
  const r = await fetch(`${engineUrl}/cad/dwg-to-dxf`, {
    method: 'POST',
    body: upstream,
  });

  if (!r.ok) return new NextResponse(await r.text(), { status: r.status });

  const dxf = await r.arrayBuffer();
  return new NextResponse(dxf, {
    headers: {
      'Content-Type': 'application/dxf',
      'Content-Disposition': 'attachment; filename="converted.dxf"',
    },
  });
}
```

### 4. `engine/plana_engine/cad/dwg_bridge.py`

```python
"""DWG ↔ DXF мост через ODA File Converter (sidecar)."""
from __future__ import annotations
import subprocess
import tempfile
from pathlib import Path


# Путь к ODA CLI внутри sidecar — пробросить через ENV.
ODA_BIN = "/opt/oda/ODAFileConverter"

def dwg_to_dxf(dwg_bytes: bytes) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        in_dir = Path(tmp) / "in"
        out_dir = Path(tmp) / "out"
        in_dir.mkdir()
        out_dir.mkdir()
        (in_dir / "input.dwg").write_bytes(dwg_bytes)

        # ODA File Converter CLI:
        # ODAFileConverter <inDir> <outDir> <outVersion> <outFormat> <recurse> <audit>
        # outVersion: ACAD2018, outFormat: DXF
        result = subprocess.run(
            [ODA_BIN, str(in_dir), str(out_dir),
             "ACAD2018", "DXF", "0", "1"],
            capture_output=True,
            timeout=60,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(f"ODA failed: {result.stderr.decode()}")

        out_file = out_dir / "input.dxf"
        if not out_file.exists():
            raise RuntimeError("ODA produced no output")
        return out_file.read_bytes()
```

LibreDWG-вариант (fallback):

```python
def dwg_to_dxf_libredwg(dwg_bytes: bytes) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "in.dwg"
        dst = Path(tmp) / "out.dxf"
        src.write_bytes(dwg_bytes)
        # dwg2dxf поставляется с libredwg
        subprocess.run(["dwg2dxf", "-o", str(dst), str(src)], check=True)
        return dst.read_bytes()
```

### 5. `engine/plana_engine/api/routes_cad.py` (фрагмент)

```python
from fastapi import APIRouter, UploadFile, File, HTTPException, Response
from plana_engine.cad.dwg_bridge import dwg_to_dxf

router = APIRouter(prefix="/cad", tags=["cad"])

@router.post("/dwg-to-dxf")
async def convert_dwg(file: UploadFile = File(...)) -> Response:
    if not file.filename or not file.filename.lower().endswith(".dwg"):
        raise HTTPException(400, "Expected .dwg file")
    data = await file.read()
    try:
        dxf = dwg_to_dxf(data)
    except RuntimeError as exc:
        raise HTTPException(502, f"Conversion failed: {exc}") from exc
    return Response(content=dxf, media_type="application/dxf")
```

### 6. `src/lib/cad/dxf-export.ts` — клиентский экспорт

```ts
// Минимальный пример: берём список Three.js Object3D, который mlightcad/наш
// собственный редактор накопил, и сериализуем в DXF через @tarikjabiri/dxf.
//
// На практике вместо Three.js Object3D будет промежуточная "doc model"
// от mlightcad (или своя). Этот код — иллюстрация маппинга, не финальный.

import { Writer, Line, Color, Units } from '@tarikjabiri/dxf';

export type EditedShape =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; layer: string }
  | { kind: 'circle'; cx: number; cy: number; r: number; layer: string };

export function shapesToDxf(shapes: EditedShape[]): string {
  const writer = new Writer();
  writer.setUnits(Units.Millimeters);

  for (const s of shapes) {
    switch (s.kind) {
      case 'line':
        writer.addEntity(
          new Line({ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }, { layerName: s.layer })
        );
        break;
      case 'circle':
        // … аналогично
        break;
    }
  }
  return writer.stringify();
}

export function downloadDxf(dxf: string, filename = 'plan.dxf'): void {
  const blob = new Blob([dxf], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

> ⚠ Точные имена методов `@tarikjabiri/dxf` могут отличаться — сверять с актуальным README пакета на момент интеграции.

---

## Минимальный POC чек-лист (1 неделя)

- [ ] Поставить `@mlightcad/cad-viewer` в `package.json`, проверить что dynamic import не ломает SSR
- [ ] Сверстать `src/app/cad/page.tsx` с `CadUploader + CadViewer`
- [ ] Прокинуть путь "DXF файл → viewer" в обход бекенда
- [ ] Сделать ODA sidecar (или LibreDWG), завести `/api/dwg-to-dxf` proxy
- [ ] Проверить путь "DWG файл → /api/dwg-to-dxf → DXF blob → viewer"
- [ ] Включить хотя бы один edit-режим (move) в mlightcad UI
- [ ] Сделать download-кнопку: пока через ezdxf на сервере (rewrite текущего DXF c апплайнутыми move'ами) — пока не появится клиентский export

## Идеи для второй итерации

- **Server-side preview**: `ezdxf.addons.drawing` → PNG превью на 64KB. Класть в кеш по hash-у файла. Полезно для list-страниц.
- **Локализация**: mlightcad command-line — английский. Если делаем на русском/казахском — переопределить i18n.
- **Auto-detect версии DXF** и downscale до R2013/R2018 при экспорте, чтобы открывалось в максимальном диапазоне CAD-программ.
- **Layer mapping**: завести нормализатор имён слоёв "WALL/DOOR/WINDOW" по KZ-конвенции (см. `research/kz-norms/`).
- **Audit на сервере**: ezdxf умеет audit() — починить битые DXF до отдачи на клиент.

---

## Когда что-то ломается — куда смотреть

| Симптом | Где копать |
|---|---|
| DWG не парсится в браузере (mlightcad) | LibreDWG WASM — отправлять на серверную ODA-конвертацию (запасной путь) |
| Огромный DXF тормозит | Перевести парсинг в Web Worker (vagran это умеет, mlightcad — частично) |
| Экспортированный DXF не открывается в AutoCAD | Проверить версию (AC1027/2013 — широко совместимая) и `$INSUNITS` |
| Кириллица в текстах ломается | DXF text encoding — TEXT entity vs MTEXT; настроить `$DWGCODEPAGE` |
| ezdxf не находит шрифты при рендере | Установить системные шрифты в Docker образе engine |

---

См. также [`format-primer.md`](format-primer.md) — про сами форматы, и [`sources.md`](sources.md) — все источники ресерча.
