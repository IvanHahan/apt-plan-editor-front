# Floor Plan Editor API Documentation

## Overview

The Floor Plan Editor API is a RESTful service for processing floor plan images and managing apartment layouts. The API is built with **FastAPI** and provides endpoints for user management and floor plan processing.

**Base URL:** `http://localhost:8000`

**API Version:** 1.0.0

## Getting Started

### Installation & Setup

```bash
# Install dependencies
pip install -r requirements-api.txt

# Start the server
python -m uvicorn src.app.main:app --reload

# Access API docs at:
# Swagger UI: http://localhost:8000/docs
# ReDoc: http://localhost:8000/redoc
```

### Health Check

Verify the API is running with a simple health check:

```bash
curl http://localhost:8000/health
```

## Authentication

Currently, the API does not implement authentication. In production, implement token-based authentication (e.g., JWT) on protected endpoints.

## API Endpoints

### Root Endpoint

#### GET /
Returns general API information and available endpoints.

**Response:**
```json
{
  "name": "Floor Plan Editor API",
  "version": "1.0.0",
  "endpoints": {
    "POST /floor-plans/process-image": "Process a floor plan image",
    "POST /floor-plans/{plan_id}/lock-rooms": "Lock rooms for redesign",
    "GET /health": "Health check",
    ...
  }
}
```

---

## Users API

### Create User

#### POST /users/

Create a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "username": "username",
  "password": "securepassword123",
  "full_name": "John Doe"
}
```

**Parameters:**
- `email` (string, required): Valid email address
- `username` (string, required): 3-50 characters, must be unique
- `password` (string, required): Minimum 8 characters
- `full_name` (string, optional): User's full name

**Response (201 Created):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "username": "username",
  "full_name": "John Doe",
  "is_active": true,
  "is_verified": false,
  "created_at": "2026-01-13T10:30:00",
  "updated_at": "2026-01-13T10:30:00"
}
```

**Error Responses:**
- `400 Bad Request`: Email already registered or username already taken
- `422 Unprocessable Entity`: Invalid input (validation error)

---

### Get User

#### GET /users/{user_id}

Retrieve user details by ID.

**Parameters:**
- `user_id` (string, path, required): UUID of the user

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "username": "username",
  "full_name": "John Doe",
  "is_active": true,
  "is_verified": false,
  "created_at": "2026-01-13T10:30:00",
  "updated_at": "2026-01-13T10:30:00"
}
```

**Error Responses:**
- `404 Not Found`: User not found

---

### List Users

#### GET /users/

List all users with pagination.

**Query Parameters:**
- `skip` (integer, optional, default: 0): Number of records to skip
- `limit` (integer, optional, default: 100): Maximum number of records to return

**Response (200 OK):**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "username": "username",
    "full_name": "John Doe",
    "is_active": true,
    "is_verified": false,
    "created_at": "2026-01-13T10:30:00",
    "updated_at": "2026-01-13T10:30:00"
  }
]
```

---

### Update User

#### PUT /users/{user_id}

Update user information.

**Parameters:**
- `user_id` (string, path, required): UUID of the user

**Request Body:**
```json
{
  "full_name": "Jane Doe",
  "email": "newemail@example.com"
}
```

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "newemail@example.com",
  "username": "username",
  "full_name": "Jane Doe",
  "is_active": true,
  "is_verified": false,
  "created_at": "2026-01-13T10:30:00",
  "updated_at": "2026-01-13T10:35:00"
}
```

**Error Responses:**
- `404 Not Found`: User not found

---

### Delete User

#### DELETE /users/{user_id}

Delete a user account.

**Response (204 No Content)**

---

## Floor Plans API

### Lock Rooms

#### POST /floor-plans/{plan_id}/lock-rooms

Lock specific rooms to prevent modifications during layout redesign. Locked state is session-based (in-memory) and scoped per user/plan.

**Parameters:**
- `plan_id` (string, path, required): UUID of the floor plan

**Request Body:**
```json
{
  "room_ids": ["room-uuid-1", "room-uuid-2"]
}
```

**Response (200 OK):**
```json
{
  "locked_room_ids": ["room-uuid-1", "room-uuid-2"],
  "total_requested": 2
}
```

**Error Responses:**
- `404 Not Found`: Floor plan or room not found
- `400 Bad Request`: Room doesn't belong to specified floor plan

**Notes:**
- Lock state is cleared on server restart
- Each user has independent locking state per floor plan
- Future: Will migrate to Redis for distributed sessions

---

Delete a user account.

**Parameters:**
- `user_id` (string, path, required): UUID of the user

**Response (204 No Content)**

**Error Responses:**
- `404 Not Found`: User not found

---

### Verify User Email

#### POST /users/{user_id}/verify

Mark user email as verified.

**Parameters:**
- `user_id` (string, path, required): UUID of the user

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "username": "username",
  "full_name": "John Doe",
  "is_active": true,
  "is_verified": true,
  "created_at": "2026-01-13T10:30:00",
  "updated_at": "2026-01-13T10:35:00"
}
```

