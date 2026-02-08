# design.md

**Version:** 1.2  
**Last updated:** 2026-02-08  
**Status:** Living document  
**Authority:** Technical decisions source of truth

---

## Purpose

Defines technical architecture, design patterns, and implementation guidelines for the floor plan editor. Answers "how are we building this?" and guides all code decisions.

---

## 1. Architecture Overview

### 1.1 System Context

- Interactive web-based floor plan editor for apartment layouts
- Integrates with: FastAPI backend, D3.js visualization, browser local storage
- Backend API: Floor plan processing, user/plan persistence (see REST_API.md)
- Serves: Web app users via React components
- Does not handle: Image processing (delegated to backend), authentication (future)

### 1.2 High-Level Architecture

**Architecture style:** Component-based web app (React + Vite) + REST API

```
┌─────────────┐
│   Browser   │
└──────┬──────┘
       │
┌──────▼──────────────────────────────┐
│         React Application            │
├──────────────────────────────────────┤
│  EditorLayout (Layout Manager)       │
│  ├─ Left Panel (Projects List)       │
│  ├─ Center Panel (FloorPlanCanvas)   │
│  └─ Right Panel (Roomly Assistant)   │
└──────┬───────────────────────────────┘
       │
┌──────▼──────────────────┐
│  D3.js Visualization    │
│  (Nodes & Edges)        │
└─────────────────────────┘
       │
┌──────▼──────────────────┐
│   API Client (fetch)    │
└──────┬──────────────────┘
       │ HTTP
┌──────▼──────────────────┐
│  FastAPI Backend        │
│  (Floor plan processing)│
└─────────────────────────┘
```

**Component responsibilities:**
- `EditorLayout`: Layout management, panel resizing, state management, API orchestration
- `FloorPlanCanvas`: D3 visualization, SVG rendering, zoom/pan controls
- `api/client`: REST API calls, type-safe backend communication
- `utils/converter`: Transform API data to frontend format
- `App`: Root component, provider setup

### 1.3 Technology Stack

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| Framework | React | 18.2.0 | Component-based UI, modern ecosystem |
| Runtime | TypeScript | 5.9.3 | Type safety, developer experience |
| Build | Vite | 5.1.0 | Fast dev server, optimized bundling |
| Visualization | D3.js | 7.9.0 | Professional graph/geometry handling |
| Styling | CSS | Native | No external deps, simple layout |
| Backend API | FastAPI | Python | Floor plan processing, persistence |

**API Communication:**
- REST API via fetch (native)
- Base URL: `http://localhost:8000` (configurable via `.env`)
- Endpoints:
  - `/floor-plans/process-image` — upload & process image
  - `/floor-plans/{id}` — get/update/delete floor plan
  - `/floor-plans/user/{userId}` — list user's plans
  - `/floor-plans/{id}/redesign` — generate multiple redesign alternatives
  - `/floor-plans/{id}/alternatives` — list persisted alternatives

**Constraints:**
- ✅ TypeScript for all code
- ✅ Functional React components with hooks
- ✅ D3.js for visualization only
- ✅ Type-safe API client
- ❌ No state management library (hooks sufficient)

---

## 2. Design Principles

### 2.1 Core Principles

**1. Separation of Concerns**
- Layout logic (EditorLayout) separate from visualization (FloorPlanCanvas)
- D3 rendering isolated from React state updates

**2. Unidirectional Data Flow**
- FloorPlan data flows down as props
- Events bubble up via callbacks (`onEdgeClick`, etc.)

**3. Type Safety First**
- All data structures defined in `types.ts` as TypeScript interfaces
- PropTypes checked at compile time

### 2.2 Data Model

**Core entities:**
```typescript
Node: { id, x, y }          // Junction points
Edge: { id, source, target, type, thickness?, is_inner?, properties? }
Room: { id, polygon_coords, tags }  // Room polygons with classification
Fixture: { id, polygon_coords, fixture_type, properties? }  // Doors, windows, furniture
FloorPlan: { nodes[], edges[], rooms?, fixtures? }
```

**Redesign types (API client):**
```typescript
RedesignRequest: { desires?, rooms?, room_adjacencies?, locked_room_ids?, num_alternatives?, cell_size?, max_solve_time? }
RedesignResponse: { alternatives: RedesignAlternative[], total }
RedesignAlternative: { floor_plan: FloorPlanDetail, solve_time, message }
```

**Redesign modes:**
- **Desires-based** (primary): Send `desires` (free text) + `locked_room_ids`. Backend LLM extracts constraints automatically.
- **Explicit**: Send `rooms` + `room_adjacencies` directly. No LLM involved.

