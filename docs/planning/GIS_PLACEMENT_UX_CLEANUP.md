# GIS Placement UX Cleanup

Date: 2026-06-12
Status: active implementation note

## Product Direction

Plana should feel like a real-site masterplanning tool, not a collection of disconnected AI demos.

Primary flow:

```text
/map -> select one or more real parcels -> send to /app -> generate/control masterplan -> validate -> cost -> save/export
```

Secondary flow:

```text
/app -> Building Placement tab -> upload site image + building image -> generate visual placement
```

The secondary flow is useful for fast visual demos, but it should not compete with the GIS masterplan flow.

## Navigation Rules

Show these top-level tabs:

- AI Drawings
- Visualizations
- Building Placement
- PDF Visualization
- Architectural Drawings
- Site Cost

Hide from the main tab strip for now:

- Legacy multi-photo residential-complex placement variants

Reason: it overlaps with Building Placement and GIS Masterplan. Keep the code available as an advanced/backend capability, but do not make the user choose between similar-looking placement tabs.

## Building Placement Tab

Purpose:

Generate a clear visual placement of a building/render onto a site/aerial image.

Keep only essential user-facing information:

- site/aerial image upload
- building/render image upload
- site width
- site depth
- floors
- generate button
- generated image result
- download/regenerate actions

Do not show in this tab:

- cost estimate overlay
- detailed assumptions
- long validation lists
- advanced GIS context

Those belong to:

- GIS Masterplan workspace
- Site Cost tab
- report/export flow

## GIS Masterplan Workspace

Purpose:

Control a real selected parcel from GIS.

User-facing essentials:

- selected parcel summary
- total area
- functional zone
- warnings if parcel looks social/non-residential
- AI masterplan generation
- scenario cards
- editable objects
- TEP summary
- rule status
- cost handoff

Avoid noisy data by default:

- raw GeoJSON
- full coordinate arrays
- long source/debug metadata
- duplicate metric tables

Show technical/source details only in collapsible sections.

## Cost Tab

Rename user-facing navigation from "Placement" wording to "Site Cost".

Purpose:

Explain Class 5 cost estimate from either manual inputs or GIS/masterplan handoff.

The cost tab should not look like another placement tool.

## Next UX Slices

### Slice A - Navigation cleanup

- Show Building Placement as its own tab.
- Rename cost tab to Site Cost.
- Hide legacy placement variants from main navigation.
- Remove cost overlay from Building Placement.

Done when:

- user can clearly distinguish visual placement, GIS masterplan, and cost.

### Slice B - GIS masterplan action flow

- Add "Open in editor" on AI scenario cards.
- Convert scenario objects into editable workspace objects.
- Preserve parcel context.
- Recalculate TEP/rules after selection.

Done when:

- generated scenario becomes editable, not just previewed.

### Slice C - Minimal user-facing metrics

- Create compact masterplan summary cards:
  - area
  - footprint
  - GFA
  - FAR/KIT
  - coverage
  - green area
  - warnings count
- Move detailed issues into collapsible panels.

Done when:

- founder/user can read the result in 10 seconds.

### Slice D - Save and reopen GIS masterplan

- Save selected parcels.
- Save selected scenario/objects.
- Save validation and cost snapshot.
- Reopen from project history.

Done when:

- refresh/history does not lose the GIS masterplan.