**Error Responses:**
- `404 Not Found`: User not found

---

### Deactivate User

#### POST /users/{user_id}/deactivate

Deactivate a user account.

**Parameters:**
- `user_id` (string, path, required): UUID of the user

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "username": "username",
  "full_name": "John Doe",
  "is_active": false,
  "is_verified": false,
  "created_at": "2026-01-13T10:30:00",
  "updated_at": "2026-01-13T10:35:00"
}
```

**Error Responses:**
- `404 Not Found`: User not found

---

### Activate User

#### POST /users/{user_id}/activate

Activate a deactivated user account.

**Parameters:**
- `user_id` (string, path, required): UUID of the user

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "username": "username",
  "full_name": "John Doe",
  "is_active": true,
  "is_verified": false,
  "created_at": "2026-01-13T10:30:00",
  "updated_at": "2026-01-13T10:35:00"
}
```

**Error Responses:**
- `404 Not Found`: User not found

---

## Floor Plans API

### Process Floor Plan Image

#### POST /floor-plans/process-image

Process a floor plan image, extract layout, and persist to database.

This endpoint:
1. Validates the uploaded image
2. Processes the image using FloorPlanEngine to extract apartment layout
3. Persists the floor plan and all associated data (nodes, edges, rooms, fixtures) to the database
4. Returns the complete floor plan object

**Query Parameters:**
- `user_id` (string, required): ID of the user creating the floor plan
- `name` (string, optional): Name for the floor plan
- `scale_factor` (float, optional, default: 1/80): Scale factor for graph rescaling

**Request Body (multipart/form-data):**
- `file` (file, required): The floor plan image file (JPG, PNG, etc.)

**Response (201 Created):**
```json
{
  "id": "660f9401-e29b-41d4-a716-446655440001",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "My Apartment Plan",
  "unit_scale": 0.0125,
  "created_at": "2026-01-13T11:00:00",
  "updated_at": "2026-01-13T11:00:00",
  "nodes": [
    {
      "id": "node-001",
      "x": 10.5,
      "y": 20.3,
      "plan_id": "660f9401-e29b-41d4-a716-446655440001"
    }
  ],
  "edges": [
    {
      "id": "edge-001",
      "plan_id": "660f9401-e29b-41d4-a716-446655440001",
      "from_node": "node-001",
      "to_node": "node-002",
      "edge_type": "wall",
      "is_inner": false,
      "thickness": 0.2,
      "shift": 0.1,
      "properties": {}
    }
  ],
  "rooms": [
    {
      "id": "room-001",
      "plan_id": "660f9401-e29b-41d4-a716-446655440001",
      "polygon_coords": [[10.5, 20.3], [15.0, 20.3], [15.0, 25.0], [10.5, 25.0]],
      "tags": ["bedroom"]
    }
  ],
  "fixtures": [
    {
      "id": "fixture-001",
      "plan_id": "660f9401-e29b-41d4-a716-446655440001",
      "polygon_coords": [[11.0, 21.0], [12.0, 21.0], [12.0, 22.0], [11.0, 22.0]],
      "fixture_type": "door",
      "properties": {}
    }
  ]
}
```

**Error Responses:**
- `400 Bad Request`: No file provided
- `404 Not Found`: User not found
- `422 Unprocessable Entity`: Invalid input
- `500 Internal Server Error`: Error processing floor plan image

**Example Request:**
```bash
curl -X POST "http://localhost:8000/floor-plans/process-image?user_id=550e8400-e29b-41d4-a716-446655440000&name=My%20Apartment" \
  -H "Content-Type: multipart/form-data" \
  -F "file=@floor_plan.jpg"
```