**Edge types:** `"wall"`, `"door"`, `"window"` — determines visual styling

**Rendering modes:**
- **Polygon mode**: When edges have `thickness` → walls rendered as filled rectangles
- **Line mode**: Fallback for simple data → walls rendered as lines (sample data)

### 2.3 Rendering Strategy

**Adaptive rendering based on data richness:**

1. **Rooms** (if available): Rendered as filled polygons with color-coded tags
   - Bedroom: Light blue
   - Bathroom: Light pink  
   - Kitchen: Peach
   - Living: Light green
   - Default: Light gray

2. **Walls**: 
   - If `thickness` present: Rendered as polygons using perpendicular offset
   - Else: Fallback to lines (4px stroke)
   - Inner walls vs outer walls distinguished by color

3. **Fixtures** (if available): Rendered as polygons by type
   - Doors: Brown fill
   - Windows: Sky blue fill
   - Else: Fallback to edge rendering (dashed/solid lines)

4. **Nodes**: Hidden for complex plans (>50 nodes), shown for debugging simple plans

**D3 lifecycle:**
- SVG managed by `FloorPlanCanvas` component
- Re-render on `floorPlan` prop change
- Zoom/pan via D3 event listeners
- Auto-centering with bounds calculation from nodes/rooms/fixtures

---

## 3. Key Interactions

### 3.1 Upload & Process Flow
1. User clicks "Upload Image" → file input opens
2. User selects image → `processFloorPlanImage(file, userId, name)`
3. Backend processes image, returns `FloorPlanDetail` with nodes/edges/rooms/fixtures
4. Frontend converts API format to `FloorPlan` via `convertApiToFloorPlan()`
5. Canvas re-renders with digitalized floor plan

### 3.2 Load Existing Plan
1. On mount: `listUserFloorPlans(userId)` → display in left panel
2. User clicks plan → `getFloorPlan(planId)` → convert → render

### 3.3 Panel Resizing
- `EditorLayout` tracks left/right panel widths in state
- Mouse drag on dividers triggers `handleMouseDown` → resize logic
- Width clamped to 150–400px per panel

### 3.4 Canvas Interaction
- D3 renders nodes as circles, edges as lines
- `onEdgeClick` callback wired for future selection/editing
- Zoom/pan controlled by D3's built-in handlers

### 3.5 Redesign Flow
1. User enters Redesign Mode via toggle button
2. User clicks rooms on canvas (or checkboxes) to lock/unlock rooms to preserve
3. User types free-form desires in the text area (e.g., "I want a larger kitchen connected to the living room")
4. User clicks "Submit Redesign Request" → `redesignFloorPlan(planId, { desires, locked_room_ids, num_alternatives })`
5. Backend LLM extracts structured constraints from desires text (with floor plan image + layout context)
6. Backend runs CP-SAT solver for N alternatives, persists each as a child floor plan
7. Response contains `RedesignResponse` with list of `RedesignAlternative` objects
8. Frontend loads the first alternative, exits redesign mode, reloads plan list
9. Previously generated alternatives are retrievable via `getFloorPlanAlternatives(planId)`

**UI states during redesign:**
- Button disabled + "Redesigning..." text while API call is in progress
- Error displayed if extraction or solver fails
- Success alert with number of alternatives generated

---

## 4. File Structure Rationale

```
src/
├── types.ts          → Single source of truth for data shapes
├── data.ts           → Sample/mock data (4-room apartment)
├── api/
│   └── client.ts     → REST API client, typed endpoints (incl. redesign & alternatives)
├── utils/
│   └── converter.ts  → API ↔ Frontend data transformation
├── components/
│   ├── FloorPlanCanvas.tsx  → D3 visualization logic
│   └── EditorLayout.tsx     → Main layout + API orchestration
└── App.tsx           → Entry point
```

**API Data Flow:**
```
Backend API Response → convertApiToFloorPlan() → FloorPlan → FloorPlanCanvas
```

---

## 5. Future Considerations

- Authentication & authorization (JWT)
- WebSocket for real-time collaboration
- Undo/redo stack
- Room labeling and metadata editing
- Export to image/PDF
- Offline mode with local cache
- Plan sharing & permissions
- Redesign alternatives comparison UI (side-by-side view)
- ~~Room locking UI (select rooms to preserve before redesign)~~ ✅ Implemented (click rooms on canvas or checkboxes)
- ~~Desires-based redesign (free-form text → LLM constraint extraction → solver)~~ ✅ Implemented
