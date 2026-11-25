# Hallmark audit: hub Topology, Graph and Ontology tabs (PR #3113)

Target: `frontend/src/hub/TopologyCanvas.tsx`, `topology-layout.ts`, `TopologyView.tsx`, `GraphCanvas.tsx`,
`GraphView.tsx`, `OntologyView.tsx`. Viewed at iPad width (1024 px), before any change.
Genre: modern-minimal / dashboard (dark). No `design.md`, no Hallmark stamp.

## Critical

1. **Overlapping text** (Ontology, `GraphCanvas.tsx:38-40`, `OntologyView.tsx:43`).
   - Every edge label is drawn at once (`edgeLabels` is always on when nothing is selected).
   - About 20 labels pile up around Node, Hub, RetiredEntry and String. "extends" alone appears 12 times.
   - Fix: draw edge labels only for the selected concept. Hide fields and built-ins by default.
2. **No reading order** (Topology, `topology-layout.ts:9-12`).
   - The eye jumps around: the truth box is top centre, the private box is top right, Ossie is far right and strangers are bottom right.
   - Five annotations compete with the boxes: "index (rebuildable cache)", "Bearer node token + private-IP check", "GET", "?format=ossie", and "read-only, never feeds back".
   - Fix: one top-to-bottom spine (source of truth, then hub, then machines), a short caption for each row, and no labels on the lines.
3. **Too many labels per box, set too small** (`TopologyCanvas.tsx:30-38`).
   - Node boxes have 7 monospace lines at 10-13 px in a 1000-wide viewBox, which comes out at about 9-11 px on an iPad.
   - The "revoked Ns ago" line ran past the box edge.
   - Fix: 3 lines per box at 15-20 px in a sans face, cut to fit the box width. The details move to the panel that opens when a box is tapped.

## Major

4. **Jargon instead of plain words** (all three tabs).
   - Topology: `Bearer`, `401`, `403`, `ψ/`, `.arra/`, `/api/federation/*`, `arra serve --hub`.
   - Graph legend: `RetiredEntry`, `Node`, `Source`. Ontology legend: `EntityType`, `ValueType`, `BuiltIn`.
   - Fix: a plain-words legend ("Active: can read and share", "Note", "Machine", "Thing", "Field"), with the code names in tooltips.
5. **No legend for state colours and dashes** on Topology (`TopologyCanvas.tsx:10-14`).
   - Green, amber and red, solid and dashed, are only explained by the upper-case word inside each box.
   - Fix: a legend row under the drawing that shows the colour and line style for each state.
6. **Duplicated copy** (`TopologyView.tsx:84`). The private-notes sentence appears in the drawing and again in the footer. Fix: say it once, in the legend.
7. **Long labels collide** (Graph, `GraphCanvas.tsx:53`). "hub node node-a-c6a2 (node-a)" runs into "node-b". Fix: cut labels to 18 characters, with the full text in the tooltip.
8. **Upper-case jargon title** (Ontology): "ARRAMEMORY (APACHE OSSIE 0.3.0.DEV0)". Fix: "What arra stores", with the Ossie version in the footer.

## Minor

9. **Mono counts line** on Graph ("3 Document · 1 Source …"). It repeats the legend. Fix: put each count inside its legend chip.
10. **Low-contrast detail text**: `#64748b` on `#0b1220` is about 3.6:1 for the 10 px id and "since" lines. Fix: drop those lines, or use the `#94a3b8` tier.

`3 critical · 5 major · 2 minor`

Pre-emit critique of the fix (P/H/E/S/R/V): P4 H5 E4 S4 R5 V3 (Variety stays low on purpose: these are tabs of one existing app, not a new page).
