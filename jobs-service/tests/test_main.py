"""
Unit tests for Jobs Service (Task 4.3)
Uses FastAPI TestClient and mocks the database — no real DB needed in CI.
"""
from unittest.mock import patch, MagicMock
import pytest
from fastapi.testclient import TestClient

# Patch psycopg2 before importing the app so no real DB connection is attempted
with patch("psycopg2.connect"):
    from main import app

client = TestClient(app)

# ── Sample data ──────────────────────────────────────────────────────────────

SAMPLE_JOB = {
    "id": 1,
    "title": "DevSecOps Engineer",
    "description": "Build secure pipelines",
    "company": "CloudSecure",
    "location": "Tel Aviv",
    "salary_range": "$90k-$130k",
    "created_at": "2024-01-01T00:00:00",
    "updated_at": "2024-01-01T00:00:00",
}


def make_mock_conn(fetchone=None, fetchall=None):
    """Helper: create a mock psycopg2 connection."""
    mock_cur = MagicMock()
    mock_cur.__enter__ = lambda s: s
    mock_cur.__exit__ = MagicMock(return_value=False)
    mock_cur.fetchone.return_value = fetchone
    mock_cur.fetchall.return_value = fetchall or []

    mock_conn = MagicMock()
    mock_conn.__enter__ = lambda s: s
    mock_conn.__exit__ = MagicMock(return_value=False)
    mock_conn.cursor.return_value = mock_cur

    return mock_conn, mock_cur


# ── Tests ────────────────────────────────────────────────────────────────────

class TestHealthEndpoint:
    def test_health_returns_healthy_when_db_ok(self):
        """GET /health should return 200 with healthy status when DB is reachable."""
        with patch("main.get_conn") as mock_get_conn:
            mock_conn = MagicMock()
            mock_get_conn.return_value = mock_conn

            response = client.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["database"] == "connected"

    def test_health_returns_unhealthy_when_db_fails(self):
        """GET /health should return unhealthy when DB connection fails."""
        with patch("main.get_conn", side_effect=Exception("Connection refused")):
            response = client.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "unhealthy"


class TestCreateJob:
    def test_create_job_valid_data_returns_201(self):
        """POST /jobs/ with valid payload should return 201 Created."""
        payload = {
            "title": "Backend Developer",
            "description": "Build APIs",
            "company": "Tech Corp",
            "location": "Remote",
            "salary_range": "$80k-$100k",
        }

        mock_conn, mock_cur = make_mock_conn(fetchone={**payload, "id": 1})

        with patch("main.get_conn", return_value=mock_conn):
            response = client.post("/jobs/", json=payload)

        assert response.status_code == 201
        data = response.json()
        assert data["title"] == payload["title"]
        assert data["company"] == payload["company"]

    def test_create_job_missing_required_fields_returns_422(self):
        """POST /jobs/ with missing required fields should return 422 Unprocessable Entity."""
        # 'title' is required but omitted
        payload = {
            "description": "Build APIs",
            "company": "Tech Corp",
            "location": "Remote",
        }
        response = client.post("/jobs/", json=payload)
        assert response.status_code == 422

    def test_create_job_empty_body_returns_422(self):
        """POST /jobs/ with empty body should return 422."""
        response = client.post("/jobs/", json={})
        assert response.status_code == 422


class TestGetJob:
    def test_get_existing_job_returns_200(self):
        """GET /jobs/{id} for an existing job should return 200."""
        mock_conn, mock_cur = make_mock_conn(fetchone=SAMPLE_JOB)

        with patch("main.get_conn", return_value=mock_conn):
            response = client.get("/jobs/1")

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == 1
        assert data["title"] == SAMPLE_JOB["title"]

    def test_get_nonexistent_job_returns_404(self):
        """GET /jobs/{id} for a non-existent ID should return 404."""
        mock_conn, mock_cur = make_mock_conn(fetchone=None)

        with patch("main.get_conn", return_value=mock_conn):
            response = client.get("/jobs/9999")

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()


class TestListJobs:
    def test_list_jobs_returns_200(self):
        """GET /jobs/ should return 200 with a list."""
        mock_conn, mock_cur = make_mock_conn(fetchall=[SAMPLE_JOB])

        with patch("main.get_conn", return_value=mock_conn):
            response = client.get("/jobs/")

        assert response.status_code == 200
        assert isinstance(response.json(), list)

    def test_list_jobs_empty_returns_empty_list(self):
        """GET /jobs/ with no data should return empty list."""
        mock_conn, mock_cur = make_mock_conn(fetchall=[])

        with patch("main.get_conn", return_value=mock_conn):
            response = client.get("/jobs/")

        assert response.status_code == 200
        assert response.json() == []