---

### Get Floor Plan Details

#### GET /floor-plans/{plan_id}

Retrieve detailed floor plan by ID with all associated data.

**Parameters:**
- `plan_id` (string, path, required): UUID of the floor plan

**Response (200 OK):**
```json
{
  "id": "660f9401-e29b-41d4-a716-446655440001",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "My Apartment Plan",
  "unit_scale": 0.0125,
  "created_at": "2026-01-13T11:00:00",
  "updated_at": "2026-01-13T11:00:00",
  "nodes": [...],
  "edges": [...],
  "rooms": [...],
  "fixtures": [...]
}
```

**Error Responses:**
- `404 Not Found`: Floor plan not found

---

### List User Floor Plans

#### GET /floor-plans/user/{user_id}

List all floor plans for a specific user.

**Parameters:**
- `user_id` (string, path, required): UUID of the user

**Query Parameters:**
- `skip` (integer, optional, default: 0): Number of records to skip
- `limit` (integer, optional, default: 100): Maximum number of records to return

**Response (200 OK):**
```json
[
  {
    "id": "660f9401-e29b-41d4-a716-446655440001",
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "My Apartment Plan",
    "unit_scale": 0.0125,
    "created_at": "2026-01-13T11:00:00",
    "updated_at": "2026-01-13T11:00:00",
    "nodes_count": 42,
    "edges_count": 58,
    "rooms_count": 5,
    "fixtures_count": 12
  }
]
```

**Error Responses:**
- `404 Not Found`: User not found

---

### Update Floor Plan

#### PUT /floor-plans/{plan_id}

Update floor plan metadata (name).

**Parameters:**
- `plan_id` (string, path, required): UUID of the floor plan

**Query Parameters:**
- `name` (string, optional): New name for the floor plan

**Response (200 OK):**
```json
{
  "id": "660f9401-e29b-41d4-a716-446655440001",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Updated Apartment Plan",
  "unit_scale": 0.0125,
  "created_at": "2026-01-13T11:00:00",
  "updated_at": "2026-01-13T11:05:00",
  "nodes_count": 42,
  "edges_count": 58,
  "rooms_count": 5,
  "fixtures_count": 12
}
```

**Error Responses:**
- `404 Not Found`: Floor plan not found

---

### Delete Floor Plan

#### DELETE /floor-plans/{plan_id}

Delete a floor plan and all associated data.

**Parameters:**
- `plan_id` (string, path, required): UUID of the floor plan

**Response (204 No Content)**

**Error Responses:**
- `404 Not Found`: Floor plan not found

---

## Common Response Formats

### Success Response
All successful responses follow this structure:
- **Status Code**: Appropriate HTTP status (200, 201, 204, etc.)
- **Body**: JSON object or array matching the declared response model

### Error Response
Error responses follow this format:

```json
{
  "detail": "Error message describing what went wrong"
}
```

**Common HTTP Status Codes:**
- `200 OK`: Request succeeded
- `201 Created`: Resource successfully created
- `204 No Content`: Successful deletion or update
- `400 Bad Request`: Invalid request parameters
- `404 Not Found`: Resource not found
- `422 Unprocessable Entity`: Validation error
- `500 Internal Server Error`: Server error

---

## Data Models

### User

```json
{
  "id": "string (UUID)",
  "email": "string",
  "username": "string",
  "full_name": "string | null",
  "is_active": "boolean",
  "is_verified": "boolean",
  "created_at": "string (ISO 8601)",
  "updated_at": "string (ISO 8601)"
}
```

### Floor Plan (Summary)

```json
{
  "id": "string (UUID)",
  "user_id": "string (UUID)",
  "name": "string | null",
  "unit_scale": "float",
  "created_at": "string (ISO 8601)",
  "updated_at": "string (ISO 8601)",
  "nodes_count": "integer",
  "edges_count": "integer",
  "rooms_count": "integer",
  "fixtures_count": "integer"
}
```

### Floor Plan (Detailed)

