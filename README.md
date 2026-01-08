# apt-plan-editor-front

A modern floor plan editor web application built with React, Vite, and D3.js.

## Features

- **Interactive Floor Plan Editor**: Visual editing of apartment layouts
- **D3.js Visualization**: Professional rendering with zoom and pan support
- **React Components**: Modern component-based architecture
- **TypeScript**: Full type safety and developer experience
- **Vite**: Fast development and optimized production builds

## Getting Started

### Prerequisites

- Node.js 16+
- pnpm (or npm/yarn)

### Installation

```bash
pnpm install
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
├── main.tsx                    # Entry point
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
}
```

### FloorPlan
Complete floor plan data:
```typescript
interface FloorPlan {
  nodes: Node[];
  edges: Edge[];
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
