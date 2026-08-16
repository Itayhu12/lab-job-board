"""
Jobs Service — FastAPI
Handles job postings CRUD with PostgreSQL.
"""
import os
import logging
from typing import Optional
from contextlib import asynccontextmanager

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://jobuser:password@postgres:5432/jobboard"
)


# ── Pydantic Models ──────────────────────────────────────────────────────────

class JobCreate(BaseModel):
    title: str
    description: str
    company: str
    location: str
    salary_range: Optional[str] = None


class JobUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    company: Optional[str] = None
    location: Optional[str] = None
    salary_range: Optional[str] = None


# ── DB Helper ────────────────────────────────────────────────────────────────

def get_conn():
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


# ── App ──────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Jobs service starting up...")
    yield
    logger.info("Jobs service shutting down.")


app = FastAPI(title="Jobs Service", version="1.0.0", lifespan=lifespan)


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    try:
        conn = get_conn()
        conn.close()
        return {"status": "healthy", "database": "connected"}
    except Exception as exc:
        logger.error("DB health check failed: %s", exc)
        return {"status": "unhealthy", "database": "disconnected"}


@app.get("/jobs/")
def list_jobs():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM jobs ORDER BY created_at DESC")
            return cur.fetchall()


@app.post("/jobs/", status_code=status.HTTP_201_CREATED)
def create_job(job: JobCreate):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO jobs (title, description, company, location, salary_range)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING *
                """,
                (job.title, job.description, job.company, job.location, job.salary_range),
            )
            conn.commit()
            return cur.fetchone()


@app.get("/jobs/{job_id}")
def get_job(job_id: int):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM jobs WHERE id = %s", (job_id,))
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return row


@app.put("/jobs/{job_id}")
def update_job(job_id: int, job: JobUpdate):
    fields = {k: v for k, v in job.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields provided for update")

    set_clause = ", ".join(f"{k} = %s" for k in fields)
    values = list(fields.values()) + [job_id]

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE jobs SET {set_clause}, updated_at = NOW() WHERE id = %s RETURNING *",
                values,
            )
            conn.commit()
            row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return row


@app.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_job(job_id: int):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM jobs WHERE id = %s RETURNING id", (job_id,))
            conn.commit()
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
