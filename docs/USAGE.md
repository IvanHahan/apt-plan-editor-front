# Usage Guide

## Quick Start

1. **Start the backend API** (see REST_API.md):
   ```bash
   python -m uvicorn src.app.main:app --reload
   ```

2. **Start the frontend**:
   ```bash
   pnpm dev
   ```

3. **Open browser**: http://localhost:5173

## Features

### Upload Floor Plan Image
1. Click **"Upload Image"** button in the header
2. Select a floor plan image (JPG, PNG, etc.)
3. Wait for processing (backend extracts layout automatically)
4. Digitalized floor plan appears on canvas with:
   - **Walls as polygons** with proper thickness
   - **Rooms** color-coded by type (bedroom, kitchen, bathroom, living)
   - **Fixtures** (doors, windows) as polygons
   - **Automatic centering and scaling**

### View Your Plans
- Left panel shows all your uploaded plans
- Click any plan to load it
- Shows room count for each plan

### Navigate Canvas
- **Zoom**: Mouse wheel or pinch gesture
- **Pan**: Click and drag
- **Reset**: Click "Reset Zoom" button

### Create New Plan
- Click "New project" to reset to sample floor plan

## Current User ID
For demo purposes, the app uses a hardcoded user ID:
```typescript
const DEMO_USER_ID = '550e8400-e29b-41d4-a716-446655440000';
```

In production, this would come from authentication.

## Configuration

Edit `.env` to change API URL:
```
VITE_API_BASE_URL=http://localhost:8000
```

## Data Flow

1. **Upload** → POST `/floor-plans/process-image`
   - Sends: Image file + user_id + optional name
   - Returns: Complete floor plan with nodes, edges (with thickness), rooms, fixtures

2. **List Plans** → GET `/floor-plans/user/{user_id}`
   - Returns: Array of plan summaries

3. **Load Plan** → GET `/floor-plans/{plan_id}`
   - Returns: Full plan details with all data

4. **Conversion** → `convertApiToFloorPlan(apiData)`
   - Transforms backend format to frontend `FloorPlan` interface
   - Maps `from_node/to_node` → `source/target`
   - Maps `edge_type` → EdgeType enum
   - Preserves thickness, rooms, fixtures data

5. **Rendering** → `FloorPlanCanvas`
   - **Adaptive rendering** based on data richness:
     - If edges have `thickness`: Render walls as filled polygons
     - If rooms present: Render room polygons with color coding
     - If fixtures present: Render fixture polygons
     - Otherwise: Fallback to simple line rendering
   - Calculate perpendicular offsets for wall thickness
   - Auto-center based on all geometry (nodes + rooms + fixtures)

## Troubleshooting

### "Failed to load plans" error
- Ensure backend API is running on port 8000
- Check console for CORS errors
- Verify user exists in database

### "Failed to process image" error
- Check image file is valid (JPG/PNG)
- Ensure backend has required dependencies
- Check backend logs for processing errors

### Canvas not rendering
- Open browser console for errors
- Verify floor plan data has valid nodes and edges
- Check D3.js loaded correctly