```json
{
  "id": "string (UUID)",
  "user_id": "string (UUID)",
  "name": "string | null",
  "unit_scale": "float",
  "created_at": "string (ISO 8601)",
  "updated_at": "string (ISO 8601)",
  "nodes": [
    {
      "id": "string",
      "x": "float",
      "y": "float",
      "plan_id": "string (UUID)"
    }
  ],
  "edges": [
    {
      "id": "string",
      "plan_id": "string (UUID)",
      "from_node": "string",
      "to_node": "string",
      "edge_type": "string",
      "is_inner": "boolean",
      "thickness": "float",
      "shift": "float",
      "properties": "object"
    }
  ],
  "rooms": [
    {
      "id": "string",
      "plan_id": "string (UUID)",
      "polygon_coords": "array of [x, y]",
      "tags": "array of strings"
    }
  ],
  "fixtures": [
    {
      "id": "string",
      "plan_id": "string (UUID)",
      "polygon_coords": "array of [x, y]",
      "fixture_type": "string",
      "properties": "object"
    }
  ]
}
```

### Node

A point in the floor plan graph representing intersections or corners.

```json
{
  "id": "string",
  "x": "float",
  "y": "float",
  "plan_id": "string (UUID)"
}
```

### Edge

Represents walls, doors, windows, or corridors in the floor plan.

```json
{
  "id": "string",
  "plan_id": "string (UUID)",
  "from_node": "string",
  "to_node": "string",
  "edge_type": "string (e.g., 'wall', 'door', 'window', 'corridor')",
  "is_inner": "boolean",
  "thickness": "float (optional)",
  "shift": "float (optional)",
  "properties": "object"
}
```

### Room

A polygon representing a room in the apartment.

```json
{
  "id": "string",
  "plan_id": "string (UUID)",
  "polygon_coords": "array of [x, y] coordinates",
  "tags": "array of strings (e.g., ['bedroom', 'master'])"
}
```

### Fixture

A polygon representing a fixture (door, window, furniture, etc.).

```json
{
  "id": "string",
  "plan_id": "string (UUID)",
  "polygon_coords": "array of [x, y] coordinates",
  "fixture_type": "string",
  "properties": "object"
}
```

---

## Usage Examples

### Example 1: Create User and Process Floor Plan

```bash
# 1. Create a new user
curl -X POST "http://localhost:8000/users/" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "username": "johndoe",
    "password": "securepass123",
    "full_name": "John Doe"
  }'

# Response:
# {
#   "id": "550e8400-e29b-41d4-a716-446655440000",
#   "email": "john@example.com",
#   "username": "johndoe",
#   ...
# }

# 2. Process a floor plan image for the user
curl -X POST "http://localhost:8000/floor-plans/process-image?user_id=550e8400-e29b-41d4-a716-446655440000&name=My%20Apartment" \
  -F "file=@floor_plan.jpg"

# Response:
# {
#   "id": "660f9401-e29b-41d4-a716-446655440001",
#   "user_id": "550e8400-e29b-41d4-a716-446655440000",
#   "name": "My Apartment",
#   "nodes": [...],
#   "edges": [...],
#   "rooms": [...],
#   "fixtures": [...]
# }
```

### Example 2: Retrieve Floor Plan Details

```bash
curl -X GET "http://localhost:8000/floor-plans/660f9401-e29b-41d4-a716-446655440001"

# Response includes detailed graph data, rooms, and fixtures
```

### Example 3: List User's Floor Plans

```bash
curl -X GET "http://localhost:8000/floor-plans/user/550e8400-e29b-41d4-a716-446655440000?skip=0&limit=10"

# Response: Array of floor plan summaries for the user
```

---

## Deployment

### Environment Variables

- `DATABASE_URL`: PostgreSQL connection string
- `CORS_ORIGINS`: Comma-separated list of allowed origins (default: "*")

### Running with Docker

```bash
docker-compose up
```

See [DOCKER_SETUP.md](DOCKER_SETUP.md) for detailed Docker setup instructions.

---

## Additional Resources

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc
- **Source Code**: See `src/app/api/` directory
- **Database Schema**: See `src/database/models.py`

---

## Support & Troubleshooting

### Common Issues

**Database Connection Error**
- Ensure PostgreSQL is running and connection string is correct
- Check `DATABASE_URL` environment variable

**File Upload Error**
- Verify file size is reasonable
- Ensure image format is supported (JPG, PNG)
- Check file permissions

**User Not Found**
- Verify user ID is correct
- Ensure user was created before processing floor plans

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-13 | Initial release |

