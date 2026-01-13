# apt-plan-editor-front

A modern floor plan editor web application built with React, Vite, and D3.js.

## Features

- **Interactive Floor Plan Editor**: Visual editing of apartment layouts
- **D3.js Visualization**: Professional rendering with zoom and pan support
- **Adaptive Rendering**: 
  - Walls rendered as polygons with thickness (from backend API)
  - Rooms with color-coded classification (bedroom, kitchen, bathroom, etc.)
  - Fixtures as polygons (doors, windows, furniture)
  - Fallback to simple line rendering for basic data
- **Backend Integration**: Upload images for automatic floor plan digitalization
- **React Components**: Modern component-based architecture
- **TypeScript**: Full type safety and developer experience
- **Vite**: Fast development and optimized production builds

## Getting Started

### Prerequisites

- Node.js 16+
- pnpm (or npm/yarn)
- Backend API running on port 8000 (see `docs/REST_API.md`)

### Installation

```bash
pnpm install
```

### Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env` to set the backend API URL:
```
VITE_API_BASE_URL=http://localhost:8000
```

### Development

```bash
pnpm run dev
```

The application will be available at `http://localhost:5173`

### Build

```bash
pnpm run build
```

### Preview Production Build

```bash
pnpm run preview
```

## Project Structure

```
src/
├── components/
│   ├── FloorPlanCanvas.tsx    # D3 floor plan visualization
│   ├── FloorPlanCanvas.css
│   ├── EditorLayout.tsx       # Main editor layout
│   └── EditorLayout.css
├── App.tsx                     # Root component
├── App.css
├── index.tsx                    # Entry point
├── index.css
├── types.ts                    # TypeScript interfaces
├── data.ts                     # Sample floor plan data
└── index.ts                    # Legacy exports
```

## Data Structure

### Node
Represents a point in the floor plan:
```typescript
interface Node {
  id: string;
  x: number;
  y: number;
}
```

### Edge
Represents a wall, door, or window:
```typescript
interface Edge {
  id: string;
  source: string;  // Node ID
  target: string;  // Node ID
  type: "wall" | "door" | "window";
  thickness?: number;       // Wall thickness for polygon rendering
  is_inner?: boolean;       // Inner vs outer wall
  properties?: object;      // Additional metadata
}
```

### Room
Represents a classified room polygon:
```typescript
interface Room {
  id: string;
  polygon_coords: [number, number][];
  tags: string[];  // e.g., ["bedroom"], ["kitchen"]
}
```

### Fixture
Represents doors, windows, furniture:
```typescript
interface Fixture {
  id: string;
  polygon_coords: [number, number][];
  fixture_type: string;     // "door", "window", etc.
  properties?: object;
}
```

### FloorPlan
Complete floor plan data:
```typescript
interface FloorPlan {
  nodes: Node[];
  edges: Edge[];
  rooms?: Room[];
  fixtures?: Fixture[];
}
```

## Technologies

- **React 18**: UI framework
- **Vite**: Build tool and dev server
- **TypeScript**: Type safety
- **D3.js**: Data visualization
- **CSS3**: Styling

## License

ISC
